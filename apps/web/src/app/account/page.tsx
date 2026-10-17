"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthApi } from "../../lib/auth-session";
import { istDateTime, istTimeSeconds, percent, price, tone } from "./format";
import OrderWindow, { type OrderRequest } from "./order-window";
import type { Dashboard, OrderTicket, Side, Tab } from "./types";
import { FundsView, HoldingsView, HomeView, LeaderboardView, OrdersView, PositionsView, StockView } from "./views";
import Watchlist from "./watchlist";
import "./dashboard.css";

const pollMs = 60_000;
const starredKey = "xocrisk.watchlist.v1";
const tabs: { id: Tab; label: string }[] = [
  { id: "home", label: "Dashboard" },
  { id: "orders", label: "Orders" },
  { id: "holdings", label: "Holdings" },
  { id: "positions", label: "Positions" },
  { id: "funds", label: "Funds" },
  { id: "leaderboard", label: "Leaderboard" },
];
const hashTabs = new Set<Tab>(["home", "watchlist", "orders", "holdings", "positions", "funds", "leaderboard"]);

type Toast = { id: number; kind: "ok" | "error"; text: string };

function readStarred(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(starredKey) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function initialTab(): Tab {
  if (typeof window === "undefined") return "home";
  const hash = window.location.hash.slice(1) as Tab;
  return hashTabs.has(hash) ? hash : "home";
}

export default function AccountPage() {
  const router = useRouter();
  const authFetch = useAuthApi();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [selected, setSelected] = useState<string | null>(null);
  const [ticket, setTicket] = useState<(OrderTicket & { key: number }) | null>(null);
  const [starred, setStarred] = useState<string[]>(() => (typeof window === "undefined" ? [] : readStarred()));
  const [menuOpen, setMenuOpen] = useState(false);
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
    const next = await response.json() as Dashboard;
    setData(next);
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

  // Follow the URL hash so links, back and forward switch tabs.
  useEffect(() => {
    const onHash = () => setTab(initialTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (tab === "stock") return;
    const hash = tab === "home" ? "" : `#${tab}`;
    if (window.location.hash !== hash) window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
  }, [tab]);

  const quotes = useMemo(() => new Map((data?.market.quotes ?? []).map((quote) => [quote.symbol, quote])), [data]);
  const indices = useMemo(() => new Map((data?.market.indices ?? []).map((quote) => [quote.symbol, quote])), [data]);
  const nifty50 = useMemo(() => new Set(data?.market.nifty50 ?? []), [data]);
  const holdings = useMemo(() => new Map((data?.holdings ?? []).map((holding) => [holding.symbol, holding])), [data]);
  const activeSymbol = selected ?? data?.market.quotes[0]?.symbol ?? null;

  const closeTicket = useCallback(() => setTicket(null), []);

  function navigate(next: Tab) {
    setTab(next);
    setMenuOpen(false);
  }

  function openStock(symbol: string) {
    setSelected(symbol);
    setTab("stock");
  }

  function trade(next: OrderTicket) {
    if (!quotes.has(next.symbol)) return;
    setTicket({ ...next, key: Date.now() });
  }

  function toggleStar(symbol: string) {
    setStarred((current) => {
      const next = current.includes(symbol) ? current.filter((item) => item !== symbol) : [...current, symbol];
      try { localStorage.setItem(starredKey, JSON.stringify(next)); } catch { /* storage blocked: keep it for this visit */ }
      return next;
    });
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
      toast("error", "Couldn't sign out. Try again.");
      setPending(false);
    }
  }

  async function requestDeletion() {
    setMenuOpen(false);
    if (!window.confirm("Request account deletion? Sign-in is disabled immediately and this can't be undone.")) return;
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
      <main className="xt-splash">
        <h1>Deletion request received</h1>
        <p>Your sign-in has been disabled. Your data will be erased separately.</p>
        <Link className="xt-btn ghost" href="/login">Back to log in</Link>
      </main>
    );
  }
  if (loading) return <main aria-busy="true" className="xt-splash"><span className="xt-spinner" /><p>Opening your trading terminal…</p></main>;
  if (!data) {
    return (
      <main className="xt-splash">
        <p>{loadError || "Your workspace could not be loaded."}</p>
        <button className="xt-btn buy" onClick={() => { setLoading(true); load().catch(() => setLoadError("Still can't reach the trading service.")).finally(() => setLoading(false)); }} type="button">Try again</button>
        <Link className="xt-link" href="/login">Back to log in</Link>
      </main>
    );
  }

  const status = data.market.status;
  const stockQuote = activeSymbol ? quotes.get(activeSymbol) ?? indices.get(activeSymbol) : undefined;
  const initials = (data.user.fullName ?? "Trader").split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const ticketQuote = ticket ? quotes.get(ticket.symbol) : undefined;
  const openTrade = (symbol: string, side: Side) => trade({ symbol, side, quantity: side === "sell" ? holdings.get(symbol)?.quantity : undefined });

  return (
    <div className={`xt tab-${tab}`}>
      <header className="xt-top">
        <Link aria-label="XOCRISK home" className="xt-brand" href="/account">
          {/* eslint-disable-next-line @next/next/no-img-element -- static export, no image optimizer */}
          <img alt="" height="30" src="/icon-192.png" width="30" />
          <span>XOCRISK</span>
        </Link>
        <div className="xt-indices-strip">
          {data.market.indices.filter((index) => index.symbol !== "NIFTY BANK").map((index) => (
            <button key={index.symbol} onClick={() => openStock(index.symbol)} type="button">
              <span>{index.symbol}</span><b className={tone(index.change)}>{price(index.price)}</b><small className={tone(index.change)}>{percent(index.changePercent)}</small>
            </button>
          ))}
        </div>
        <nav aria-label="Sections" className="xt-nav">
          {tabs.map((item) => (
            <button aria-current={tab === item.id ? "page" : undefined} key={item.id} onClick={() => navigate(item.id)} type="button">{item.label}</button>
          ))}
        </nav>
        <div className={`xt-status-pill ${status.isOpen ? "open" : ""}`}
          title={`${status.isOpen ? "Closes" : "Opens"} ${istDateTime.format(new Date(status.nextChangeAt))} IST · prices delayed ~10 min`}>
          <i />{status.isOpen ? "Market open" : "Market closed"}
          {fetchedAt && <small>{istTimeSeconds.format(fetchedAt)}</small>}
        </div>
        <div className="xt-profile">
          <button aria-expanded={menuOpen} aria-haspopup="menu" className="xt-avatar" onClick={() => setMenuOpen((open) => !open)} type="button">{initials}</button>
          {menuOpen && (
            <div className="xt-menu" role="menu">
              <div className="xt-menu-head"><strong>{data.user.fullName ?? "Trader"}</strong>{data.user.college && <small>{data.user.college}</small>}</div>
              <button onClick={() => navigate("funds")} role="menuitem" type="button">Funds</button>
              <button onClick={() => navigate("leaderboard")} role="menuitem" type="button">Leaderboard</button>
              <button disabled={pending} onClick={() => void logout()} role="menuitem" type="button">Log out</button>
              <button className="danger" disabled={pending} onClick={() => void requestDeletion()} role="menuitem" type="button">Delete account</button>
            </div>
          )}
        </div>
      </header>

      {loadError && <div className="xt-banner" role="status">{loadError}</div>}
      {!status.isOpen && (
        <div className="xt-banner subtle">
          Market closed{status.reason ? ` · ${status.reason}` : ""} · opens {istDateTime.format(new Date(status.nextChangeAt))} IST. Limit orders you place now are queued for the next session.
        </div>
      )}

      <div className="xt-body">
        <aside className="xt-side">
          <Watchlist nifty50={nifty50} onSelect={openStock} onToggleStar={toggleStar} onTrade={openTrade}
            quotes={data.market.quotes} selected={tab === "stock" ? activeSymbol : null} starred={starred} />
        </aside>
        <main className="xt-main" onClick={() => setMenuOpen(false)}>
          {tab === "home" && <HomeView data={data} nifty50={nifty50} onNavigate={navigate} onOpen={openStock} onTrade={trade} />}
          {tab === "stock" && stockQuote && (
            <StockView holding={holdings.get(stockQuote.symbol)} isIndex={indices.has(stockQuote.symbol)} onTrade={trade} quote={stockQuote} />
          )}
          {tab === "orders" && <OrdersView onCancel={(id) => void cancelOrder(id)} onOpen={openStock} onTrade={trade} orders={data.orders} pending={pending} quotes={quotes} />}
          {tab === "holdings" && <HoldingsView holdings={data.holdings} onOpen={openStock} onTrade={trade} quotes={quotes} />}
          {tab === "positions" && <PositionsView onOpen={openStock} onTrade={trade} orders={data.orders} quotes={quotes} />}
          {tab === "funds" && <FundsView data={data} onReset={() => void resetPortfolio()} pending={pending} />}
          {tab === "leaderboard" && <LeaderboardView data={data} onToggle={(enabled) => void setLeaderboard(enabled)} pending={pending} />}
          <p className="xt-footnote">
            Practice trading with virtual money · NSE prices delayed ~10 minutes, from Yahoo Finance · not investment advice
          </p>
        </main>
      </div>

      <nav aria-label="Sections" className="xt-bottom">
        {([["watchlist", "Watchlist", "M3 5h14M3 10h14M3 15h9"], ["home", "Home", "M3 10l7-6 7 6v7H3z"], ["orders", "Orders", "M5 3h10v14H5zM8 7h4M8 11h4"],
          ["holdings", "Holdings", "M3 16V9M8 16V4M13 16v-6M17 16H2"], ["positions", "Positions", "M3 14l4-4 3 3 6-7"], ["funds", "Funds", "M3 6h14v9H3zM13 10.5h2"]] as const).map(([id, label, path]) => (
          <button aria-current={tab === id || (id === "watchlist" && tab === "stock") ? "page" : undefined} key={id} onClick={() => navigate(id)} type="button">
            <svg aria-hidden="true" viewBox="0 0 20 20"><path d={path} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" /></svg>
            {label}
          </button>
        ))}
      </nav>

      <div aria-live="polite" className="xt-toasts">
        {toasts.map((item) => <div className={`xt-toast ${item.kind}`} key={item.id}>{item.text}</div>)}
      </div>

      {ticket && ticketQuote && (
        <OrderWindow availableCash={data.portfolio.availableCash} holdingQuantity={holdings.get(ticket.symbol)?.quantity ?? 0}
          key={ticket.key} limitBandPercent={data.rules.limitBandPercent} market={status} onClose={closeTicket}
          onSubmit={placeOrder} pending={pending} quote={ticketQuote} ticket={ticket} />
      )}
    </div>
  );
}
