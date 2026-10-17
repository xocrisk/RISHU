"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { percent, price, tone } from "./format";
import type { Quote, Side } from "./types";

type List = "nifty50" | "mine" | "all";

type Props = {
  quotes: Quote[];
  nifty50: Set<string>;
  starred: string[];
  selected: string | null;
  onToggleStar: (symbol: string) => void;
  onSelect: (symbol: string) => void;
  onTrade: (symbol: string, side: Side) => void;
};

/** Remembers the previous price of each symbol so rows can flash when a new price arrives. */
function usePriceFlash(quotes: Quote[]) {
  const previous = useRef(new Map<string, number>());
  const [flash, setFlash] = useState<Record<string, "up" | "down">>({});
  useEffect(() => {
    const changes: Record<string, "up" | "down"> = {};
    for (const quote of quotes) {
      const before = previous.current.get(quote.symbol);
      if (before !== undefined && before !== quote.price) changes[quote.symbol] = quote.price > before ? "up" : "down";
      previous.current.set(quote.symbol, quote.price);
    }
    if (!Object.keys(changes).length) return;
    const show = window.setTimeout(() => setFlash(changes), 0);
    const hide = window.setTimeout(() => setFlash({}), 1200);
    return () => { window.clearTimeout(show); window.clearTimeout(hide); };
  }, [quotes]);
  return flash;
}

export default function Watchlist({ quotes, nifty50, starred, selected, onToggleStar, onSelect, onTrade }: Props) {
  const [list, setList] = useState<List>(starred.length ? "mine" : "nifty50");
  const [query, setQuery] = useState("");
  const flash = usePriceFlash(quotes);
  const starredSet = useMemo(() => new Set(starred), [starred]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Searching always covers every tradeable stock, like a broker's instrument search.
    if (q) {
      return quotes.filter((quote) => quote.symbol.toLowerCase().includes(q) || quote.name.toLowerCase().includes(q))
        .sort((a, b) => Number(!a.symbol.toLowerCase().startsWith(q)) - Number(!b.symbol.toLowerCase().startsWith(q)))
        .slice(0, 60);
    }
    if (list === "mine") {
      const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
      return starred.flatMap((symbol) => bySymbol.get(symbol) ?? []);
    }
    if (list === "nifty50") return quotes.filter((quote) => nifty50.has(quote.symbol));
    return quotes;
  }, [quotes, nifty50, starred, list, query]);

  return (
    <section aria-label="Watchlist" className="xt-watchlist">
      <div className="xt-wl-search">
        <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" /></svg>
        <input aria-label="Search stocks" onChange={(event) => setQuery(event.target.value)} placeholder="Search eg: infy, reliance, tata" value={query} />
        {query && <button aria-label="Clear search" onClick={() => setQuery("")} type="button">×</button>}
      </div>
      {!query && (
        <div className="xt-wl-tabs" role="tablist" aria-label="Watchlists">
          {([["nifty50", "Nifty 50"], ["mine", `My list${starred.length ? ` (${starred.length})` : ""}`], ["all", `All (${quotes.length})`]] as const).map(([value, label]) => (
            <button aria-selected={list === value} key={value} onClick={() => setList(value)} role="tab" type="button">{label}</button>
          ))}
        </div>
      )}
      <div className="xt-wl-count">{query ? `${rows.length} result${rows.length === 1 ? "" : "s"}` : `${rows.length} stocks`}</div>
      <ul className="xt-wl-rows">
        {rows.map((quote) => (
          <li className={`${selected === quote.symbol ? "is-selected" : ""} ${flash[quote.symbol] ? `flash-${flash[quote.symbol]}` : ""}`} key={quote.symbol}>
            <button className="xt-wl-main" onClick={() => onSelect(quote.symbol)} type="button">
              <span className={`xt-wl-symbol ${tone(quote.change)}`}>{quote.symbol}</span>
              <span className="xt-wl-name">{quote.name}</span>
              <span className={`xt-wl-change ${tone(quote.change)}`}>{percent(quote.changePercent)}</span>
              <span className={`xt-wl-price ${tone(quote.change)}`}>{price(quote.price)}</span>
            </button>
            <span className="xt-wl-actions">
              <button className="xt-mini buy" onClick={() => onTrade(quote.symbol, "buy")} title={`Buy ${quote.symbol}`} type="button">B</button>
              <button className="xt-mini sell" onClick={() => onTrade(quote.symbol, "sell")} title={`Sell ${quote.symbol}`} type="button">S</button>
              <button aria-pressed={starredSet.has(quote.symbol)} className="xt-mini star" onClick={() => onToggleStar(quote.symbol)}
                title={starredSet.has(quote.symbol) ? "Remove from My list" : "Add to My list"} type="button">
                {starredSet.has(quote.symbol) ? "★" : "☆"}
              </button>
            </span>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="xt-wl-empty">
            {query ? "No NIFTY 500 stock matches that search." : list === "mine" ? "Tap ☆ on any stock to add it to My list." : "No stocks to show."}
          </li>
        )}
      </ul>
    </section>
  );
}
