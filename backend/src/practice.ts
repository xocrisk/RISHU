import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";
import type { MarketFeed, Quote } from "./market/feed.js";
import { instruments } from "./market/instruments.js";

const initialCash = 100000;
const orderSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["symbol", "side", "product", "orderType", "quantity"],
    properties: {
      symbol: { type: "string", minLength: 1, maxLength: 20 },
      side: { type: "string", enum: ["buy", "sell"] },
      product: { type: "string", enum: ["delivery", "intraday"] },
      orderType: { type: "string", enum: ["market", "limit"] },
      quantity: { type: "integer", minimum: 1, maximum: 100000 },
      limitPrice: { type: "number", exclusiveMinimum: 0, maximum: 100000000 },
    },
  },
} as const;

function userId(request: FastifyRequest): string | null {
  return request.authUser?.id ?? null;
}

type Prices = Map<string, Quote>;

function pricesOf(quotes: Quote[]): Prices {
  return new Map(quotes.map((quote) => [quote.symbol, quote]));
}

const istTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
});

function closedMessage(market: MarketFeed): string {
  const status = market.status();
  return `The market is closed (${status.reason}). It opens at ${istTime.format(status.nextChangeAt)} IST.`;
}

function money(value: number | string): number {
  return Number(Number(value).toFixed(2));
}

async function ensurePortfolio(pool: Pool, id: string): Promise<void> {
  // One round trip: create the portfolio if needed, and record its first snapshot when it's new.
  await pool.query(
    `WITH created AS (
       INSERT INTO practice_portfolios (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING user_id, cash
     )
     INSERT INTO practice_portfolio_snapshots (user_id, portfolio_value, reason)
     SELECT user_id, cash, 'session-start' FROM created`,
    [id],
  );
}

