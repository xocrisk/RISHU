"use client";

import { useMemo, useState } from "react";
import StockChart from "./stock-chart";
import { count, istDate, istDateTime, istOrderTime, money, num, percent, price, shortNumber, signed, tone } from "./format";
import type { Chart, Dashboard, Holding, Order, OrderTicket, Product, Quote, Tab } from "./types";

type Trade = (ticket: OrderTicket) => void;

function Change({ value, pct, plain = false }: { value: number; pct?: number; plain?: boolean }) {
  return (
    <span className={tone(value)}>
      {signed(value, plain ? price : money)}{pct !== undefined && <> ({percent(pct)})</>}
    </span>
  );
}

function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="xt-empty">
      <svg aria-hidden="true" viewBox="0 0 48 48"><path d="M6 36l10-12 8 7 16-19" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ Home */

export function HomeView({ data, nifty50, onOpen, onNavigate, onTrade }: {
  data: Dashboard; nifty50: Set<string>; onOpen: (symbol: string) => void; onNavigate: (tab: Tab) => void; onTrade: Trade;
}) {
  const { portfolio, holdings, market } = data;
  const name = data.user.fullName?.split(" ")[0];
  const invested = holdings.reduce((total, holding) => total + holding.averageCost * holding.quantity, 0);
  const totalPnl = portfolio.unrealizedPnl;
  const pnlPct = invested ? (totalPnl / invested) * 100 : 0;
  const usedMargin = portfolio.cash - portfolio.availableCash;
  const movers = data.market.quotes.filter((quote) => nifty50.has(quote.symbol));
  const gainers = [...movers].sort((a, b) => b.changePercent - a.changePercent).slice(0, 5);
  const losers = [...movers].sort((a, b) => a.changePercent - b.changePercent).slice(0, 5);
  const trend = portfolio.trend.map((point) => point.value);

  return (
    <div className="xt-view xt-home">
      <h1 className="xt-greeting">Hi, {name ?? "trader"}</h1>

      <div className="xt-cards two">
        <section className="xt-card">
          <header><span className="xt-card-icon">◔</span>Equity</header>
          <div className="xt-card-split">
            <div className="xt-big"><strong>{money(portfolio.availableCash)}</strong><span>Margin available</span></div>
            <dl>
              <div><dt>Margin used</dt><dd>{money(usedMargin)}</dd></div>
              <div><dt>Opening balance</dt><dd>{money(data.rules.initialCash)}</dd></div>
              <div><dt>Account value</dt><dd>{money(portfolio.totalValue)}</dd></div>
            </dl>
          </div>
          <button className="xt-link" onClick={() => onNavigate("funds")} type="button">View statement →</button>
        </section>

        <section className="xt-card">
          <header><span className="xt-card-icon">◆</span>Holdings ({holdings.length})</header>
          {holdings.length ? (
            <>
              <div className="xt-card-split">
                <div className="xt-big"><strong className={tone(totalPnl)}>{signed(totalPnl)}</strong><span>P&amp;L <em className={tone(pnlPct)}>{percent(pnlPct)}</em></span></div>
                <dl>
                  <div><dt>Current value</dt><dd>{money(portfolio.investedValue)}</dd></div>
                  <div><dt>Investment</dt><dd>{money(invested)}</dd></div>
                  <div><dt>Today</dt><dd><Change pct={portfolio.dayChangePercent} value={portfolio.dayChange} /></dd></div>
                </dl>
              </div>
              <div aria-hidden="true" className="xt-allocation">
                {holdings.map((holding, index) => (
                  <span key={holding.symbol} style={{ flexGrow: Math.max(holding.currentValue, 1), opacity: 1 - (index % 6) * 0.12 }} title={`${holding.symbol} ${money(holding.currentValue)}`} />
                ))}
              </div>
              <button className="xt-link" onClick={() => onNavigate("holdings")} type="button">View holdings →</button>
            </>
          ) : (
            <Empty title="You don't have any holdings yet">
              <p>Buy a stock from the watchlist. Your ₹1,00,000 practice balance is ready.</p>
              <button className="xt-btn buy small" onClick={() => onOpen(market.quotes[0]?.symbol ?? "RELIANCE")} type="button">Explore stocks</button>
            </Empty>
          )}
        </section>
      </div>

      <section className="xt-card">
        <header><span className="xt-card-icon">≋</span>Market overview <small className="xt-muted">Updated {market.lastUpdatedAt ? istDateTime.format(new Date(market.lastUpdatedAt)) : "—"}</small></header>
        <div className="xt-indices">
          {market.indices.map((index) => (
            <button className="xt-index-card" key={index.symbol} onClick={() => onOpen(index.symbol)} type="button">
              <span>{index.symbol}</span>
              <strong>{price(index.price)}</strong>
              <Change pct={index.changePercent} plain value={index.change} />
            </button>
          ))}
        </div>
        <div className="xt-movers">
          {([["Top gainers · Nifty 50", gainers], ["Top losers · Nifty 50", losers]] as const).map(([title, list]) => (
            <div key={title}>
              <h3>{title}</h3>
              <ul>
                {list.map((quote) => (
                  <li key={quote.symbol}>
                    <button onClick={() => onOpen(quote.symbol)} type="button">
                      <span><b>{quote.symbol}</b><small>{quote.name}</small></span>
                      <span className="xt-num">{price(quote.price)}<small className={tone(quote.change)}>{percent(quote.changePercent)}</small></span>
                    </button>
                    <button className="xt-mini buy" onClick={() => onTrade({ symbol: quote.symbol, side: "buy" })} title={`Buy ${quote.symbol}`} type="button">B</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="xt-card">
        <header><span className="xt-card-icon">↗</span>Today&apos;s account value</header>
        {trend.length > 1 ? <Sparkline values={trend} /> : <p className="xt-muted">Your account value is tracked through the day after every trade.</p>}
      </section>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${36 - ((value - min) / span) * 30}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg aria-label="Account value through today" className="xt-sparkline" preserveAspectRatio="none" role="img" viewBox="0 0 100 40">
      <polyline fill="none" points={points} stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------------------------------------------ Stock */

export function StockView({ quote, isIndex, holding, onTrade }: { quote: Quote; isIndex: boolean; holding?: Holding; onTrade: Trade }) {
  const [meta, setMeta] = useState<Chart | null>(null);
  const range = meta && meta.symbol === quote.symbol ? meta : null;
  const dayRange = quote.high - quote.low || 1;
  const pos = Math.min(100, Math.max(0, ((quote.price - quote.low) / dayRange) * 100));
  return (
    <div className="xt-view xt-stock">
      <header className="xt-stock-head">
        <div>
          <p className="xt-eyebrow">{isIndex ? "INDEX" : "NSE · EQ"}</p>
          <h1>{quote.symbol}</h1>
          <p className="xt-muted">{quote.name}</p>
        </div>
        <div className="xt-stock-price">
          <strong>{price(quote.price)}</strong>
          <Change pct={quote.changePercent} plain value={quote.change} />
        </div>
        {!isIndex && (
          <div className="xt-stock-actions">
            <button className="xt-btn buy" onClick={() => onTrade({ symbol: quote.symbol, side: "buy" })} type="button">Buy</button>
            <button className="xt-btn sell" onClick={() => onTrade({ symbol: quote.symbol, side: "sell", quantity: holding?.quantity })} type="button">Sell</button>
          </div>
        )}
      </header>

      <section className="xt-card flush"><StockChart lastPrice={quote.price} onMeta={setMeta} symbol={quote.symbol} /></section>

      <div className="xt-cards two">
        <section className="xt-card">
          <header>Performance</header>
          <div className="xt-range-bar">
            <span>Today&apos;s low<b>{price(quote.low)}</b></span>
            <div aria-hidden="true"><i style={{ left: `${pos}%` }} /></div>
            <span>Today&apos;s high<b>{price(quote.high)}</b></span>
          </div>
          {range?.fiftyTwoWeekLow && range.fiftyTwoWeekHigh && (
            <div className="xt-range-bar">
              <span>52W low<b>{price(range.fiftyTwoWeekLow)}</b></span>
              <div aria-hidden="true"><i style={{ left: `${Math.min(100, Math.max(0, ((quote.price - range.fiftyTwoWeekLow) / (range.fiftyTwoWeekHigh - range.fiftyTwoWeekLow || 1)) * 100))}%` }} /></div>
              <span>52W high<b>{price(range.fiftyTwoWeekHigh)}</b></span>
            </div>
          )}
          <dl className="xt-stats">
            <div><dt>Open</dt><dd>{quote.open === null ? "—" : price(quote.open)}</dd></div>
            <div><dt>Prev. close</dt><dd>{price(quote.close)}</dd></div>
            <div><dt>Volume</dt><dd>{quote.volume ? shortNumber(quote.volume) : "—"}</dd></div>
            <div><dt>Last trade</dt><dd>{istOrderTime.format(new Date(quote.marketTime))}</dd></div>
          </dl>
        </section>
        {!isIndex && (
          <section className="xt-card">
            <header>Your position</header>
            {holding ? (
              <dl className="xt-stats">
                <div><dt>Quantity</dt><dd>{count(holding.quantity)}</dd></div>
                <div><dt>Avg. cost</dt><dd>{price(holding.averageCost)}</dd></div>
                <div><dt>Current value</dt><dd>{money(holding.currentValue)}</dd></div>
                <div><dt>P&amp;L</dt><dd><Change pct={(holding.unrealizedPnl / (holding.averageCost * holding.quantity || 1)) * 100} value={holding.unrealizedPnl} /></dd></div>
              </dl>
            ) : <p className="xt-muted">You don&apos;t hold {quote.symbol}. Buy to start a practice position.</p>}
          </section>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Orders */

const statusLabel: Record<Order["status"], string> = { open: "OPEN", filled: "COMPLETE", cancelled: "CANCELLED", rejected: "REJECTED" };

export function OrdersView({ orders, quotes, pending, onCancel, onTrade, onOpen }: {
  orders: Order[]; quotes: Map<string, Quote>; pending: boolean;
  onCancel: (id: string) => void; onTrade: Trade; onOpen: (symbol: string) => void;
}) {
  const open = orders.filter((order) => order.status === "open");
  const executed = orders.filter((order) => order.status === "filled");
  const closed = orders.filter((order) => order.status === "cancelled" || order.status === "rejected");
  // Until the user picks a list, show pending orders first, like a broker's order book.
  const [chosen, setView] = useState<"open" | "executed" | "closed" | null>(null);
  const view = chosen ?? (open.length ? "open" : "executed");
  const list = view === "open" ? open : view === "executed" ? executed : closed;

  return (
    <div className="xt-view">
      <div className="xt-view-head">
        <h1>Orders</h1>
        <div className="xt-subtabs" role="tablist">
          {([["open", `Open (${open.length})`], ["executed", `Executed (${executed.length})`], ["closed", `Cancelled & rejected (${closed.length})`]] as const).map(([value, label]) => (
            <button aria-selected={view === value} key={value} onClick={() => setView(value)} role="tab" type="button">{label}</button>
          ))}
        </div>
      </div>
      {list.length ? (
        <div className="xt-table-wrap">
          <table className="xt-table">
            <thead><tr><th>Time</th><th>Type</th><th>Instrument</th><th>Product</th><th className="r">Qty.</th><th className="r">{view === "executed" ? "Avg. price" : "Price"}</th><th className="r">LTP</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.map((order) => {
                const ltp = quotes.get(order.symbol)?.price;
                const orderPrice = num(order.fillPrice) ?? num(order.limitPrice);
                return (
                  <tr key={order.id}>
                    <td className="xt-muted">{istOrderTime.format(new Date(order.filledAt ?? order.createdAt))}</td>
                    <td><span className={`xt-tag ${order.side}`}>{order.side.toUpperCase()}</span></td>
                    <td><button className="xt-cell-link" onClick={() => onOpen(order.symbol)} type="button">{order.symbol}</button><small className="xt-muted"> NSE</small></td>
                    <td>{order.product === "delivery" ? "CNC" : "MIS"} <small className="xt-muted">{order.orderType.toUpperCase()}</small></td>
                    <td className="r">{count(order.quantity)}</td>
                    <td className="r">{orderPrice === null ? "—" : price(orderPrice)}</td>
                    <td className="r">{ltp === undefined ? "—" : price(ltp)}</td>
                    <td>
                      <span className={`xt-status ${order.status}`}>{statusLabel[order.status]}</span>
                      {order.rejectionReason && <small className="xt-reason">{order.rejectionReason}</small>}
                    </td>
                    <td className="r xt-row-actions">
                      {order.status === "open"
                        ? <button className="xt-btn ghost small" disabled={pending} onClick={() => onCancel(order.id)} type="button">Cancel</button>
                        : <button className="xt-btn ghost small" onClick={() => onTrade({ symbol: order.symbol, side: order.side, quantity: order.quantity, product: order.product })} type="button">Repeat</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={view === "open" ? "No pending orders" : view === "executed" ? "No executed orders yet" : "Nothing cancelled or rejected"}>
          <p>{view === "open" ? "Limit orders waiting for their price, or queued while the market is closed, appear here." : "Place an order from the watchlist with the B or S buttons."}</p>
        </Empty>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Holdings */

export function HoldingsView({ holdings, quotes, onTrade, onOpen }: {
  holdings: Holding[]; quotes: Map<string, Quote>; onTrade: Trade; onOpen: (symbol: string) => void;
}) {
  const invested = holdings.reduce((total, h) => total + h.averageCost * h.quantity, 0);
  const current = holdings.reduce((total, h) => total + h.currentValue, 0);
  const dayPnl = holdings.reduce((total, h) => total + (quotes.get(h.symbol)?.change ?? 0) * h.quantity, 0);
  const totalPnl = current - invested;
  return (
    <div className="xt-view">
      <div className="xt-view-head"><h1>Holdings <small>({holdings.length})</small></h1></div>
      {holdings.length ? (
        <>
          <div className="xt-summary">
            <div><span>Total investment</span><strong>{money(invested)}</strong></div>
            <div><span>Current value</span><strong>{money(current)}</strong></div>
            <div><span>Day&apos;s P&amp;L</span><strong><Change pct={current - dayPnl ? (dayPnl / (current - dayPnl)) * 100 : 0} value={dayPnl} /></strong></div>
            <div><span>Total P&amp;L</span><strong><Change pct={invested ? (totalPnl / invested) * 100 : 0} value={totalPnl} /></strong></div>
          </div>
          <div className="xt-table-wrap">
            <table className="xt-table">
              <thead><tr><th>Instrument</th><th className="r">Qty.</th><th className="r">Avg. cost</th><th className="r">LTP</th><th className="r">Cur. val</th><th className="r">P&amp;L</th><th className="r">Net chg.</th><th className="r">Day chg.</th><th /></tr></thead>
              <tbody>
                {holdings.map((holding) => {
                  const quote = quotes.get(holding.symbol);
                  const net = holding.averageCost ? ((holding.lastPrice - holding.averageCost) / holding.averageCost) * 100 : 0;
                  return (
                    <tr key={holding.symbol}>
                      <td><button className="xt-cell-link" onClick={() => onOpen(holding.symbol)} type="button">{holding.symbol}</button></td>
                      <td className="r">{count(holding.quantity)}</td>
                      <td className="r">{price(holding.averageCost)}</td>
                      <td className="r">{price(holding.lastPrice)}</td>
                      <td className="r">{price(holding.currentValue)}</td>
                      <td className={`r ${tone(holding.unrealizedPnl)}`}>{signed(holding.unrealizedPnl, price)}</td>
                      <td className={`r ${tone(net)}`}>{percent(net)}</td>
                      <td className={`r ${tone(quote?.changePercent ?? 0)}`}>{quote ? percent(quote.changePercent) : "—"}</td>
                      <td className="r xt-row-actions">
                        <button className="xt-mini buy" onClick={() => onTrade({ symbol: holding.symbol, side: "buy" })} title="Add more" type="button">B</button>
                        <button className="xt-mini sell" onClick={() => onTrade({ symbol: holding.symbol, side: "sell", quantity: holding.quantity })} title="Exit" type="button">S</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <Empty title="You don't have any stocks in your holdings yet"><p>Stocks you buy appear here with live P&amp;L.</p></Empty>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Positions */

type Position = { symbol: string; product: Product; buyQty: number; buyValue: number; sellQty: number; sellValue: number };

export function PositionsView({ orders, quotes, onTrade, onOpen }: {
  orders: Order[]; quotes: Map<string, Quote>; onTrade: Trade; onOpen: (symbol: string) => void;
}) {
  // Positions are today's trades (IST), netted per stock and product, like a broker's day book.
  const today = istDate(new Date());
  const positions = useMemo(() => {
    const map = new Map<string, Position>();
    for (const order of orders) {
      if (order.status !== "filled" || istDate(order.filledAt ?? order.createdAt) !== today) continue;
      const fill = num(order.fillPrice) ?? 0;
      const key = `${order.symbol}|${order.product}`;
      const position = map.get(key) ?? { symbol: order.symbol, product: order.product, buyQty: 0, buyValue: 0, sellQty: 0, sellValue: 0 };
      if (order.side === "buy") { position.buyQty += order.quantity; position.buyValue += fill * order.quantity; }
      else { position.sellQty += order.quantity; position.sellValue += fill * order.quantity; }
      map.set(key, position);
    }
    return [...map.values()];
  }, [orders, today]);

  const rows = positions.map((position) => {
    const ltp = quotes.get(position.symbol)?.price ?? 0;
    const net = position.buyQty - position.sellQty;
    const avg = net > 0 ? position.buyValue / position.buyQty : net < 0 ? position.sellValue / position.sellQty
      : position.buyQty ? position.buyValue / position.buyQty : 0;
    const pnl = position.sellValue - position.buyValue + net * ltp;
    return { ...position, ltp, net, avg, pnl };
  });
  const total = rows.reduce((sum, row) => sum + row.pnl, 0);

  return (
    <div className="xt-view">
      <div className="xt-view-head"><h1>Positions <small>({rows.length})</small></h1><span className="xt-muted">Today&apos;s trades</span></div>
      {rows.length ? (
        <div className="xt-table-wrap">
          <table className="xt-table">
            <thead><tr><th>Product</th><th>Instrument</th><th className="r">Qty.</th><th className="r">Avg.</th><th className="r">LTP</th><th className="r">P&amp;L</th><th className="r">Buy / Sell qty</th><th /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr className={row.net === 0 ? "is-closed" : ""} key={`${row.symbol}|${row.product}`}>
                  <td><span className={`xt-tag ${row.product === "delivery" ? "cnc" : "mis"}`}>{row.product === "delivery" ? "CNC" : "MIS"}</span></td>
                  <td><button className="xt-cell-link" onClick={() => onOpen(row.symbol)} type="button">{row.symbol}</button></td>
                  <td className={`r ${tone(row.net)}`}>{row.net}</td>
                  <td className="r">{price(row.avg)}</td>
                  <td className="r">{price(row.ltp)}</td>
                  <td className={`r ${tone(row.pnl)}`}>{signed(row.pnl, price)}</td>
                  <td className="r xt-muted">{row.buyQty} / {row.sellQty}</td>
                  <td className="r xt-row-actions">
                    {row.net > 0 && <button className="xt-btn ghost small" onClick={() => onTrade({ symbol: row.symbol, side: "sell", quantity: row.net, product: row.product })} type="button">Exit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={5}>Total P&amp;L</td><td className={`r ${tone(total)}`}>{signed(total, price)}</td><td colSpan={2} /></tr></tfoot>
          </table>
        </div>
      ) : (
        <Empty title="You don't have any positions yet"><p>Stocks you buy or sell today show up here with running P&amp;L.</p></Empty>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Funds */

export function FundsView({ data, pending, onReset }: { data: Dashboard; pending: boolean; onReset: () => void }) {
  const { portfolio, rules } = data;
  const used = portfolio.cash - portfolio.availableCash;
  return (
    <div className="xt-view">
      <div className="xt-view-head"><h1>Funds</h1><span className="xt-muted">Practice money · cannot be deposited or withdrawn</span></div>
      <div className="xt-cards two">
        <section className="xt-card">
          <header><span className="xt-card-icon">◔</span>Equity</header>
          <dl className="xt-ledger">
            <div className="xt-ledger-hero"><dt>Available margin</dt><dd>{money(portfolio.availableCash)}</dd></div>
            <div><dt>Used margin <small>open buy orders</small></dt><dd>{money(used)}</dd></div>
            <div><dt>Available cash</dt><dd>{money(portfolio.cash)}</dd></div>
            <div className="xt-ledger-sep"><dt>Opening balance</dt><dd>{money(rules.initialCash)}</dd></div>
            <div><dt>Invested <small>at market value</small></dt><dd>{money(portfolio.investedValue)}</dd></div>
            <div><dt>Realised P&amp;L</dt><dd className={tone(portfolio.realizedPnl)}>{signed(portfolio.realizedPnl)}</dd></div>
            <div><dt>Unrealised P&amp;L</dt><dd className={tone(portfolio.unrealizedPnl)}>{signed(portfolio.unrealizedPnl)}</dd></div>
            <div className="xt-ledger-sep"><dt>Account value</dt><dd>{money(portfolio.totalValue)}</dd></div>
            <div><dt>Overall return</dt><dd className={tone(portfolio.totalValue - rules.initialCash)}>{percent(((portfolio.totalValue - rules.initialCash) / rules.initialCash) * 100)}</dd></div>
          </dl>
        </section>
        <section className="xt-card">
          <header>Trading rules</header>
          <ul className="xt-rules">
            <li>Orders execute at the delayed NSE price (refreshed about every 10 minutes during market hours).</li>
            <li>NSE hours: 9:15 AM – 3:30 PM IST, Monday to Friday, except exchange holidays.</li>
            <li>Market orders fill instantly while the market is open. Limit orders wait until the price reaches your limit.</li>
            <li>Limit prices must be within ±{rules.limitBandPercent}% of the last price.</li>
            <li>No brokerage, taxes or slippage are charged on practice trades.</li>
          </ul>
          <div className="xt-danger">
            <div><strong>Reset portfolio</strong><p>Go back to {money(rules.initialCash)}. Removes all holdings, orders and history.</p></div>
            <button className="xt-btn danger small" disabled={pending} onClick={onReset} type="button">Reset</button>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Leaderboard */

export function LeaderboardView({ data, pending, onToggle }: { data: Dashboard; pending: boolean; onToggle: (enabled: boolean) => void }) {
  const { user, leaderboard } = data;
  return (
    <div className="xt-view">
      <div className="xt-view-head"><h1>Leaderboard</h1>{user.college && <span className="xt-muted">{user.college}</span>}</div>
      <section className="xt-card">
        {!user.college ? <p className="xt-muted">Add a college to your account to join a college leaderboard.</p> : (
          <>
            <label className="xt-toggle">
              <input checked={user.leaderboardOptIn} disabled={pending} onChange={(event) => onToggle(event.target.checked)} type="checkbox" />
              <span aria-hidden="true" />
              Show my name and practice return on my college leaderboard
            </label>
            {user.leaderboardOptIn ? (
              leaderboard.length ? (
                <ol className="xt-board">
                  {leaderboard.map((entry) => (
                    <li className={entry.isSelf ? "is-self" : ""} key={`${entry.rank}-${entry.displayName}`}>
                      <span className={`xt-rank r${entry.rank}`}>{entry.rank}</span>
                      <span className="xt-board-name">{entry.displayName}{entry.isSelf && <em>YOU</em>}</span>
                      <strong className={tone(entry.returnPercent)}>{percent(entry.returnPercent)}</strong>
                    </li>
                  ))}
                </ol>
              ) : <p className="xt-muted">No classmates have joined yet.</p>
            ) : <p className="xt-muted">Turn this on to see how classmates who opted in are doing.</p>}
          </>
        )}
      </section>
    </div>
  );
}

