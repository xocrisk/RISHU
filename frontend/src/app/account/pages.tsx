"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuthApi } from "../../lib/auth-session";
import { count, istDateTime, istDayFullYear, money, num, percent, price, rupeesShort, shortNumber, signed, tone } from "./format";
import type { Chart, Dashboard, Holding, Order, Quote, Side } from "./types";
import { Change, Empty, HoldingsView, LeaderboardView, PositionsView, StockView, type Trade } from "./views";
import { SideIcon } from "./trade-icons";
import Watchlist from "./watchlist";

/* ------------------------------------------------------------------ shared bits */

const iconColors = ["#b8862f", "#2563eb", "#0d9488", "#7c3aed", "#db2777", "#ea580c", "#0891b2", "#4d7c0f"];

export function StockIcon({ symbol, size = 36 }: { symbol: string; size?: number }) {
  const hue = iconColors[[...symbol].reduce((total, char) => total + char.charCodeAt(0), 0) % iconColors.length];
  const letters = symbol.replace(/[^A-Z0-9]/g, "").slice(0, 2) || "•";
  return (
    <span aria-hidden="true" className="xq-icon" style={{ width: size, height: size, background: `${hue}18`, color: hue, fontSize: size * 0.34 }}>
      {letters}
    </span>
  );
}

// Sparklines are reused for 5 minutes so moving between pages doesn't refetch every card.
const sparkCache = new Map<string, { at: number; points: number[] }>();
const sparkTtlMs = 5 * 60_000;

