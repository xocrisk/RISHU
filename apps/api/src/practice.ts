import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";

type Quote = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

const quotes: Quote[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", price: 1450, change: 8.4, changePercent: 0.58, open: 1444, high: 1458, low: 1439, close: 1441.6 },
  { symbol: "TCS", name: "Tata Consultancy Services", price: 4102.55, change: 18.2, changePercent: 0.45, open: 4088, high: 4112, low: 4075, close: 4084.35 },
  { symbol: "INFY", name: "Infosys", price: 1512.4, change: -4.6, changePercent: -0.30, open: 1519, high: 1523, low: 1506, close: 1517 },
  { symbol: "HDFCBANK", name: "HDFC Bank", price: 1680, change: 6.25, changePercent: 0.37, open: 1674, high: 1688, low: 1669, close: 1673.75 },
  { symbol: "ICICIBANK", name: "ICICI Bank", price: 1245, change: 3.5, changePercent: 0.28, open: 1242, high: 1251, low: 1236, close: 1241.5 },
  { symbol: "ITC", name: "ITC Limited", price: 432.8, change: -1.2, changePercent: -0.28, open: 434, high: 436, low: 430, close: 434 },
  { symbol: "SBIN", name: "State Bank of India", price: 812.5, change: 5.15, changePercent: 0.64, open: 807, high: 816, low: 804, close: 807.35 },
  { symbol: "TATAMOTORS", name: "Tata Motors", price: 688, change: 2.4, changePercent: 0.35, open: 685, high: 694, low: 681, close: 685.6 },
  { symbol: "WIPRO", name: "Wipro", price: 286.4, change: -0.85, changePercent: -0.30, open: 287, high: 289, low: 284, close: 287.25 },
  { symbol: "LT", name: "Larsen & Toubro", price: 3560, change: 21, changePercent: 0.59, open: 3542, high: 3572, low: 3530, close: 3539 },
  { symbol: "BHARTIARTL", name: "Bharti Airtel", price: 1875, change: 9.5, changePercent: 0.51, open: 1867, high: 1884, low: 1859, close: 1865.5 },
  { symbol: "MARUTI", name: "Maruti Suzuki", price: 12400, change: -42, changePercent: -0.34, open: 12450, high: 12480, low: 12370, close: 12442 },
];
const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
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

function priceOf(symbol: string): number {
  return bySymbol.get(symbol)?.price ?? 0;
}

function money(value: number | string): number {
  return Number(Number(value).toFixed(2));
}

