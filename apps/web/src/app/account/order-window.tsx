"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { istDateTime, money, percent, price, tone } from "./format";
import type { MarketStatus, OrderTicket, OrderType, Product, Quote, Side } from "./types";

export type OrderRequest = {
  symbol: string; side: Side; product: Product; orderType: OrderType; quantity: number; limitPrice?: number;
};

type Props = {
  ticket: OrderTicket;
  quote: Quote;
  holdingQuantity: number;
  availableCash: number;
  limitBandPercent: number;
  market: MarketStatus;
  pending: boolean;
  onSubmit: (order: OrderRequest) => Promise<boolean>;
  onClose: () => void;
};

export default function OrderWindow({ ticket, quote, holdingQuantity, availableCash, limitBandPercent, market, pending, onSubmit, onClose }: Props) {
  const [side, setSide] = useState<Side>(ticket.side);
  const [product, setProduct] = useState<Product>(ticket.product ?? "delivery");
  // Market orders can't execute while NSE is closed, so default to a limit order then.
  const [orderType, setOrderType] = useState<OrderType>(ticket.orderType ?? (market.isOpen ? "market" : "limit"));
  const [quantity, setQuantity] = useState(String(ticket.quantity ?? 1));
  const [limitPrice, setLimitPrice] = useState(String(ticket.price ?? quote.price));
  const [error, setError] = useState("");
  const quantityRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    quantityRef.current?.focus();
    quantityRef.current?.select();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const qty = Number(quantity);
  const limit = Number(limitPrice);
  const effectivePrice = orderType === "limit" && limit > 0 ? limit : quote.price;
  const value = Number.isFinite(qty) ? effectivePrice * qty : 0;
  const lowerBand = quote.price * (1 - limitBandPercent / 100);
  const upperBand = quote.price * (1 + limitBandPercent / 100);
  const closedForMarket = orderType === "market" && !market.isOpen;

  function validate(): string {
    if (!Number.isInteger(qty) || qty < 1) return "Enter a whole number of shares (at least 1).";
    if (qty > 100000) return "Quantity can't exceed 1,00,000 shares per order.";
    if (orderType === "limit") {
      if (!(limit > 0)) return "Enter a limit price.";
      if (limit < lowerBand || limit > upperBand) return `Limit price must be between ₹${price(lowerBand)} and ₹${price(upperBand)} (±${limitBandPercent}% of LTP).`;
    }
    if (side === "buy" && value > availableCash) return `Not enough cash. You need ${money(value)} but have ${money(availableCash)} available.`;
    if (side === "sell" && qty > holdingQuantity) {
      return holdingQuantity ? `You can sell up to ${holdingQuantity} shares of ${quote.symbol}.` : `You don't hold any ${quote.symbol} shares to sell.`;
    }
    if (closedForMarket) return "The market is closed. Switch to a limit order to queue it for the next session.";
    return "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    const ok = await onSubmit({
      symbol: quote.symbol, side, product, orderType, quantity: qty,
      ...(orderType === "limit" ? { limitPrice: Number(limit.toFixed(2)) } : {}),
    });
    if (ok) onClose();
  }

  return (
    <div className="xt-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form aria-labelledby="order-title" aria-modal="true" className={`xt-order is-${side}`} onSubmit={submit} role="dialog">
        <header className="xt-order-head">
          <div>
            <h2 id="order-title">{side === "buy" ? "Buy" : "Sell"} {quote.symbol} <small>NSE</small></h2>
            <p>
              <b>₹{price(quote.price)}</b>{" "}
              <span className={tone(quote.change)}>{percent(quote.changePercent)}</span>
              <span className="xt-order-qty-note"> · {quantity || 0} qty</span>
            </p>
          </div>
          <label className="xt-switch" title="Switch between buy and sell">
            <input checked={side === "sell"} onChange={(event) => { setSide(event.target.checked ? "sell" : "buy"); setError(""); }} type="checkbox" />
            <span aria-hidden="true" />
            <em>{side === "buy" ? "BUY" : "SELL"}</em>
          </label>
        </header>

        <div className="xt-order-body">
          <div className="xt-radio-row" role="radiogroup" aria-label="Product">
            {([["delivery", "Delivery", "CNC · hold overnight"], ["intraday", "Intraday", "MIS · same day"]] as const).map(([value, label, hint]) => (
              <label className={product === value ? "is-on" : ""} key={value}>
                <input checked={product === value} name="product" onChange={() => setProduct(value)} type="radio" />
                <span>{label}</span><small>{hint}</small>
              </label>
            ))}
          </div>

          <div className="xt-order-fields">
            <label className="xt-field">
              <span>Qty.</span>
              <div className="xt-stepper">
                <button aria-label="Decrease quantity" onClick={() => setQuantity(String(Math.max(1, (Number(quantity) || 1) - 1)))} type="button">−</button>
                <input inputMode="numeric" onChange={(event) => { setQuantity(event.target.value.replace(/\D/g, "").slice(0, 6)); setError(""); }}
                  ref={quantityRef} value={quantity} />
                <button aria-label="Increase quantity" onClick={() => setQuantity(String((Number(quantity) || 0) + 1))} type="button">+</button>
              </div>
            </label>
            <label className="xt-field">
              <span>Price</span>
              {orderType === "limit" ? (
                <input inputMode="decimal" onChange={(event) => { setLimitPrice(event.target.value.replace(/[^\d.]/g, "")); setError(""); }} value={limitPrice} />
              ) : <input aria-label="Price: at market" disabled value="Market" />}
            </label>
          </div>

          <div className="xt-radio-row compact" role="radiogroup" aria-label="Order type">
            {([["market", "Market"], ["limit", "Limit"]] as const).map(([value, label]) => (
              <label className={orderType === value ? "is-on" : ""} key={value}>
                <input checked={orderType === value} name="orderType" onChange={() => { setOrderType(value); setError(""); }} type="radio" />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {!market.isOpen && (
            <p className="xt-order-info">
              Market closed{market.reason ? ` (${market.reason})` : ""}. Opens {istDateTime.format(new Date(market.nextChangeAt))}.
              {orderType === "limit" ? " Your limit order will be queued and checked once trading starts." : " Market orders can't be placed now."}
              {closedForMarket && <button className="xt-link" onClick={() => setOrderType("limit")} type="button">Use limit order</button>}
            </p>
          )}
          {side === "sell" && <p className="xt-order-hint">You hold <b>{holdingQuantity}</b> {quote.symbol} shares.</p>}
          {error && <p className="xt-order-error" role="alert">{error}</p>}
        </div>

        <footer className="xt-order-foot">
          <div className="xt-order-summary">
            <span>{side === "buy" ? "Required" : "You receive"} <b>{money(value)}</b></span>
            <span>Available <b>{money(availableCash)}</b></span>
            <span>Charges <b>{money(0)}</b></span>
          </div>
          <div className="xt-order-actions">
            <button className={`xt-btn ${side}`} disabled={pending} type="submit">{pending ? "Placing…" : side === "buy" ? "Buy" : "Sell"}</button>
            <button className="xt-btn ghost" onClick={onClose} type="button">Cancel</button>
          </div>
        </footer>
      </form>
    </div>
  );
}