/** Intraday sparkline for a card, from the cached chart endpoint. */
function MiniChart({ symbol, up }: { symbol: string; up: boolean }) {
  const authFetch = useAuthApi();
  const [points, setPoints] = useState<number[]>(() => sparkCache.get(symbol)?.points ?? []);
  useEffect(() => {
    const cached = sparkCache.get(symbol);
    if (cached && Date.now() - cached.at < sparkTtlMs) return;
    let active = true;
    authFetch(`/v1/market/chart?symbol=${encodeURIComponent(symbol)}&range=1D`)
      .then((response) => (response.ok ? response.json() as Promise<Chart> : null))
      .then((chart) => {
        if (!chart) return;
        const closes = chart.candles.map((candle) => candle.close);
        sparkCache.set(symbol, { at: Date.now(), points: closes });
        if (active) setPoints(closes);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [authFetch, symbol]);
  if (points.length < 2) return <div className="xq-mini placeholder" />;
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const path = points.map((value, index) => `${index ? "L" : "M"}${((index / (points.length - 1)) * 100).toFixed(2)},${(46 - ((value - min) / span) * 40).toFixed(2)}`).join(" ");
  const color = up ? "var(--up)" : "var(--down)";
  return (
    <svg aria-hidden="true" className="xq-mini" preserveAspectRatio="none" viewBox="0 0 100 50">
      <defs>
        <linearGradient id={`mini-${symbol.replace(/\W/g, "")}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity=".22" /><stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L100,50 L0,50 Z`} fill={`url(#mini-${symbol.replace(/\W/g, "")})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function ago(iso: string | null, now: number) {
  if (!iso) return "—";
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return istDateTime.format(new Date(iso));
}

/* ------------------------------------------------------------------ Dashboard */

type Filter = "all" | "nifty50" | "gainers" | "losers" | "holdings";
type Sort = { key: "name" | "price" | "changePercent" | "change" | "volume"; dir: 1 | -1 } | null;
const featured = ["RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK", "BHARTIARTL", "SBIN"];

export function DashboardView({ data, nifty50, holdings, onOpen, onTrade }: {
  data: Dashboard; nifty50: Set<string>; holdings: Map<string, Holding>; onOpen: (symbol: string) => void; onTrade: Trade;
}) {
  const now = useNow();
  const { market, portfolio } = data;
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>(null);
  const [limit, setLimit] = useState(25);
  const bySymbol = useMemo(() => new Map(market.quotes.map((quote) => [quote.symbol, quote])), [market.quotes]);
  const cards = [...market.indices, ...featured.flatMap((symbol) => bySymbol.get(symbol) ?? [])];

  const rows = useMemo(() => {
    let list = market.quotes;
    if (filter === "nifty50") list = list.filter((quote) => nifty50.has(quote.symbol));
    if (filter === "gainers") list = list.filter((quote) => quote.change > 0).sort((a, b) => b.changePercent - a.changePercent);
    if (filter === "losers") list = list.filter((quote) => quote.change < 0).sort((a, b) => a.changePercent - b.changePercent);
    if (filter === "holdings") list = list.filter((quote) => holdings.has(quote.symbol));
    if (sort) {
      list = [...list].sort((a, b) => (sort.key === "name" ? a.symbol.localeCompare(b.symbol) : a[sort.key] - b[sort.key]) * sort.dir);
    }
    return list;
  }, [market.quotes, filter, sort, nifty50, holdings]);

  function sortBy(key: NonNullable<Sort>["key"]) {
    setSort((current) => (current?.key === key ? (current.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 }));
  }
  const arrow = (key: NonNullable<Sort>["key"]) => (sort?.key === key ? (sort.dir === -1 ? "↓" : "↑") : "↕");
  const invested = data.holdings.reduce((total, h) => total + h.averageCost * h.quantity, 0);

  return (
    <div className="xq-page">
      <p className="xq-updated"><i className={market.status.isOpen ? "live" : ""} />Last update: <b>{ago(market.lastUpdatedAt, now)}</b></p>
      <h1 className="xq-hero">Live Market <br />Updates <span aria-hidden="true">◐</span></h1>

      <div aria-label="Live market cards" className="xq-cards-row">
        {cards.map((quote) => {
          const isIndex = quote.industry === "Index";
          return (
            <article className="xq-live-card" key={quote.symbol}>
              <header>
                <StockIcon symbol={quote.symbol} size={44} />
                <div><small>{quote.symbol}{isIndex ? "" : "/NSE"}</small><strong>{quote.name}</strong></div>
                <CardMenu isIndex={isIndex} onOpen={() => onOpen(quote.symbol)} onTrade={(side) => onTrade({ symbol: quote.symbol, side })} />
              </header>
              <span className="xq-label">Price</span>
              <button className="xq-live-price" onClick={() => onOpen(quote.symbol)} type="button">{isIndex ? "" : "₹"}{price(quote.price)}</button>
              <div className="xq-live-change">
                <span className={`xq-trend ${tone(quote.change)}`}>{quote.change >= 0 ? "↗" : "↘"}</span>
                <span className={`xq-pill ${tone(quote.change)}`}>{percent(quote.changePercent)}</span>
              </div>
              <MiniChart symbol={quote.symbol} up={quote.change >= 0} />
            </article>
          );
        })}
      </div>

      <section aria-label="Your portfolio" className="xq-snapshot">
        <div><span>Account value</span><strong>{money(portfolio.totalValue)}</strong></div>
        <div><span>Available to trade</span><strong>{money(portfolio.availableCash)}</strong></div>
        <div><span>Invested</span><strong>{money(invested)}</strong></div>
        <div><span>Holdings P&amp;L</span><strong><Change value={portfolio.unrealizedPnl} /></strong></div>
        <div><span>Today</span><strong><Change pct={portfolio.dayChangePercent} value={portfolio.dayChange} /></strong></div>
      </section>

      <section className="xq-panel">
        <div className="xq-panel-head">
          <div><p className="xq-kicker"><span aria-hidden="true">◷</span> Live Updates</p><h2>Market Overview</h2></div>
          <div className="xq-pills" role="tablist">
            {([["all", "All"], ["nifty50", "Nifty 50"], ["gainers", "Gainers"], ["losers", "Losers"], ["holdings", "My holdings"]] as const).map(([value, label]) => (
              <button aria-selected={filter === value} key={value} onClick={() => { setFilter(value); setLimit(25); }} role="tab" type="button">{label}</button>
            ))}
          </div>
        </div>
        {rows.length ? (
          <div className="xq-table-wrap">
            <table className="xq-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th><button onClick={() => sortBy("name")} type="button">Stock name {arrow("name")}</button></th>
                  <th className="r"><button onClick={() => sortBy("price")} type="button">Price {arrow("price")}</button></th>
                  <th className="r"><button onClick={() => sortBy("changePercent")} type="button">1D% {arrow("changePercent")}</button></th>
                  <th className="r"><button onClick={() => sortBy("change")} type="button">Change {arrow("change")}</button></th>
                  <th className="r hide-sm">Day range</th>
                  <th className="r hide-sm"><button onClick={() => sortBy("volume")} type="button">Volume {arrow("volume")}</button></th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((quote, index) => (
                  <tr key={quote.symbol}>
                    <td className="xq-muted">#{index + 1}</td>
                    <td>
                      <button className="xq-name-cell" onClick={() => onOpen(quote.symbol)} type="button">
                        <StockIcon symbol={quote.symbol} size={30} /><b>{quote.name.replace(/ Ltd\.?$/, "")}</b><small>{quote.symbol}</small>
                      </button>
                    </td>
                    <td className="r">₹{price(quote.price)}</td>
                    <td className="r"><span className={`xq-pill ${tone(quote.change)}`}>{percent(quote.changePercent)}</span></td>
                    <td className={`r ${tone(quote.change)}`}>{signed(quote.change, price)}</td>
                    <td className="r hide-sm xq-muted">{price(quote.low)} – {price(quote.high)}</td>
                    <td className="r hide-sm xq-muted">{quote.volume ? shortNumber(quote.volume) : "—"}</td>
                    <td className="r">
                      <span className="xq-row-actions">
                        <button className="xq-chip buy" onClick={() => onTrade({ symbol: quote.symbol, side: "buy" })} type="button"><SideIcon side="buy" size={12} />Buy</button>
                        <button className="xq-chip sell" onClick={() => onTrade({ symbol: quote.symbol, side: "sell", quantity: holdings.get(quote.symbol)?.quantity })} type="button"><SideIcon side="sell" size={12} />Sell</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > limit && (
              <button className="xq-more" onClick={() => setLimit((current) => current + 50)} type="button">Show more ({rows.length - limit} left)</button>
            )}
          </div>
        ) : <Empty title={filter === "holdings" ? "You don't hold any stocks yet" : "Nothing to show"} />}
      </section>
    </div>
  );
}

function CardMenu({ isIndex, onOpen, onTrade }: { isIndex: boolean; onOpen: () => void; onTrade: (side: Side) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="xq-card-menu" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button aria-expanded={open} aria-label="More actions" onClick={() => setOpen((value) => !value)} type="button">⋮</button>
      {open && (
        <div role="menu">
          <button onClick={() => { setOpen(false); onOpen(); }} role="menuitem" type="button">View chart</button>
          {!isIndex && <button onClick={() => { setOpen(false); onTrade("buy"); }} role="menuitem" type="button">Buy</button>}
          {!isIndex && <button onClick={() => { setOpen(false); onTrade("sell"); }} role="menuitem" type="button">Sell</button>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Portfolio */

export function PortfolioView({ data, quotes, onOpen, onTrade }: {
  data: Dashboard; quotes: Map<string, Quote>; onOpen: (symbol: string) => void; onTrade: Trade;
}) {
  const [view, setView] = useState<"holdings" | "positions">("holdings");
  return (
    <div className="xq-page">
      <div className="xq-pills standalone" role="tablist">
        <button aria-selected={view === "holdings"} onClick={() => setView("holdings")} role="tab" type="button">Holdings ({data.holdings.length})</button>
        <button aria-selected={view === "positions"} onClick={() => setView("positions")} role="tab" type="button">Positions</button>
      </div>
      {view === "holdings"
        ? <HoldingsView holdings={data.holdings} onOpen={onOpen} onTrade={onTrade} quotes={quotes} />
        : <PositionsView onOpen={onOpen} onTrade={onTrade} orders={data.orders} quotes={quotes} />}
    </div>
  );
}

/* ------------------------------------------------------------------ Trade */

export function TradeView({ data, nifty50, starred, quote, isIndex, holding, onToggleStar, onOpen, onTrade }: {
  data: Dashboard; nifty50: Set<string>; starred: string[]; quote?: Quote; isIndex: boolean; holding?: Holding;
  onToggleStar: (symbol: string) => void; onOpen: (symbol: string) => void; onTrade: Trade;
}) {
  return (
    <div className="xq-trade">
      <div className="xq-trade-list xq-panel flush">
        <Watchlist nifty50={nifty50} onSelect={onOpen} onToggleStar={onToggleStar}
          onTrade={(symbol, side) => onTrade({ symbol, side })} quotes={data.market.quotes} selected={quote?.symbol ?? null} starred={starred} />
      </div>
      <div className="xq-trade-main">
        {quote ? <StockView holding={holding} isIndex={isIndex} onTrade={onTrade} quote={quote} /> : <Empty title="Pick a stock to trade" />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Insights */

export function InsightsView({ data, quotes, pending, onToggleLeaderboard, onOpen }: {
  data: Dashboard; quotes: Map<string, Quote>; pending: boolean; onToggleLeaderboard: (enabled: boolean) => void; onOpen: (symbol: string) => void;
}) {
  const { portfolio, holdings, orders, market } = data;
  const tips: { tone: "good" | "warn" | "info"; title: string; body: string; symbol?: string }[] = [];
  const largest = [...holdings].sort((a, b) => b.currentValue - a.currentValue)[0];
  if (largest && portfolio.totalValue > 0) {
    const share = (largest.currentValue / portfolio.totalValue) * 100;
    if (share > 40) tips.push({ tone: "warn", title: `${largest.symbol} is ${share.toFixed(0)}% of your account`, body: "One stock carries most of your risk. Spreading across 5–8 stocks from different sectors reduces how much a single bad day can hurt.", symbol: largest.symbol });
  }
  const idle = portfolio.totalValue ? (portfolio.availableCash / portfolio.totalValue) * 100 : 0;
  if (idle > 80) tips.push({ tone: "info", title: `${idle.toFixed(0)}% of your money is sitting in cash`, body: "That's fine while you learn. Try a small position in a NIFTY 50 stock you understand and track it for a week." });
  const losers = holdings.filter((h) => h.unrealizedPnl < 0);
  if (losers.length) tips.push({ tone: "warn", title: `${losers.length} of ${holdings.length} holdings are in loss`, body: `Biggest drag: ${[...losers].sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)[0].symbol}. Decide in advance the price at which you'd exit, and write down why.`, symbol: [...losers].sort((a, b) => a.unrealizedPnl - b.unrealizedPnl)[0].symbol });
  const winners = holdings.filter((h) => h.unrealizedPnl > 0);
  if (winners.length) tips.push({ tone: "good", title: `${winners.length} holding${winners.length > 1 ? "s are" : " is"} in profit`, body: "Consider booking part of a winner if it has run far above your plan, and let the rest ride." });
  const openOrders = orders.filter((order) => order.status === "open");
  if (openOrders.length) tips.push({ tone: "info", title: `${openOrders.length} limit order${openOrders.length > 1 ? "s are" : " is"} waiting`, body: market.status.isOpen ? "They fill as soon as the price reaches your limit." : `They'll be checked when NSE opens on ${istDateTime.format(new Date(market.status.nextChangeAt))}.` });
  const rejected = orders.filter((order) => order.status === "rejected").length;
  if (rejected) tips.push({ tone: "info", title: `${rejected} order${rejected > 1 ? "s were" : " was"} rejected`, body: "Check Transactions to see why. Most rejections are market orders placed outside 9:15 AM – 3:30 PM IST, or not enough cash." });
  if (!orders.length) tips.push({ tone: "info", title: "Place your first practice trade", body: "Open Trade, pick a NIFTY 50 stock and buy a small quantity. Every order teaches you how prices and fills behave." });

  return (
    <div className="xq-page">
      <div className="xq-page-head"><h1>Insights</h1><span className="xq-muted">Personal pointers from your practice account</span></div>
      <div className="xq-insights">
        {tips.map((tip) => (
          <article className={`xq-insight ${tip.tone}`} key={tip.title}>
            <span aria-hidden="true">{tip.tone === "good" ? "▲" : tip.tone === "warn" ? "!" : "i"}</span>
            <div>
              <h3>{tip.title}</h3>
              <p>{tip.body}</p>
              {tip.symbol && quotes.has(tip.symbol) && <button className="xq-link" onClick={() => onOpen(tip.symbol!)} type="button">Open {tip.symbol} →</button>}
            </div>
          </article>
        ))}
      </div>
      <LeaderboardView data={data} onToggle={onToggleLeaderboard} pending={pending} />
    </div>
  );
}

/* ------------------------------------------------------------------ Analytics */

function Bars({ rows, format }: { rows: { label: string; value: number; note?: string }[]; format: (value: number) => string }) {
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  return (
    <ul className="xq-bars">
      {rows.map((row) => (
        <li key={row.label}>
          <span className="xq-bar-label">{row.label}{row.note && <small>{row.note}</small>}</span>
          <span className="xq-bar-track"><i className={tone(row.value)} style={{ width: `${(Math.abs(row.value) / max) * 100}%` }} /></span>
          <b className="xq-bar-value">{format(row.value)}</b>
        </li>
      ))}
    </ul>
  );
}

function tradeStats(orders: Order[]) {
  const filled = orders.filter((order) => order.status === "filled");
  const buys = filled.filter((order) => order.side === "buy");
  const sells = filled.filter((order) => order.side === "sell");
  const turnover = filled.reduce((total, order) => total + (num(order.fillPrice) ?? 0) * order.quantity, 0);
  return { filled: filled.length, buys: buys.length, sells: sells.length, turnover };
}

export function AnalyticsView({ data, quotes }: { data: Dashboard; quotes: Map<string, Quote> }) {
  const { holdings, portfolio, orders, rules } = data;
  const sectors = new Map<string, number>();
  for (const holding of holdings) {
    const sector = quotes.get(holding.symbol)?.industry ?? "Other";
    sectors.set(sector, (sectors.get(sector) ?? 0) + holding.currentValue);
  }
  const sectorRows = [...sectors.entries()].sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, note: portfolio.investedValue ? `${((value / portfolio.investedValue) * 100).toFixed(1)}%` : undefined }));
  const pnlRows = [...holdings].sort((a, b) => b.unrealizedPnl - a.unrealizedPnl).map((h) => ({ label: h.symbol, value: h.unrealizedPnl }));
  const stats = tradeStats(orders);
  const overall = portfolio.totalValue - (portfolio.referralBonus ?? 0) - rules.initialCash;
  const trend = portfolio.trend.map((point) => point.value);

  return (
    <div className="xq-page">
      <div className="xq-page-head"><h1>Analytics</h1><span className="xq-muted">How your practice portfolio is built and performing</span></div>
      <div className="xq-stat-grid">
        <div><span>Overall return</span><strong className={tone(overall)}>{percent((overall / rules.initialCash) * 100)}</strong><small>{signed(overall)} since start</small></div>
        <div><span>Realised P&amp;L</span><strong className={tone(portfolio.realizedPnl)}>{signed(portfolio.realizedPnl)}</strong><small>From shares you sold</small></div>
        <div><span>Executed trades</span><strong>{count(stats.filled)}</strong><small>{stats.buys} buys · {stats.sells} sells</small></div>
        <div><span>Turnover</span><strong>{money(stats.turnover)}</strong><small>Value of all fills</small></div>
      </div>
      <div className="xq-grid-2">
        <section className="xq-panel">
          <h2 className="xq-panel-title">Sector allocation</h2>
          {sectorRows.length ? <Bars format={money} rows={sectorRows} /> : <Empty title="No holdings to analyse yet" />}
        </section>
        <section className="xq-panel">
          <h2 className="xq-panel-title">Unrealised P&amp;L by stock</h2>
          {pnlRows.length ? <Bars format={(value) => signed(value)} rows={pnlRows} /> : <Empty title="No open positions" />}
        </section>
      </div>
      <section className="xq-panel">
        <h2 className="xq-panel-title">Account value today</h2>
        {trend.length > 1 && Math.max(...trend) - Math.min(...trend) >= 0.01
          ? <Trend values={trend} />
          : <p className="xq-muted">No change in account value yet today. The line fills in as prices move and you trade.</p>}
      </section>
    </div>
  );
}

function Trend({ values }: { values: number[] }) {
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const path = values.map((value, index) => `${index ? "L" : "M"}${(index / (values.length - 1)) * 100},${44 - ((value - min) / span) * 38}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg aria-label="Account value through today" className="xq-trend-line" preserveAspectRatio="none" role="img" viewBox="0 0 100 48">
      <path d={path} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------------------------------------------ Market trends */

export function TrendsView({ data, onOpen, onTrade }: { data: Dashboard; onOpen: (symbol: string) => void; onTrade: Trade }) {
  const quotes = data.market.quotes;
  const gainers = [...quotes].sort((a, b) => b.changePercent - a.changePercent).slice(0, 8);
  const losers = [...quotes].sort((a, b) => a.changePercent - b.changePercent).slice(0, 8);
  const active = [...quotes].sort((a, b) => b.volume * b.price - a.volume * a.price).slice(0, 8);
  const sectorMap = new Map<string, { total: number; count: number }>();
  for (const quote of quotes) {
    const entry = sectorMap.get(quote.industry) ?? { total: 0, count: 0 };
    entry.total += quote.changePercent;
    entry.count += 1;
    sectorMap.set(quote.industry, entry);
  }
  const sectors = [...sectorMap.entries()].map(([label, entry]) => ({ label, value: entry.total / entry.count, note: `${entry.count} stocks` }))
    .sort((a, b) => b.value - a.value);
  const advancing = quotes.filter((quote) => quote.change > 0).length;
  const declining = quotes.filter((quote) => quote.change < 0).length;

  const list = (title: string, rows: Quote[], metric: (quote: Quote) => React.ReactNode) => (
    <section className="xq-panel">
      <h2 className="xq-panel-title">{title}</h2>
      <ul className="xq-list">
        {rows.map((quote) => (
          <li key={quote.symbol}>
            <button className="xq-name-cell" onClick={() => onOpen(quote.symbol)} type="button">
              <StockIcon symbol={quote.symbol} size={30} /><b>{quote.symbol}</b><small>₹{price(quote.price)}</small>
            </button>
            {metric(quote)}
            <button className="xq-chip buy" onClick={() => onTrade({ symbol: quote.symbol, side: "buy" })} type="button"><SideIcon side="buy" size={12} />Buy</button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="xq-page">
      <div className="xq-page-head"><h1>Market Trends</h1><span className="xq-muted">Across all {quotes.length} NIFTY 500 stocks</span></div>
      <div className="xq-stat-grid">
        {data.market.indices.map((index) => (
          <button className="xq-stat-button" key={index.symbol} onClick={() => onOpen(index.symbol)} type="button">
            <span>{index.symbol}</span><strong>{price(index.price)}</strong><Change pct={index.changePercent} plain value={index.change} />
          </button>
        ))}
        <div>
          <span>Market breadth</span><strong><span className="up">{advancing}</span> / <span className="down">{declining}</span></strong>
          <div aria-hidden="true" className="xq-breadth"><i style={{ flexGrow: advancing }} /><b style={{ flexGrow: declining }} /></div>
          <small>Advancing / declining</small>
        </div>
      </div>
      <div className="xq-grid-3">
        {list("Top gainers", gainers, (quote) => <span className={`xq-pill ${tone(quote.change)}`}>{percent(quote.changePercent)}</span>)}
        {list("Top losers", losers, (quote) => <span className={`xq-pill ${tone(quote.change)}`}>{percent(quote.changePercent)}</span>)}
        {list("Most active (value traded)", active, (quote) => <span className="xq-muted xq-num">{rupeesShort(quote.volume * quote.price)}</span>)}
      </div>
      <section className="xq-panel">
        <h2 className="xq-panel-title">Sector performance today <small className="xq-muted">average 1D change</small></h2>
        <Bars format={percent} rows={sectors} />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ Support */

const faqs: [string, string][] = [
  ["Is this real money?", "No. XOCRISK is a practice platform. You start with ₹1,00,000 of virtual money that can't be deposited, withdrawn or lost in real life."],
  ["Where do the prices come from?", "Prices are delayed NSE quotes for the NIFTY 500, refreshed about every 10 minutes while the market is open and once after the close."],
  ["When can I trade?", "NSE hours: 9:15 AM to 3:30 PM IST, Monday to Friday, except exchange holidays. Market orders only work during these hours."],
  ["Why was my order rejected?", "The usual reasons are: a market order outside market hours, not enough available cash, selling more shares than you hold, or a limit price more than 20% away from the last price. Transactions shows the exact reason."],
  ["What's the difference between market and limit orders?", "A market order fills straight away at the current price. A limit order waits until the price reaches your limit (or better), and can be placed even while the market is closed."],
  ["What are Holdings and Positions?", "Holdings are all the shares you own. Positions are today's trades, netted per stock, with their running profit or loss."],
  ["Will logging out change my balance?", "No. Sign in to the same account with your mobile number or email to continue with your saved cash, holdings and history. Portfolio reset is unavailable. Holdings still change value with market prices."],
];

export function SupportView() {
  return (
    <div className="xq-page narrow">
      <div className="xq-page-head"><h1>Support</h1><span className="xq-muted">Answers to common questions</span></div>
      <section className="xq-panel">
        {faqs.map(([question, answer], index) => (
          <details className="xq-faq" key={question} open={index === 0}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ Settings */

export function SettingsView({ data, pending, starredCount, onToggleLeaderboard, onClearStarred, onLogout, onDelete }: {
  data: Dashboard; pending: boolean; starredCount: number;
  onToggleLeaderboard: (enabled: boolean) => void; onClearStarred: () => void; onLogout: () => void; onDelete: () => void;
}) {
  const { user } = data;
  return (
    <div className="xq-page narrow">
      <div className="xq-page-head"><h1>Settings</h1></div>
      <section className="xq-panel">
        <h2 className="xq-panel-title">Profile</h2>
        <dl className="xq-dl">
          <div><dt>Name</dt><dd>{user.fullName ?? "—"}</dd></div>
          <div><dt>UID</dt><dd><code className="xq-uid">{user.uid}</code></dd></div>
          <div><dt>Email</dt><dd>{user.email}</dd></div>
          <div><dt>Mobile</dt><dd>{user.mobile ? `+91 ${user.mobile}` : "—"}</dd></div>
          <div><dt>College</dt><dd>{user.college ?? "—"}</dd></div>
          <div><dt>Member since</dt><dd>{istDayFullYear.format(new Date(user.memberSince))}</dd></div>
          <div><dt>Last login</dt><dd>{user.lastLoginAt ? istDateTime.format(new Date(user.lastLoginAt)) : "—"}</dd></div>
        </dl>
      </section>
      <section className="xq-panel">
        <h2 className="xq-panel-title">Preferences</h2>
        <div className="xq-setting">
          <div><b>College leaderboard</b><p>Show your name and practice return to classmates who also opted in.</p></div>
          <label className="xq-switch">
            <input checked={user.leaderboardOptIn} disabled={pending || !user.college} onChange={(event) => onToggleLeaderboard(event.target.checked)} type="checkbox" />
            <span aria-hidden="true" />
            <em className="sr-only">College leaderboard</em>
          </label>
        </div>
        <div className="xq-setting">
          <div><b>My watchlist</b><p>{starredCount} starred stock{starredCount === 1 ? "" : "s"}, saved in this browser.</p></div>
          <button className="xq-btn ghost" disabled={!starredCount} onClick={onClearStarred} type="button">Clear</button>
        </div>
      </section>
      <section className="xq-panel">
        <h2 className="xq-panel-title">Account</h2>
        <div className="xq-setting">
          <div><b>Log out</b><p>Sign out of XOCRISK on this device.</p></div>
          <button className="xq-btn ghost" disabled={pending} onClick={onLogout} type="button">Log out</button>
        </div>
        <div className="xq-setting">
          <div><b>Delete account</b><p>Disables sign-in immediately. This can&apos;t be undone.</p></div>
          <button className="xq-btn danger" disabled={pending} onClick={onDelete} type="button">Delete</button>
        </div>
      </section>
    </div>
  );
}