async function recordRejectedOrder(
  pool: Pool,
  user: string,
  order: {
    symbol: string; side: "buy" | "sell"; product: "delivery" | "intraday";
    orderType: "market" | "limit"; quantity: number; limitPrice?: number;
  },
  reason: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO practice_orders
      (user_id, symbol, side, product, order_type, quantity, limit_price, status, rejection_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'rejected', $8)`,
    [user, order.symbol, order.side, order.product, order.orderType, order.quantity,
      order.limitPrice ?? null, reason],
  );
}

async function portfolioValue(client: PoolClient, id: string, prices: Prices): Promise<number> {
  const result = await client.query<{ cash: string }>(
    "SELECT cash FROM practice_portfolios WHERE user_id = $1",
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Practice portfolio was not initialized.");
  const holdings = await client.query<{ symbol: string; quantity: number; average_cost: string }>(
    "SELECT symbol, quantity, average_cost FROM practice_holdings WHERE user_id = $1",
    [id],
  );
  const marketValue = holdings.rows.reduce(
    (total, holding) => total + holding.quantity * (prices.get(holding.symbol)?.price ?? Number(holding.average_cost)),
    0,
  );
  return money(Number(row.cash) + marketValue);
}

async function recordSnapshot(client: PoolClient, id: string, reason: string, prices: Prices): Promise<void> {
  const value = await portfolioValue(client, id, prices);
  await client.query(
    "INSERT INTO practice_portfolio_snapshots (user_id, portfolio_value, reason) VALUES ($1, $2, $3)",
    [id, value, reason],
  );
}

async function applyFill(
  client: PoolClient,
  id: string,
  order: { id: string; symbol: string; side: "buy" | "sell"; quantity: number; product: string },
  fillPrice: number,
  prices: Prices,
): Promise<void> {
  const amount = money(fillPrice * order.quantity);
  await client.query("SELECT user_id FROM practice_portfolios WHERE user_id = $1 FOR UPDATE", [id]);
  if (order.side === "buy") {
    const current = await client.query<{ cash: string }>(
      "SELECT cash FROM practice_portfolios WHERE user_id = $1",
      [id],
    );
    if (Number(current.rows[0]?.cash ?? 0) < amount) throw new Error("Not enough available practice cash to fill this order.");
    await client.query(
      "UPDATE practice_portfolios SET cash = cash - $2, updated_at = now() WHERE user_id = $1",
      [id, amount],
    );
    await client.query(
      `INSERT INTO practice_holdings (user_id, symbol, quantity, average_cost)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, symbol) DO UPDATE
       SET average_cost = ((practice_holdings.quantity * practice_holdings.average_cost) + ($3 * $4))
                          / (practice_holdings.quantity + $3),
           quantity = practice_holdings.quantity + $3,
           updated_at = now()`,
      [id, order.symbol, order.quantity, fillPrice],
    );
  } else {
    const holding = await client.query<{ quantity: number; average_cost: string }>(
      "SELECT quantity, average_cost FROM practice_holdings WHERE user_id = $1 AND symbol = $2 FOR UPDATE",
      [id, order.symbol],
    );
    const position = holding.rows[0];
    if (!position || position.quantity < order.quantity) throw new Error("Not enough available shares to fill this sell order.");
    const realized = money((fillPrice - Number(position.average_cost)) * order.quantity);
    await client.query(
      "UPDATE practice_portfolios SET cash = cash + $2, updated_at = now() WHERE user_id = $1",
      [id, amount],
    );
    await client.query(
      "UPDATE practice_portfolios SET realized_pnl = realized_pnl + $2 WHERE user_id = $1",
      [id, realized],
    );
    if (position.quantity === order.quantity) {
      await client.query("DELETE FROM practice_holdings WHERE user_id = $1 AND symbol = $2", [id, order.symbol]);
    } else {
      await client.query(
        `UPDATE practice_holdings SET quantity = quantity - $3, realized_pnl = realized_pnl + $4,
         updated_at = now() WHERE user_id = $1 AND symbol = $2`,
        [id, order.symbol, order.quantity, realized],
      );
    }
  }
  await client.query(
    "UPDATE practice_orders SET status = 'filled', fill_price = $2, filled_at = now() WHERE id = $1",
    [order.id, fillPrice],
  );
  await recordSnapshot(client, id, `order:${order.id}`, prices);
}

/**
 * Fills open limit orders whose price condition is met at the current quotes, for one user or everyone.
 * Runs only while the market is open. An order that can no longer be funded is rejected instead.
 */
export async function fillLimitOrders(pool: Pool, market: MarketFeed, onlyUser?: string): Promise<void> {
  if (!market.status().isOpen) return;
  const prices = pricesOf(await market.list());
  const open = await pool.query<{ id: string; user_id: string; symbol: string; side: "buy" | "sell"; limit_price: string }>(
    `SELECT id, user_id, symbol, side, limit_price FROM practice_orders
     WHERE status = 'open' AND order_type = 'limit' AND ($1::uuid IS NULL OR user_id = $1)
     ORDER BY created_at`,
    [onlyUser ?? null],
  );
  for (const row of open.rows) {
    const quote = prices.get(row.symbol);
    const limit = Number(row.limit_price);
    if (!quote || !(row.side === "buy" ? quote.price <= limit : quote.price >= limit)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ quantity: number; product: string }>(
        "SELECT quantity, product FROM practice_orders WHERE id = $1 AND status = 'open' FOR UPDATE", [row.id],
      );
      const order = locked.rows[0];
      if (!order) {
        await client.query("ROLLBACK");
        continue;
      }
      try {
        await applyFill(client, row.user_id, {
          id: row.id, symbol: row.symbol, side: row.side, quantity: order.quantity, product: order.product,
        }, quote.price, prices);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        await pool.query(
          "UPDATE practice_orders SET status = 'rejected', rejection_reason = $2 WHERE id = $1 AND status = 'open'",
          [row.id, error instanceof Error ? error.message : "The order could not be filled."],
        );
      }
    } finally {
      client.release();
    }
  }
}

export async function registerPracticeRoutes(app: FastifyInstance, pool: Pool, market: MarketFeed): Promise<void> {
  market.onRefresh(() => fillLimitOrders(pool, market));

  app.get("/v1/practice/dashboard", async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    await ensurePortfolio(pool, id);
    await fillLimitOrders(pool, market, id);
    const [quotes, indices] = await Promise.all([market.list(), market.indexQuotes()]);
    const prices = pricesOf(quotes);
    const status = market.status();

    // These reads don't depend on each other, so they run in parallel (one network round trip, not six).
    const [openOrders, portfolioData, holdingsResult, ordersResult, snapshots, leaderboard] = await Promise.all([
      pool.query<{ side: "buy" | "sell"; quantity: number; limit_price: string | null }>(
        "SELECT side, quantity, limit_price FROM practice_orders WHERE user_id = $1 AND status = 'open'",
        [id],
      ),
      pool.query<{
        cash: string; referral_bonus: string; realized_pnl: string; day_start_value: string; day_start_date: string; leaderboard_opt_in: boolean;
        full_name: string | null; college: string | null; email: string; mobile: string | null; uid: string;
        member_since: Date; previous_login: Date | null; current_login: Date | null; preferences: Record<string, unknown>;
      }>(
        `SELECT p.cash, p.referral_bonus, p.realized_pnl, p.day_start_value, p.day_start_date::text, u.leaderboard_opt_in, u.full_name, u.college,
           u.email, u.mobile, u.uid, u.created_at AS member_since, u.preferences,
           -- The newest session is this visit; the one before it is the last login.
           (SELECT created_at FROM auth_sessions s WHERE s.user_id = u.id ORDER BY created_at DESC OFFSET 1 LIMIT 1) AS previous_login,
           (SELECT max(created_at) FROM auth_sessions s WHERE s.user_id = u.id) AS current_login
         FROM practice_portfolios p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1`,
        [id],
      ),
      pool.query<{ symbol: string; quantity: number; average_cost: string; realized_pnl: string }>(
        "SELECT symbol, quantity, average_cost, realized_pnl FROM practice_holdings WHERE user_id = $1 ORDER BY symbol",
        [id],
      ),
      pool.query(
        `SELECT id, symbol, side, product, order_type AS "orderType", quantity,
          limit_price AS "limitPrice", fill_price AS "fillPrice", status, created_at AS "createdAt",
          filled_at AS "filledAt", rejection_reason AS "rejectionReason"
         FROM practice_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [id],
      ),
      pool.query<{ portfolio_value: string; created_at: Date }>(
        `SELECT portfolio_value, created_at FROM practice_portfolio_snapshots
         WHERE user_id = $1 AND created_at >= date_trunc('day', now()) ORDER BY created_at`,
        [id],
      ),
      pool.query<{ user_id: string; display_name: string; cash: string; symbol: string | null; quantity: number | null; average_cost: string | null }>(
        `SELECT u.id AS user_id, COALESCE(NULLIF(u.full_name, ''), 'XOCRISK learner') AS display_name,
          (p.cash - p.referral_bonus) AS cash, h.symbol, h.quantity, h.average_cost
         FROM users u JOIN practice_portfolios p ON p.user_id = u.id
         LEFT JOIN practice_holdings h ON h.user_id = u.id
         WHERE u.leaderboard_opt_in = TRUE AND u.college IS NOT NULL
           AND u.college = (SELECT college FROM users WHERE id = $1)`,
        [id],
      ),
    ]);

    const data = portfolioData.rows[0];
    if (!data) throw new Error("Practice portfolio was not initialized.");
    const holdings = holdingsResult.rows.map((holding) => {
      const quote = prices.get(holding.symbol);
      const marketPrice = quote?.price ?? Number(holding.average_cost);
      return {
        symbol: holding.symbol, name: quote?.name ?? holding.symbol, quantity: holding.quantity,
        averageCost: Number(holding.average_cost), lastPrice: marketPrice,
        currentValue: money(marketPrice * holding.quantity),
        unrealizedPnl: money((marketPrice - Number(holding.average_cost)) * holding.quantity),
        realizedPnl: Number(holding.realized_pnl),
      };
    });
    const cash = Number(data.cash);
    const investedValue = money(holdings.reduce((total, holding) => total + holding.currentValue, 0));
    const portfolioValueNow = money(cash + investedValue);

    // First visit of a new day: today's change is measured from the value right now.
    let dayStartValue = Number(data.day_start_value);
    const currentDay = new Date().toISOString().slice(0, 10);
    if (data.day_start_date !== currentDay) {
      dayStartValue = portfolioValueNow;
      await pool.query(
        "UPDATE practice_portfolios SET day_start_value = $2, day_start_date = $3 WHERE user_id = $1 AND day_start_date <> $3",
        [id, portfolioValueNow, currentDay],
      );
    }

    const reservedCash = openOrders.rows.filter((order) => order.side === "buy")
      .reduce((total, order) => total + (Number(order.limit_price) * order.quantity), 0);
    const availableCash = money(cash - reservedCash);
    const dayChange = money(portfolioValueNow - dayStartValue);
    const dayChangePercent = dayStartValue === 0 ? 0 : money((dayChange / dayStartValue) * 100);

    const ranked = new Map<string, { displayName: string; value: number }>();
    for (const entry of leaderboard.rows) {
      const current = ranked.get(entry.user_id) ?? { displayName: entry.display_name, value: Number(entry.cash) };
      if (entry.symbol && entry.quantity) {
        current.value += entry.quantity * (prices.get(entry.symbol)?.price ?? Number(entry.average_cost));
      }
      ranked.set(entry.user_id, current);
    }
    const leaderboardRows = [...ranked.entries()]
      .sort((first, second) => second[1].value - first[1].value)
      .slice(0, 20)
      .map(([participantId, entry], index) => ({
        rank: index + 1,
        displayName: entry.displayName,
        returnPercent: money(((entry.value - initialCash) / initialCash) * 100),
        isSelf: participantId === id,
      }));

    return {
      user: {
        fullName: data.full_name, college: data.college, leaderboardOptIn: data.leaderboard_opt_in,
        email: data.email, mobile: data.mobile, uid: data.uid, memberSince: data.member_since,
        lastLoginAt: data.previous_login ?? data.current_login,
        preferences: data.preferences,
      },
      market: {
        dataMode: "DELAYED", lastUpdatedAt: market.lastUpdatedAt,
        status: { isOpen: status.isOpen, reason: status.reason, nextChangeAt: status.nextChangeAt },
        quotes,
        indices,
        nifty50: instruments.filter((instrument) => instrument.nifty50).map((instrument) => instrument.symbol),
      },
      portfolio: {
        totalValue: portfolioValueNow, dayChange, dayChangePercent, availableCash,
        cash, investedValue, referralBonus: Number(data.referral_bonus),
        unrealizedPnl: money(holdings.reduce((total, holding) => total + holding.unrealizedPnl, 0)),
        realizedPnl: Number(data.realized_pnl),
        trend: snapshots.rows.map((snapshot) => ({ value: Number(snapshot.portfolio_value), time: snapshot.created_at })),
      },
      holdings,
      orders: ordersResult.rows,
      leaderboard: leaderboardRows,
      rules: { initialCash, charges: 0, slippage: 0, limitBandPercent: 20 },
    };
  });

  app.post<{ Body: { symbol: string; side: "buy" | "sell"; product: "delivery" | "intraday";
    orderType: "market" | "limit"; quantity: number; limitPrice?: number } }>(
    "/v1/practice/orders", { schema: orderSchema },
    async (request, reply) => {
      const id = userId(request);
      if (!id) return reply.code(401).send({ message: "Sign in to continue." });
      const { symbol, side, product, orderType, quantity, limitPrice } = request.body;
      const quotes = await market.list();
      const prices = pricesOf(quotes);
      const quote = prices.get(symbol);
      const isOpen = market.status().isOpen;
      if (!quote) {
        const message = "Choose a supported stock from the watchlist.";
        await ensurePortfolio(pool, id);
        await recordRejectedOrder(pool, id, request.body, message);
        return reply.code(400).send({ message });
      }
      if (orderType === "limit" && limitPrice === undefined) {
        const message = "Enter a valid limit price.";
        await ensurePortfolio(pool, id);
        await recordRejectedOrder(pool, id, request.body, message);
        return reply.code(400).send({ message });
      }
      if (orderType === "market" && !isOpen) {
        const message = `${closedMessage(market)} Place a limit order to queue it for the next session.`;
        await ensurePortfolio(pool, id);
        await recordRejectedOrder(pool, id, request.body, message);
        return reply.code(400).send({ message });
      }
      const effectivePrice = orderType === "limit" ? limitPrice! : quote.price;
      if (orderType === "limit" && (effectivePrice < quote.price * 0.8 || effectivePrice > quote.price * 1.2)) {
        const message = "Limit price must be within 20% of the current reference price.";
        await ensurePortfolio(pool, id);
        await recordRejectedOrder(pool, id, request.body, message);
        return reply.code(400).send({ message });
      }
      await ensurePortfolio(pool, id);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const account = await client.query<{ cash: string }>(
          "SELECT cash FROM practice_portfolios WHERE user_id = $1 FOR UPDATE", [id],
        );
        const cash = Number(account.rows[0]?.cash ?? 0);
        if (side === "buy") {
          const reserved = await client.query<{ amount: string }>(
            `SELECT COALESCE(SUM(quantity * limit_price), 0)::text AS amount
             FROM practice_orders WHERE user_id = $1 AND side = 'buy' AND status = 'open'`,
            [id],
          );
          const required = money(effectivePrice * quantity);
          if (required + Number(reserved.rows[0]?.amount ?? 0) > cash) {
            await client.query("ROLLBACK");
            const message = "This order exceeds available practice cash. Reduce the quantity or price.";
            await recordRejectedOrder(pool, id, request.body, message);
            return reply.code(400).send({ message });
          }
        } else {
          const position = await client.query<{ quantity: number }>(
            "SELECT quantity FROM practice_holdings WHERE user_id = $1 AND symbol = $2 FOR UPDATE",
            [id, symbol],
          );
          const reserved = await client.query<{ quantity: string }>(
            "SELECT COALESCE(SUM(quantity), 0)::text AS quantity FROM practice_orders WHERE user_id = $1 AND symbol = $2 AND side = 'sell' AND status = 'open'",
            [id, symbol],
          );
          const available = Number(position.rows[0]?.quantity ?? 0) - Number(reserved.rows[0]?.quantity ?? 0);
          if (quantity > available) {
            await client.query("ROLLBACK");
            const message = `You can sell up to ${Math.max(0, available)} available shares.`;
            await recordRejectedOrder(pool, id, request.body, message);
            return reply.code(400).send({ message });
          }
        }
        const created = await client.query<{ id: string; created_at: Date }>(
          `INSERT INTO practice_orders (user_id, symbol, side, product, order_type, quantity, limit_price, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at`,
          [id, symbol, side, product, orderType, quantity, orderType === "limit" ? limitPrice : null,
            orderType === "limit" ? "open" : "filled"],
        );
        const order = created.rows[0];
        if (!order) throw new Error("Order could not be created.");
        if (orderType === "market") {
          await applyFill(client, id, { id: order.id, symbol, side, quantity, product }, quote.price, prices);
        }
        await client.query("COMMIT");
        return reply.code(201).send({
          order: { id: order.id, symbol, side, product, orderType, quantity,
            limitPrice: orderType === "limit" ? limitPrice : null,
            fillPrice: orderType === "market" ? quote.price : null,
            status: orderType === "market" ? "filled" : "open", createdAt: order.created_at },
          estimatedValue: money(effectivePrice * quantity), charges: 0,
          total: money(effectivePrice * quantity),
          message: orderType === "market" ? "Practice order filled."
            : isOpen ? "Limit order placed and waiting for its price condition."
            : `Limit order queued. ${closedMessage(market)}`,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.delete<{ Params: { orderId: string } }>("/v1/practice/orders/:orderId", async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.params.orderId)) {
      return reply.code(400).send({ message: "Enter a valid order ID." });
    }
    const result = await pool.query(
      `UPDATE practice_orders SET status = 'cancelled'
       WHERE id = $1 AND user_id = $2 AND status = 'open' RETURNING id`,
      [request.params.orderId, id],
    );
    if (result.rowCount === 0) return reply.code(404).send({ message: "Open order not found; it may already be filled or cancelled." });
    return reply.code(200).send({ message: "Open order cancelled." });
  });

  app.put<{ Body: { enabled: boolean } }>("/v1/practice/leaderboard", {
    schema: { body: { type: "object", additionalProperties: false, required: ["enabled"], properties: { enabled: { type: "boolean" } } } },
  }, async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    await pool.query("UPDATE users SET leaderboard_opt_in = $2 WHERE id = $1", [id, request.body.enabled]);
    return { leaderboardOptIn: request.body.enabled };
  });


}
