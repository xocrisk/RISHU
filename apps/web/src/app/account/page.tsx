"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuthApi } from "../../lib/auth-session";
import "./dashboard.css";

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

type Quote = {
  symbol: string; name: string; price: number; change: number; changePercent: number;
  /** Day open; null until fetched for the latest session. */
  open: number | null; high: number; low: number; close: number;
};
type Holding = {
  symbol: string; name: string; quantity: number; averageCost: number; lastPrice: number;
  currentValue: number; unrealizedPnl: number; realizedPnl: number;
};
type Order = {
  id: string; symbol: string; side: "buy" | "sell"; product: "delivery" | "intraday";
  orderType: "market" | "limit"; quantity: number; limitPrice: number | null;
  fillPrice: number | null; status: "open" | "filled" | "cancelled" | "rejected";
  rejectionReason?: string | null; createdAt: string;
};
type Dashboard = {
  user: { fullName: string | null; college: string | null; leaderboardOptIn: boolean };
  market: {
    dataMode: "DELAYED"; lastUpdatedAt: string | null;
    status: { isOpen: boolean; reason: string | null; nextChangeAt: string };
    quotes: Quote[];
  };
  portfolio: {
    totalValue: number; dayChange: number; dayChangePercent: number; availableCash: number;
    cash: number; investedValue: number; unrealizedPnl: number; realizedPnl: number;
    trend: { value: number; time: string }[];
  };
  holdings: Holding[]; orders: Order[];
  leaderboard: { rank: number; displayName: string; returnPercent: number; isSelf: boolean }[];
  rules: { initialCash: number; charges: number; slippage: number; limitBandPercent: number };
};

const istTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
});

function formatAmount(value: number) {
  return inr.format(value);
}

function trendPoints(quote: Quote, range: string): string {
  const count = range === "1D" ? 16 : range === "1W" ? 12 : 18;
  const spread = Math.max(quote.high - quote.low, quote.price * 0.006);
  const values = Array.from({ length: count }, (_, index) => {
    const wave = Math.sin((index / (count - 1)) * Math.PI * 2) * spread * 0.24;
    const drift = ((index / (count - 1)) - 0.5) * quote.change;
    return quote.close + wave + drift;
  });
  const min = Math.min(...values, quote.low);
  const max = Math.max(...values, quote.high);
  const span = max - min || 1;
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 92 - ((value - min) / span) * 80;
    return `${x},${y}`;
  }).join(" ");
}

function portfolioTrendPoints(trend: Dashboard["portfolio"]["trend"], currentValue: number): string {
  const values = trend.length ? trend.map((point) => point.value) : [currentValue];
  if (values.length === 1) values.push(currentValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value, index) =>
    `${(index / (values.length - 1)) * 100},${86 - ((value - min) / span) * 65}`,
  ).join(" ");
}

