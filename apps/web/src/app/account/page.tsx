"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthApi } from "../../lib/auth-session";
import { istDateTime, istDayFullYear, istTimeSeconds, percent, price, tone } from "./format";
import OrderWindow, { type OrderRequest } from "./order-window";
import { AnalyticsView, DashboardView, InsightsView, PortfolioView, SettingsView, StockIcon, SupportView, TradeView, TrendsView } from "./pages";
import type { Dashboard, OrderTicket, Side, Tab } from "./types";
import { FundsView, OrdersView } from "./views";
import Watchlist from "./watchlist";
import "./dashboard.css";

const pollMs = 60_000;
const starredKey = "xocrisk.watchlist.v1";

type NavItem = { id: Tab; label: string; icon: string; badge?: string };
// Icon paths are 20×20 line drawings.
const navSections: { title: string; items: NavItem[] }[] = [
  { title: "Overview", items: [{ id: "dashboard", label: "Dashboard", icon: "M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z" }] },
  { title: "Account", items: [
    { id: "portfolio", label: "Portfolio", icon: "M5 3v14M5 7h3v6H5M15 3v14M12 6h6v5h-6" },
    { id: "wallet", label: "Wallet", icon: "M3 6h12l2 2v8H3zM3 6l2-3h9M13 11h2" },
    { id: "watchlist", label: "Watchlist", icon: "M10 2l2.4 5 5.6.6-4.2 3.8 1.2 5.6L10 14l-5 3 1.2-5.6L2 7.6 7.6 7z" },
  ] },
  { title: "Activity", items: [
    { id: "trade", label: "Trade", icon: "M3 13l4-4 3 3 7-7M13 5h4v4" },
    { id: "transactions", label: "Transactions", icon: "M4 7h12l-3-3M16 13H4l3 3" },
  ] },
  { title: "Others", items: [
    { id: "insights", label: "Insights", icon: "M3 3h14v11H3zM6 11l3-3 2 2 3-4M7 17h6" },
    { id: "analytics", label: "Analytics", icon: "M4 17V9M10 17V3M16 17v-6", badge: "Beta" },
    { id: "trends", label: "Market Trends", icon: "M3 15l4-5 3 3 7-8M3 17h14" },
  ] },
  { title: "Help", items: [
    { id: "support", label: "Support", icon: "M10 17a7 7 0 100-14 7 7 0 000 14zM8 8a2 2 0 114 0c0 1.5-2 1.5-2 3M10 14h.01" },
    { id: "settings", label: "Settings", icon: "M10 13a3 3 0 100-6 3 3 0 000 6zM10 1v3M10 16v3M1 10h3M16 10h3M3.6 3.6l2.1 2.1M14.3 14.3l2.1 2.1M3.6 16.4l2.1-2.1M14.3 5.7l2.1-2.1" },
  ] },
];
const allItems = navSections.flatMap((section) => section.items.map((item) => ({ ...item, section: section.title })));
const tabIds = new Set<Tab>(allItems.map((item) => item.id));

type Toast = { id: number; kind: "ok" | "error"; text: string };