async function ensurePortfolio(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `INSERT INTO practice_portfolios (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [id],
  );
  await pool.query(
    `INSERT INTO practice_portfolio_snapshots (user_id, portfolio_value, reason)
     SELECT user_id, cash, 'session-start' FROM practice_portfolios
     WHERE user_id = $1 AND NOT EXISTS (
       SELECT 1 FROM practice_portfolio_snapshots WHERE user_id = $1
     )`,
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

async function portfolioValue(client: PoolClient, id: string): Promise<number> {
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
    (total, holding) => total + holding.quantity * (priceOf(holding.symbol) || Number(holding.average_cost)),
    0,
  );
  return money(Number(row.cash) + marketValue);
}

async function recordSnapshot(client: PoolClient, id: string, reason: string): Promise<void> {
  const value = await portfolioValue(client, id);
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
  await recordSnapshot(client, id, `order:${order.id}`);
}

export async function registerPracticeRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/v1/practice/dashboard", async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    await ensurePortfolio(pool, id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const portfolio = await client.query<{ cash: string; day_start_value: string; day_start_date: string }>(
        "SELECT cash, day_start_value, day_start_date::text FROM practice_portfolios WHERE user_id = $1 FOR UPDATE",
        [id],
      );
      const currentDay = new Date().toISOString().slice(0, 10);
      if (portfolio.rows[0]?.day_start_date !== currentDay) {
        const currentValue = await portfolioValue(client, id);
        await client.query(
          "UPDATE practice_portfolios SET day_start_value = $2, day_start_date = $3 WHERE user_id = $1",
          [id, currentValue, currentDay],
        );
      }
      const openOrders = await client.query<{
        id: string; symbol: string; side: "buy" | "sell"; quantity: number; product: string;
        order_type: "market" | "limit"; limit_price: string | null;
      }>(
        "SELECT id, symbol, side, quantity, product, order_type, limit_price FROM practice_orders WHERE user_id = $1 AND status = 'open' FOR UPDATE",
        [id],
      );
      for (const order of openOrders.rows) {
        const quote = priceOf(order.symbol);
        const limit = Number(order.limit_price);
        const eligible = order.side === "buy" ? quote <= limit : quote >= limit;
        if (order.order_type === "limit" && eligible) {
          await applyFill(client, id, {
            id: order.id, symbol: order.symbol, side: order.side, quantity: order.quantity, product: order.product,
          }, quote);
        }
      }
      const portfolioData = await client.query<{
        cash: string; realized_pnl: string; day_start_value: string; leaderboard_opt_in: boolean;
        full_name: string | null; college: string | null;
      }>(
        `SELECT p.cash, p.realized_pnl, p.day_start_value, u.leaderboard_opt_in, u.full_name, u.college
         FROM practice_portfolios p JOIN users u ON u.id = p.user_id WHERE p.user_id = $1`,
        [id],
      );
      const holdingsResult = await client.query<{
        symbol: string; quantity: number; average_cost: string; realized_pnl: string;
      }>("SELECT symbol, quantity, average_cost, realized_pnl FROM practice_holdings WHERE user_id = $1 ORDER BY symbol", [id]);
      const ordersResult = await client.query(
        `SELECT id, symbol, side, product, order_type AS "orderType", quantity,
          limit_price AS "limitPrice", fill_price AS "fillPrice", status, created_at AS "createdAt",
          filled_at AS "filledAt", rejection_reason AS "rejectionReason"
         FROM practice_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [id],
      );
      const snapshots = await client.query<{ portfolio_value: string; created_at: Date }>(
        `SELECT portfolio_value, created_at FROM practice_portfolio_snapshots
         WHERE user_id = $1 AND created_at >= date_trunc('day', now()) ORDER BY created_at`,
        [id],
      );
      const holdings = holdingsResult.rows.map((holding) => {
        const quote = bySymbol.get(holding.symbol);
        const marketPrice = quote?.price ?? Number(holding.average_cost);
        return {
          symbol: holding.symbol, name: quote?.name ?? holding.symbol, quantity: holding.quantity,
          averageCost: Number(holding.average_cost), lastPrice: marketPrice,
          currentValue: money(marketPrice * holding.quantity),
          unrealizedPnl: money((marketPrice - Number(holding.average_cost)) * holding.quantity),
          realizedPnl: Number(holding.realized_pnl),
        };
      });
      const data = portfolioData.rows[0];
      if (!data) throw new Error("Practice portfolio was not initialized.");
      const cash = Number(data.cash);
      const investedValue = money(holdings.reduce((total, holding) => total + holding.currentValue, 0));
      const portfolioValueNow = money(cash + investedValue);
      const reservedCash = openOrders.rows.filter((order) => order.side === "buy")
        .reduce((total, order) => total + (Number(order.limit_price) * order.quantity), 0);
      const availableCash = money(cash - reservedCash);
      const dayChange = money(portfolioValueNow - Number(data.day_start_value));
      const dayChangePercent = Number(data.day_start_value) === 0 ? 0 : money((dayChange / Number(data.day_start_value)) * 100);
      const leaderboard = data.college ? await client.query<{
        user_id: string; display_name: string; cash: string; symbol: string | null; quantity: number | null; average_cost: string | null;
      }>(
        `SELECT u.id AS user_id, COALESCE(NULLIF(u.full_name, ''), 'XOCRISK learner') AS display_name,
          p.cash, h.symbol, h.quantity, h.average_cost
         FROM users u JOIN practice_portfolios p ON p.user_id = u.id
         LEFT JOIN practice_holdings h ON h.user_id = u.id
         WHERE u.leaderboard_opt_in = TRUE AND u.college = $1`,
        [data.college],
      ) : { rows: [] };
      const ranked = new Map<string, { displayName: string; value: number }>();
      for (const entry of leaderboard.rows) {
        const current = ranked.get(entry.user_id) ?? {
          displayName: entry.display_name,
          value: Number(entry.cash),
        };
        if (entry.symbol && entry.quantity) {
          current.value += entry.quantity * (priceOf(entry.symbol) || Number(entry.average_cost));
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
      await client.query("COMMIT");
      return {
        user: { fullName: data.full_name, college: data.college, leaderboardOptIn: data.leaderboard_opt_in },
        market: { dataMode: "DEMO", lastUpdatedAt: null, quotes },
        portfolio: {
          totalValue: portfolioValueNow, dayChange, dayChangePercent, availableCash,
          cash, investedValue,
          unrealizedPnl: money(holdings.reduce((total, holding) => total + holding.unrealizedPnl, 0)),
          realizedPnl: Number(data.realized_pnl),
          trend: snapshots.rows.map((snapshot) => ({ value: Number(snapshot.portfolio_value), time: snapshot.created_at })),
        },
        holdings,
        orders: ordersResult.rows,
        leaderboard: leaderboardRows,
        rules: { initialCash, charges: 0, slippage: 0, limitBandPercent: 20 },
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  app.post<{ Body: { symbol: string; side: "buy" | "sell"; product: "delivery" | "intraday";
    orderType: "market" | "limit"; quantity: number; limitPrice?: number } }>(
    "/v1/practice/orders", { schema: orderSchema },
    async (request, reply) => {
      const id = userId(request);
      if (!id) return reply.code(401).send({ message: "Sign in to continue." });
      const { symbol, side, product, orderType, quantity, limitPrice } = request.body;
      const quote = bySymbol.get(symbol);
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
          await applyFill(client, id, { id: order.id, symbol, side, quantity, product }, quote.price);
        }
        await client.query("COMMIT");
        return reply.code(201).send({
          order: { id: order.id, symbol, side, product, orderType, quantity,
            limitPrice: orderType === "limit" ? limitPrice : null,
            fillPrice: orderType === "market" ? quote.price : null,
            status: orderType === "market" ? "filled" : "open", createdAt: order.created_at },
          estimatedValue: money(effectivePrice * quantity), charges: 0,
          total: money(effectivePrice * quantity),
          message: orderType === "market" ? "Practice order filled." : "Limit order placed and waiting for its price condition.",
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

  app.post("/v1/practice/reset", async (request, reply) => {
    const id = userId(request);
    if (!id) return reply.code(401).send({ message: "Sign in to continue." });
    await ensurePortfolio(pool, id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT user_id FROM practice_portfolios WHERE user_id = $1 FOR UPDATE", [id]);
      await client.query("DELETE FROM practice_orders WHERE user_id = $1", [id]);
      await client.query("DELETE FROM practice_holdings WHERE user_id = $1", [id]);
      await client.query("DELETE FROM practice_portfolio_snapshots WHERE user_id = $1", [id]);
      await client.query(
        "UPDATE practice_portfolios SET cash = $2, realized_pnl = 0, day_start_value = $2, day_start_date = CURRENT_DATE, updated_at = now() WHERE user_id = $1",
        [id, initialCash],
      );
      await recordSnapshot(client, id, "portfolio-reset");
      await client.query("COMMIT");
      return { message: "Practice portfolio reset to ₹1,00,000. Your profile and leaderboard preference were kept." };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
}