export default function AccountPage() {
  const router = useRouter();
  const authFetch = useAuthApi();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deletionRequested, setDeletionRequested] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [range, setRange] = useState("1D");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [product, setProduct] = useState<"delivery" | "intraday">("delivery");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [quantity, setQuantity] = useState(1);
  const [limitPrice, setLimitPrice] = useState("");

  const loadDashboard = useCallback(async () => {
    setError("");
    try {
      const response = await authFetch("/v1/practice/dashboard");
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) throw new Error("Dashboard service unavailable.");
      const data = await response.json() as Dashboard;
      setDashboard(data);
      setSelectedSymbol((current) => current || data.market.quotes[0]?.symbol || "");
    } catch {
      setError("Unable to load your practice workspace. Confirm the API and database are running, then retry.");
    } finally {
      setLoading(false);
    }
  }, [authFetch, router]);

  useEffect(() => {
    let active = true;
    void authFetch("/v1/practice/dashboard").then(async (response) => {
      if (response.status === 401) {
        router.replace("/login");
        return null;
      }
      if (!response.ok) throw new Error("Dashboard service unavailable.");
      return response.json() as Promise<Dashboard>;
    }).then((data) => {
      if (!active || !data) return;
      setDashboard(data);
      setSelectedSymbol(data.market.quotes[0]?.symbol ?? "");
    }).catch(() => {
      if (!active) return;
      setError("Unable to load your practice workspace. Confirm the API and database are running, then retry.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [authFetch, router]);

  const selectedQuote = dashboard?.market.quotes.find((quote) => quote.symbol === selectedSymbol) ?? dashboard?.market.quotes[0];
  const visibleQuotes = useMemo(() => {
    if (!dashboard) return [];
    const query = search.trim().toLowerCase();
    return dashboard.market.quotes.filter((quote) =>
      !query || quote.symbol.toLowerCase().includes(query) || quote.name.toLowerCase().includes(query));
  }, [dashboard, search]);
  const parsedLimit = Number(limitPrice);
  const estimatedValue = selectedQuote
    ? (orderType === "limit" && parsedLimit > 0 ? parsedLimit : selectedQuote.price) * quantity
    : 0;

  async function submitOrder(
    event?: FormEvent<HTMLFormElement>,
    quantityOverride?: number,
    selectedSide?: "buy" | "sell",
    symbolOverride?: string,
    orderTypeOverride?: "market" | "limit",
  ) {
    event?.preventDefault();
    const executionQuote = dashboard?.market.quotes.find((quote) => quote.symbol === (symbolOverride ?? selectedSymbol));
    const executionType = orderTypeOverride ?? orderType;
    if (!executionQuote || !Number.isInteger(quantityOverride ?? quantity) || (quantityOverride ?? quantity) < 1) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await authFetch("/v1/practice/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: executionQuote.symbol,
          side: selectedSide ?? side,
          product,
          orderType: executionType,
          quantity: quantityOverride ?? quantity,
          ...(executionType === "limit" ? { limitPrice: parsedLimit } : {}),
        }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Order could not be submitted.");
      setNotice(result.message ?? "Order submitted.");
      await loadDashboard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Order could not be submitted.");
    } finally {
      setPending(false);
    }
  }

  async function cancelOrder(orderId: string) {
    setPending(true);
    setError("");
    try {
      const response = await authFetch(`/v1/practice/orders/${encodeURIComponent(orderId)}`, {
        method: "DELETE",
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Order could not be cancelled.");
      setNotice(result.message ?? "Order cancelled.");
      await loadDashboard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Order could not be cancelled.");
    } finally {
      setPending(false);
    }
  }

  async function setLeaderboard(enabled: boolean) {
    setPending(true);
    setError("");
    try {
      const response = await authFetch("/v1/practice/leaderboard", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error("Leaderboard preference could not be saved.");
      await loadDashboard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Leaderboard preference could not be saved.");
    } finally {
      setPending(false);
    }
  }

  async function resetPortfolio() {
    const confirmed = window.confirm(
      "Reset your practice portfolio to ₹1,00,000? This permanently removes all holdings, orders, and performance history. This cannot be undone.",
    );
    if (!confirmed) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await authFetch("/v1/practice/reset", { method: "POST" });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message ?? "Portfolio reset failed.");
      setNotice(result.message ?? "Practice portfolio reset.");
      await loadDashboard();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Portfolio reset failed.");
    } finally {
      setPending(false);
    }
  }

  async function logout() {
    setPending(true);
    try {
      const response = await authFetch("/v1/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign-out request failed.");
      router.replace("/login");
    } catch {
      setError("Unable to sign out right now. Try again.");
      setPending(false);
    }
  }

  async function requestDeletion() {
    const confirmed = window.confirm(
      "Request account deletion? Sign-in will be disabled and your active session revoked. Data erasure is completed separately and this request cannot be undone.",
    );
    if (!confirmed) return;
    setPending(true);
    setError("");
    try {
      const response = await authFetch("/v1/auth/account", { method: "DELETE" });
      if (!response.ok) throw new Error("Account deletion request failed.");
      setDeletionRequested(true);
      setDashboard(null);
    } catch {
      setError("Unable to submit the account deletion request right now. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (deletionRequested) {
    return (
      <main className="xodash-loading">
        <h1>Deletion request received.</h1>
        <p>Your sign-in has been disabled. A separate process must complete data erasure.</p>
        <Link href="/login">Return to log in</Link>
      </main>
    );
  }

  if (loading) return <main className="xodash-loading" role="status">Loading your practice workspace...</main>;
  if (!dashboard) {
    return (
      <main className="xodash-loading">
        <p>{error || "Your practice workspace could not be loaded."}</p>
        <button className="xodash-button" onClick={() => { setLoading(true); void loadDashboard(); }} type="button">Try again</button>
        <Link href="/login">Return to log in</Link>
      </main>
    );
  }

  const portfolio = dashboard.portfolio;
  return (
    <main className="xodash">
      <header className="xodash-header">
        <Link className="xodash-brand" href="/"><span aria-hidden="true">X</span> XOCRISK</Link>
        <nav aria-label="Workspace navigation" className="xodash-nav">
          <a href="#markets">Markets</a><a href="#holdings">Holdings</a><a href="#orders">Orders</a>
          <button className="xodash-button xodash-button-light" disabled={pending} onClick={logout} type="button">Sign out</button>
        </nav>
      </header>
      <section className="xodash-welcome">
        <div>
          <p className="xodash-eyebrow">YOUR PRACTICE WORKSPACE</p>
          <h1>Welcome{dashboard.user.fullName ? `, ${dashboard.user.fullName.split(" ")[0]}` : " back"}.</h1>
          <p>Explore market mechanics and practice with virtual funds. No real money is involved.</p>
        </div>
        <div className={dashboard.market.status.isOpen ? "xodash-demo-badge xodash-market-open" : "xodash-demo-badge"}
          title={dashboard.market.lastUpdatedAt ? `Prices updated ${istTime.format(new Date(dashboard.market.lastUpdatedAt))} IST` : undefined}>
          <i /> NSE <span>·</span>{" "}
          {dashboard.market.status.isOpen
            ? <>MARKET OPEN <span>·</span> CLOSES {istTime.format(new Date(dashboard.market.status.nextChangeAt)).toUpperCase()}</>
            : <>MARKET CLOSED <span>·</span> OPENS {istTime.format(new Date(dashboard.market.status.nextChangeAt)).toUpperCase()}</>}
          {" "}<span>·</span> PRICES DELAYED ~10 MIN
        </div>
      </section>

      {error && <p aria-live="polite" className="xodash-feedback xodash-error">{error}</p>}
      {notice && <p aria-live="polite" className="xodash-feedback xodash-notice">{notice}</p>}

      <section aria-label="Portfolio summary" className="xodash-summary">
        <article className="xodash-value-card">
          <span>Total portfolio value</span><strong>{formatAmount(portfolio.totalValue)}</strong>
          <small className={portfolio.dayChange >= 0 ? "xodash-positive" : "xodash-negative"}>
            {portfolio.dayChange >= 0 ? "+" : ""}{formatAmount(portfolio.dayChange)} ({portfolio.dayChangePercent.toFixed(2)}%) today
          </small>
          <svg aria-label="Current session portfolio value trend" className="xodash-portfolio-trend" role="img" viewBox="0 0 100 100">
            <polyline points={portfolioTrendPoints(portfolio.trend, portfolio.totalValue)} />
          </svg>
        </article>
        <article><span>Available cash</span><strong>{formatAmount(portfolio.availableCash)}</strong><small>After open buy orders</small></article>
        <article><span>Invested value</span><strong>{formatAmount(portfolio.investedValue)}</strong><small>At delayed market prices</small></article>
        <article><span>Unrealized P&amp;L</span><strong className={portfolio.unrealizedPnl >= 0 ? "xodash-positive" : "xodash-negative"}>{formatAmount(portfolio.unrealizedPnl)}</strong><small>Open positions</small></article>
        <article><span>Realized P&amp;L</span><strong className={portfolio.realizedPnl >= 0 ? "xodash-positive" : "xodash-negative"}>{formatAmount(portfolio.realizedPnl)}</strong><small>Closed positions</small></article>
      </section>

      <div className="xodash-workspace">
        <div className="xodash-main-column">
          <section className="xodash-panel" id="markets">
            <div className="xodash-panel-heading">
              <div><p className="xodash-eyebrow">DISCOVER</p><h2>Markets</h2></div>
              <span className="xodash-market-note">Sample reference prices · not live</span>
            </div>
            <label className="xodash-search">
              <span className="sr-only">Search supported stocks</span>
              <input onChange={(event) => setSearch(event.target.value)} placeholder="Search symbol or company" value={search} />
            </label>
            <div className="xodash-watchlist">
              {visibleQuotes.map((quote) => (
                <button aria-pressed={selectedQuote?.symbol === quote.symbol} className="xodash-quote-row"
                  key={quote.symbol} onClick={() => setSelectedSymbol(quote.symbol)} type="button">
                  <span><strong>{quote.symbol}</strong><small>{quote.name}</small></span>
                  <span className="xodash-quote-price">{formatAmount(quote.price)}
                    <small className={quote.change >= 0 ? "xodash-positive" : "xodash-negative"}>
                      {quote.change >= 0 ? "+" : ""}{formatAmount(quote.change)} ({quote.changePercent.toFixed(2)}%)
                    </small>
                  </span>
                </button>
              ))}
              {visibleQuotes.length === 0 && <p className="xodash-empty">No supported stocks match that search.</p>}
            </div>
          </section>

          {selectedQuote && (
            <section aria-label={`${selectedQuote.name} market information`} className="xodash-panel xodash-chart-panel">
              <div className="xodash-panel-heading">
                <div><p className="xodash-eyebrow">{selectedQuote.symbol} · NSE · DELAYED</p><h2>{selectedQuote.name}</h2></div>
                <div className="xodash-chart-price">{formatAmount(selectedQuote.price)}
                  <small className={selectedQuote.change >= 0 ? "xodash-positive" : "xodash-negative"}>
                    {selectedQuote.change >= 0 ? "+" : ""}{formatAmount(selectedQuote.change)} ({selectedQuote.changePercent.toFixed(2)}%)
                  </small>
                </div>
              </div>
              <div aria-label="Illustrative sample chart, not historical market data" className="xodash-chart">
                <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 100">
                  <line x1="0" x2="100" y1="20" y2="20" /><line x1="0" x2="100" y1="50" y2="50" />
                  <line x1="0" x2="100" y1="80" y2="80" />
                  <polyline points={trendPoints(selectedQuote, range)} />
                </svg>
              </div>
              <div className="xodash-chart-footer">
                <span>Illustrative chart · not historical prices</span>
                <div aria-label="Chart time range" className="xodash-range">
                  {["1D", "1W", "1M"].map((item) => (
                    <button aria-pressed={range === item} key={item} onClick={() => setRange(item)} type="button">{item}</button>
                  ))}
                </div>
              </div>
              <div className="xodash-ohlc">
                <span>Open <b>{selectedQuote.open === null ? "—" : formatAmount(selectedQuote.open)}</b></span>
                <span>High <b>{formatAmount(selectedQuote.high)}</b></span>
                <span>Low <b>{formatAmount(selectedQuote.low)}</b></span>
                <span>Previous close <b>{formatAmount(selectedQuote.close)}</b></span>
              </div>
            </section>
          )}

          <section className="xodash-panel" id="holdings">
            <div className="xodash-panel-heading"><div><p className="xodash-eyebrow">YOUR POSITIONS</p><h2>Holdings</h2></div></div>
            {dashboard.holdings.length ? (
              <div className="xodash-table-wrap"><table>
                <thead><tr><th>Stock</th><th>Qty</th><th>Avg. cost</th><th>Last price</th><th>Current value</th><th>P&amp;L</th><th /></tr></thead>
                <tbody>{dashboard.holdings.map((holding) => (
                  <tr key={holding.symbol}>
                    <td><button className="xodash-table-link" onClick={() => setSelectedSymbol(holding.symbol)} type="button">{holding.symbol}</button><small>{holding.name}</small></td>
                    <td>{holding.quantity}</td><td>{formatAmount(holding.averageCost)}</td><td>{formatAmount(holding.lastPrice)}</td>
                    <td>{formatAmount(holding.currentValue)}</td>
                    <td className={holding.unrealizedPnl >= 0 ? "xodash-positive" : "xodash-negative"}>{formatAmount(holding.unrealizedPnl)}</td>
                    <td><button className="xodash-text-button" disabled={pending} onClick={() => {
                      setSide("sell");
                      setOrderType("market");
                      void submitOrder(undefined, holding.quantity, "sell", holding.symbol, "market");
                    }} type="button">Exit</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <p className="xodash-empty">No holdings yet. Choose a stock and place a small practice order to get started.</p>}
          </section>

          <section className="xodash-panel" id="orders">
            <div className="xodash-panel-heading"><div><p className="xodash-eyebrow">ACTIVITY</p><h2>Order history</h2></div></div>
            {dashboard.orders.length ? (
              <div className="xodash-table-wrap"><table>
                <thead><tr><th>Time</th><th>Stock</th><th>Side</th><th>Qty</th><th>Order / fill price</th><th>Product</th><th>Status</th><th /></tr></thead>
                <tbody>{dashboard.orders.map((order) => (
                  <tr key={order.id}>
                    <td>{new Date(order.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td><button className="xodash-table-link" onClick={() => setSelectedSymbol(order.symbol)} type="button">{order.symbol}</button></td>
                    <td className={order.side === "buy" ? "xodash-positive" : "xodash-negative"}>{order.side}</td>
                    <td>{order.quantity}</td>
                    <td>{formatAmount(order.fillPrice ?? order.limitPrice ?? 0)}</td><td>{order.product}</td>
                    <td><span className={`xodash-status xodash-status-${order.status}`}
                      title={order.rejectionReason ?? undefined}>{order.status}</span>
                      {order.rejectionReason && <small>{order.rejectionReason}</small>}
                    </td>
                    <td>{order.status === "open" && <button className="xodash-text-button" disabled={pending} onClick={() => void cancelOrder(order.id)} type="button">Cancel</button>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            ) : <p className="xodash-empty">Your submitted practice orders will appear here.</p>}
          </section>
        </div>

        <aside className="xodash-side-column">
          <section className="xodash-panel xodash-order-panel">
            <div className="xodash-panel-heading"><div><p className="xodash-eyebrow">PRACTICE ONLY</p><h2>Place an order</h2></div></div>
            <form className="xodash-order-form" onSubmit={(event) => void submitOrder(event)}>
              <div aria-label="Order side" className="xodash-segment">
                {(["buy", "sell"] as const).map((value) => (
                  <button aria-pressed={side === value} className={side === value ? `is-${value}` : ""}
                    key={value} onClick={() => setSide(value)} type="button">{value}</button>
                ))}
              </div>
              <label>Stock
                <select onChange={(event) => setSelectedSymbol(event.target.value)} value={selectedQuote?.symbol ?? ""}>
                  {dashboard.market.quotes.map((quote) => <option key={quote.symbol} value={quote.symbol}>{quote.symbol} · {quote.name}</option>)}
                </select>
              </label>
              <div className="xodash-form-grid">
                <label>Product<select onChange={(event) => setProduct(event.target.value as "delivery" | "intraday")} value={product}>
                  <option value="delivery">Delivery</option><option value="intraday">Intraday</option>
                </select></label>
                <label>Order type<select onChange={(event) => setOrderType(event.target.value as "market" | "limit")} value={orderType}>
                  <option value="market">Market</option><option value="limit">Limit</option>
                </select></label>
              </div>
              <label>Quantity (shares)<input min="1" onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
                step="1" type="number" value={quantity} /></label>
              {orderType === "limit" && <label>Limit price (₹)<input min="0.01" onChange={(event) => setLimitPrice(event.target.value)}
                step="0.01" type="number" value={limitPrice} /></label>}
              <div className="xodash-estimate">
                <span>Reference price <b>{selectedQuote ? formatAmount(selectedQuote.price) : "—"}</b></span>
                <span>Estimated order value <b>{formatAmount(estimatedValue)}</b></span>
                <span>Practice charges <b>{formatAmount(0)}</b></span>
                <span>{side === "buy" ? "Estimated payable" : "Estimated receivable"} <b>{formatAmount(estimatedValue)}</b></span>
                <span>Available cash <b>{formatAmount(portfolio.availableCash)}</b></span>
              </div>
              <p className="xodash-rule-note">Zero practice charges and slippage. Limit prices must be within 20% of reference price.</p>
              <button className={`xodash-submit ${side === "sell" ? "sell" : ""}`} disabled={pending || (side === "buy" && estimatedValue > portfolio.availableCash)}
                type="submit">{pending ? "Processing..." : `${side === "buy" ? "Buy" : "Sell"} ${selectedQuote?.symbol ?? "stock"}`}</button>
            </form>
          </section>

          <section className="xodash-panel">
            <div className="xodash-panel-heading"><div><p className="xodash-eyebrow">LEARN AS YOU PRACTICE</p><h2>Next step</h2></div></div>
            <div className="xodash-learning">
              {dashboard.orders.length === 0
                ? "Start with one small practice order. Before you place it, write down why you chose this stock and what would make you exit."
                : dashboard.holdings.length > 0
                  ? "Review your open positions and check how much of your practice portfolio is concentrated in each stock."
                  : "Review your completed orders. Compare your reason for entering and exiting with the outcome."}
            </div>
            <p className="xodash-disclaimer">Educational guidance only, not personalized financial advice or a promise of results.</p>
          </section>

          <section className="xodash-panel">
            <div className="xodash-panel-heading"><div><p className="xodash-eyebrow">PEER LEARNING</p><h2>College leaderboard</h2></div></div>
            {!dashboard.user.college ? <p className="xodash-empty">A college cohort is not available for this account.</p> : (
              <>
                <label className="xodash-opt-in"><input checked={dashboard.user.leaderboardOptIn}
                  disabled={pending} onChange={(event) => void setLeaderboard(event.target.checked)} type="checkbox" />
                  Include my display name and practice return in my college leaderboard.</label>
                {dashboard.user.leaderboardOptIn && (
                  dashboard.leaderboard.length ? <ol className="xodash-leaderboard">
                    {dashboard.leaderboard.map((entry) => <li className={entry.isSelf ? "is-self" : ""} key={`${entry.rank}-${entry.displayName}`}>
                      <span><b>#{entry.rank}</b> {entry.displayName}{entry.isSelf && <small>YOU</small>}</span>
                      <strong className={entry.returnPercent >= 0 ? "xodash-positive" : "xodash-negative"}>{entry.returnPercent >= 0 ? "+" : ""}{entry.returnPercent.toFixed(2)}%</strong>
                    </li>)}
                  </ol> : <p className="xodash-empty">No opted-in classmates are ranked yet.</p>
                )}
                <p className="xodash-disclaimer">Only opted-in learners in your college cohort appear. Return is based on practice portfolio value.</p>
              </>
            )}
          </section>

          <section className="xodash-reset">
            <div>
              <strong>Start over?</strong><p>Reset your virtual cash, holdings, orders, and performance history.</p>
              <button className="xodash-delete-account" disabled={pending} onClick={() => void requestDeletion()} type="button">Request account deletion</button>
            </div>
            <button disabled={pending} onClick={() => void resetPortfolio()} type="button">Reset portfolio</button>
          </section>
        </aside>
      </div>
      <footer className="xodash-footer">XOCRISK · Practice only. No broker connection, deposits, or withdrawals.</footer>
    </main>
  );
}