function readStarred(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(starredKey) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function tabFromHash(): Tab {
  if (typeof window === "undefined") return "dashboard";
  const hash = window.location.hash.slice(1) as Tab;
  return tabIds.has(hash) ? hash : "dashboard";
}

function NavIcon({ path }: { path: string }) {
  return <svg aria-hidden="true" viewBox="0 0 20 20"><path d={path} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>;
}

export default function AccountPage() {
  const router = useRouter();
  const authFetch = useAuthApi();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [selected, setSelected] = useState<string | null>(null);
  const [ticket, setTicket] = useState<(OrderTicket & { key: number }) | null>(null);
  const [starred, setStarred] = useState<string[]>(() => (typeof window === "undefined" ? [] : readStarred()));
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState("");
  const [deletionRequested, setDeletionRequested] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-2), { id, kind, text }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), kind === "error" ? 7000 : 4500);
  }, []);

  const load = useCallback(async () => {
    const response = await authFetch("/v1/practice/dashboard");
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    if (!response.ok) throw new Error("Dashboard service unavailable.");
    setData(await response.json() as Dashboard);
    setFetchedAt(new Date());
    setLoadError("");
  }, [authFetch, router]);

  // First load, then poll while the page is visible so prices, fills and P&L stay current.
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      load().catch(() => {
        if (active) setLoadError("Couldn't reach the trading service. Retrying…");
      }).finally(() => {
        if (active) setLoading(false);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, pollMs);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  // The URL hash follows the page, so links, back and forward work.
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const hash = tab === "dashboard" ? "" : `#${tab}`;
    if (window.location.hash !== hash) window.history.pushState(null, "", `${window.location.pathname}${hash}`);
  }, [tab]);

  const quotes = useMemo(() => new Map((data?.market.quotes ?? []).map((quote) => [quote.symbol, quote])), [data]);
  const indices = useMemo(() => new Map((data?.market.indices ?? []).map((quote) => [quote.symbol, quote])), [data]);
  const nifty50 = useMemo(() => new Set(data?.market.nifty50 ?? []), [data]);
  const holdings = useMemo(() => new Map((data?.holdings ?? []).map((holding) => [holding.symbol, holding])), [data]);
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !data) return [];
    return [...data.market.indices, ...data.market.quotes]
      .filter((quote) => quote.symbol.toLowerCase().includes(q) || quote.name.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.symbol.toLowerCase().startsWith(q)) - Number(!b.symbol.toLowerCase().startsWith(q)))
      .slice(0, 8);
  }, [search, data]);
  const closeTicket = useCallback(() => setTicket(null), []);

  function navigate(next: Tab) {
    setTab(next);
    setDrawer(false);
    window.scrollTo({ top: 0 });
  }

  function openStock(symbol: string) {
    setSelected(symbol);
    setSearch("");
    navigate("trade");
  }

  function trade(next: OrderTicket) {
    if (!quotes.has(next.symbol)) return;
    setTicket({ ...next, key: Date.now() });
  }

  function saveStarred(next: string[]) {
    setStarred(next);
    try { localStorage.setItem(starredKey, JSON.stringify(next)); } catch { /* storage blocked: keep it for this visit */ }
  }

  async function call(path: string, init: RequestInit, fallback: string): Promise<{ ok: boolean; message?: string }> {
    setPending(true);
    try {
      const response = await authFetch(path, init);
      const result = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) {
        toast("error", result.message ?? fallback);
        return { ok: false };
      }
      await load().catch(() => {});
      return { ok: true, message: result.message };
    } catch {
      toast("error", fallback);
      return { ok: false };
    } finally {
      setPending(false);
    }
  }

  async function placeOrder(order: OrderRequest): Promise<boolean> {
    const result = await call("/v1/practice/orders", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(order),
    }, "The order could not be placed.");
    if (result.ok) toast("ok", `${order.side === "buy" ? "Buy" : "Sell"} ${order.quantity} ${order.symbol}: ${result.message ?? "order placed."}`);
    return result.ok;
  }

  async function cancelOrder(id: string) {
    const result = await call(`/v1/practice/orders/${encodeURIComponent(id)}`, { method: "DELETE" }, "The order could not be cancelled.");
    if (result.ok) toast("ok", result.message ?? "Order cancelled.");
  }

  async function setLeaderboard(enabled: boolean) {
    const result = await call("/v1/practice/leaderboard", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }),
    }, "Leaderboard preference could not be saved.");
    if (result.ok) toast("ok", enabled ? "You're on the leaderboard." : "You've left the leaderboard.");
  }

  async function resetPortfolio() {
    if (!window.confirm("Reset your practice portfolio to ₹1,00,000? This removes all holdings, orders and history and can't be undone.")) return;
    const result = await call("/v1/practice/reset", { method: "POST" }, "The portfolio could not be reset.");
    if (result.ok) toast("ok", result.message ?? "Portfolio reset.");
  }

  async function logout() {
    setPending(true);
    try {
      await authFetch("/v1/auth/logout", { method: "POST" });
      router.replace("/login");
    } catch {
      toast("error", "Couldn't log out. Try again.");
      setPending(false);
    }
  }

  async function requestDeletion() {
    if (!window.confirm("Delete your account? Sign-in is disabled immediately and this can't be undone.")) return;
    setPending(true);
    try {
      const response = await authFetch("/v1/auth/account", { method: "DELETE" });
      if (!response.ok) throw new Error();
      setDeletionRequested(true);
    } catch {
      toast("error", "Couldn't submit the deletion request. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (deletionRequested) {
    return (
      <main className="xq-splash">
        <h1>Deletion request received</h1>
        <p>Your sign-in has been disabled. Your data will be erased separately.</p>
        <Link className="xq-btn ghost" href="/login">Back to log in</Link>
      </main>
    );
  }
  if (loading) return <main aria-busy="true" className="xq-splash"><span className="xq-spinner" /><p>Opening XOCRISK…</p></main>;
  if (!data) {
    return (
      <main className="xq-splash">
        <p>{loadError || "Your workspace could not be loaded."}</p>
        <button className="xq-btn primary" onClick={() => { setLoading(true); load().catch(() => setLoadError("Still can't reach the trading service.")).finally(() => setLoading(false)); }} type="button">Try again</button>
        <Link className="xq-link" href="/login">Back to log in</Link>
      </main>
    );
  }

  const status = data.market.status;
  const current = allItems.find((item) => item.id === tab) ?? allItems[0];
  const activeSymbol = selected ?? data.market.nifty50[0] ?? data.market.quotes[0]?.symbol;
  const stockQuote = activeSymbol ? quotes.get(activeSymbol) ?? indices.get(activeSymbol) : undefined;
  const firstName = data.user.fullName?.split(" ")[0] ?? "Trader";
  const openOrders = data.orders.filter((order) => order.status === "open").length;
  const badges: Partial<Record<Tab, string>> = {
    portfolio: data.holdings.length ? String(data.holdings.length) : undefined,
    transactions: openOrders ? String(openOrders) : undefined,
    watchlist: starred.length ? String(starred.length) : undefined,
  };
  const ticker = data.market.quotes.filter((quote) => nifty50.has(quote.symbol));
  const ticketQuote = ticket ? quotes.get(ticket.symbol) : undefined;
  const openTrade = (symbol: string, side: Side) => trade({ symbol, side, quantity: side === "sell" ? holdings.get(symbol)?.quantity : undefined });
  const toggleStar = (symbol: string) => saveStarred(starred.includes(symbol) ? starred.filter((item) => item !== symbol) : [...starred, symbol]);

  return (
    <div className={`xq ${collapsed ? "is-collapsed" : ""} ${drawer ? "drawer-open" : ""}`}>
      <aside className="xq-sidebar">
        <div className="xq-brand-row">
          <Link aria-label="XOCRISK dashboard" className="xq-brand" href="/account">
            {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer */}
            <img alt="" height="36" src="/icon-192.png" width="36" />
            <span><strong>XOCRISK</strong><small>AI-Powered Trading</small></span>
          </Link>
          <button aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className="xq-collapse" onClick={() => { setCollapsed((value) => !value); setDrawer(false); }} type="button">
            <svg aria-hidden="true" viewBox="0 0 20 20"><path d={collapsed ? "M8 5l5 5-5 5" : "M12 5l-5 5 5 5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="xq-welcome">
          <h2>Welcome<br />Back, {firstName}</h2>
          <p>Last login: {data.user.lastLoginAt ? istDayFullYear.format(new Date(data.user.lastLoginAt)) : "today"}</p>
        </div>
        <nav aria-label="Main">
          {navSections.map((section) => (
            <div className="xq-nav-section" key={section.title}>
              <p>{section.title}</p>
              {section.items.map((item) => (
                <button aria-current={tab === item.id ? "page" : undefined} key={item.id} onClick={() => navigate(item.id)} title={item.label} type="button">
                  <NavIcon path={item.icon} />
                  <span>{item.label}</span>
                  {item.badge && <em className="xq-badge">{item.badge}</em>}
                  {!item.badge && badges[item.id] && <em className="xq-count">{badges[item.id]}</em>}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      {drawer && <button aria-label="Close menu" className="xq-scrim" onClick={() => setDrawer(false)} type="button" />}

      <div className="xq-content">
        <header className="xq-topbar">
          <button aria-label="Open menu" className="xq-burger" onClick={() => setDrawer(true)} type="button">
            <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
          </button>
          <nav aria-label="Breadcrumb" className="xq-crumbs">
            <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M3 9l7-6 7 6v8H3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
            <span>{current.section}</span><i>/</i><b>{tab === "trade" && stockQuote ? `Trade · ${stockQuote.symbol}` : current.label}</b>
          </nav>
          <div className="xq-search">
            <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" /></svg>
            <input aria-label="Search stocks" onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && searchResults[0]) openStock(searchResults[0].symbol); if (event.key === "Escape") setSearch(""); }}
              placeholder="Search..." value={search} />
            {searchResults.length > 0 && (
              <ul className="xq-search-results">
                {searchResults.map((quote) => (
                  <li key={quote.symbol}>
                    <button onClick={() => openStock(quote.symbol)} onMouseDown={(event) => event.preventDefault()} type="button">
                      <StockIcon size={28} symbol={quote.symbol} />
                      <span><b>{quote.symbol}</b><small>{quote.name}</small></span>
                      <span className="xq-num">₹{price(quote.price)}<small className={tone(quote.change)}>{percent(quote.changePercent)}</small></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={`xq-status ${status.isOpen ? "open" : ""}`}
            title={`${status.isOpen ? "Closes" : "Opens"} ${istDateTime.format(new Date(status.nextChangeAt))} IST · prices delayed ~10 min${fetchedAt ? ` · refreshed ${istTimeSeconds.format(fetchedAt)}` : ""}`}>
            <i />{status.isOpen ? "Market open" : "Market closed"}
          </div>
        </header>

        <div aria-label="NIFTY 50 prices" className="xq-ticker">
          <div className="xq-ticker-track">
            {[...ticker, ...ticker].map((quote, index) => (
              <button aria-hidden={index >= ticker.length} key={`${quote.symbol}-${index}`} onClick={() => openStock(quote.symbol)} tabIndex={index >= ticker.length ? -1 : 0} type="button">
                <StockIcon size={18} symbol={quote.symbol} /><b>{quote.symbol}</b>
                <span>₹{price(quote.price)}</span><small className={tone(quote.change)}>{percent(quote.changePercent)}</small>
              </button>
            ))}
          </div>
        </div>

        {loadError && <div className="xq-banner error" role="status">{loadError}</div>}
        {!status.isOpen && (
          <div className="xq-banner">
            Market closed{status.reason ? ` · ${status.reason}` : ""} · opens {istDateTime.format(new Date(status.nextChangeAt))} IST. Limit orders placed now are queued for the next session.
          </div>
        )}

        <main className="xq-main">
          {tab === "dashboard" && <DashboardView data={data} holdings={holdings} nifty50={nifty50} onOpen={openStock} onTrade={trade} />}
          {tab === "portfolio" && <PortfolioView data={data} onOpen={openStock} onTrade={trade} quotes={quotes} />}
          {tab === "wallet" && <div className="xq-page"><FundsView data={data} onReset={() => void resetPortfolio()} pending={pending} /></div>}
          {tab === "watchlist" && (
            <div className="xq-page narrow">
              <div className="xq-page-head"><h1>Watchlist</h1><span className="xq-muted">Tap ☆ to add a stock to My list</span></div>
              <div className="xq-panel flush xq-watch-page">
                <Watchlist nifty50={nifty50} onSelect={openStock} onToggleStar={toggleStar} onTrade={openTrade}
                  quotes={data.market.quotes} selected={null} starred={starred} />
              </div>
            </div>
          )}
          {tab === "trade" && (
            <TradeView data={data} holding={stockQuote ? holdings.get(stockQuote.symbol) : undefined} isIndex={!!stockQuote && indices.has(stockQuote.symbol)}
              nifty50={nifty50} onOpen={(symbol) => setSelected(symbol)} onToggleStar={toggleStar} onTrade={trade} quote={stockQuote} starred={starred} />
          )}
          {tab === "transactions" && (
            <div className="xq-page"><OrdersView onCancel={(id) => void cancelOrder(id)} onOpen={openStock} onTrade={trade} orders={data.orders} pending={pending} quotes={quotes} /></div>
          )}
          {tab === "insights" && <InsightsView data={data} onOpen={openStock} onToggleLeaderboard={(enabled) => void setLeaderboard(enabled)} pending={pending} quotes={quotes} />}
          {tab === "analytics" && <AnalyticsView data={data} quotes={quotes} />}
          {tab === "trends" && <TrendsView data={data} onOpen={openStock} onTrade={trade} />}
          {tab === "support" && <SupportView />}
          {tab === "settings" && (
            <SettingsView data={data} onClearStarred={() => saveStarred([])} onDelete={() => void requestDeletion()} onLogout={() => void logout()}
              onReset={() => void resetPortfolio()} onToggleLeaderboard={(enabled) => void setLeaderboard(enabled)} pending={pending} starredCount={starred.length} />
          )}
          <p className="xq-footnote">XOCRISK · practice trading with virtual money · NSE prices delayed ~10 minutes · not investment advice</p>
        </main>
      </div>

      <div aria-live="polite" className="xq-toasts">
        {toasts.map((item) => <div className={`xq-toast ${item.kind}`} key={item.id}>{item.text}</div>)}
      </div>

      {ticket && ticketQuote && (
        <OrderWindow availableCash={data.portfolio.availableCash} holdingQuantity={holdings.get(ticket.symbol)?.quantity ?? 0}
          key={ticket.key} limitBandPercent={data.rules.limitBandPercent} market={status} onClose={closeTicket}
          onSubmit={placeOrder} pending={pending} quote={ticketQuote} ticket={ticket} />
      )}
    </div>
  );
}
