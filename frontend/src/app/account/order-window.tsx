"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { count, istDateTime, money, percent, price, signed, tone } from "./format";
import { SideIcon } from "./trade-icons";
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

const quickQuantities = [1, 5, 10, 25, 50];

export default function OrderWindow({ ticket, quote, holdingQuantity, availableCash, limitBandPercent, market, pending, onSubmit, onClose }: Props) {
  const [side, setSide] = useState<Side>(ticket.side);
  const [product, setProduct] = useState<Product>(ticket.product ?? "delivery");
  // Market orders can't execute while NSE is closed, so default to a limit order then.
  const [orderType, setOrderType] = useState<OrderType>(ticket.orderType ?? (market.isOpen ? "market" : "limit"));
  const [quantity, setQuantity] = useState(String(ticket.quantity ?? 1));
  const [limitPrice, setLimitPrice] = useState(String(ticket.price ?? quote.price));
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
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
  const maxQuantity = side === "buy" ? Math.max(0, Math.floor(availableCash / (effectivePrice || 1))) : holdingQuantity;

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

  function edit(apply: () => void) {
    apply();
    setError("");
    setConfirming(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem) return;
    // Big orders get a second look, like a broker's order confirmation.
    if (!confirming && value >= 50_000) { setConfirming(true); return; }
    const ok = await onSubmit({
      symbol: quote.symbol, side, product, orderType, quantity: qty,
      ...(orderType === "limit" ? { limitPrice: Number(limit.toFixed(2)) } : {}),
    });
    if (ok) onClose();
  }

  const verb = side === "buy" ? "Buy" : "Sell";
  return (
    <div className="xt-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form aria-labelledby="order-title" aria-modal="true" className={`xt-order is-${side}`} onSubmit={submit} role="dialog">
        <span aria-hidden="true" className="xt-order-grip" />
        <header className="xt-order-head">
          <div className="xt-order-id">
            <span className="xt-order-badge"><SideIcon side={side} size={16} /></span>
            <div>
              <h2 id="order-title">{quote.symbol} <small>NSE · EQ</small></h2>
              <p>
                <b>₹{price(quote.price)}</b>
                <span className={tone(quote.change)}> {signed(quote.change, price)} ({percent(quote.changePercent)})</span>
              </p>
            </div>
          </div>
          <div aria-label="Order side" className="xt-side-toggle" role="radiogroup">
            {(["buy", "sell"] as const).map((value) => (
              <button aria-checked={side === value} className={value} key={value} onClick={() => edit(() => setSide(value))} role="radio" type="button">
                <SideIcon side={value} size={13} />{value === "buy" ? "Buy" : "Sell"}
              </button>
            ))}
          </div>
          <button aria-label="Close" className="xt-order-close" onClick={onClose} type="button">
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </header>

        <div className="xt-order-body">
          <div aria-label="Product" className="xt-tabs-line" role="radiogroup">
            {([["delivery", "Delivery", "CNC"], ["intraday", "Intraday", "MIS"]] as const).map(([value, label, code]) => (
              <button aria-checked={product === value} key={value} onClick={() => edit(() => setProduct(value))} role="radio" type="button">
                {label} <small>{code}</small>
              </button>
            ))}
          </div>

          <div className="xt-order-fields">
            <label className="xt-field">
              <span>Quantity <small>{side === "sell" ? `held ${count(holdingQuantity)}` : `max ${count(maxQuantity)}`}</small></span>
              <div className="xt-stepper">
                <button aria-label="Decrease quantity" onClick={() => edit(() => setQuantity(String(Math.max(1, (Number(quantity) || 1) - 1))))} type="button">−</button>
                <input inputMode="numeric" onChange={(event) => edit(() => setQuantity(event.target.value.replace(/\D/g, "").slice(0, 6)))}
                  ref={quantityRef} value={quantity} />
                <button aria-label="Increase quantity" onClick={() => edit(() => setQuantity(String((Number(quantity) || 0) + 1)))} type="button">+</button>
              </div>
            </label>
            <label className="xt-field">
              <span>Price <small>{orderType === "market" ? "at market" : `±${limitBandPercent}% band`}</small></span>
              {orderType === "limit" ? (
                <div className="xt-price-input">
                  <i>₹</i>
                  <input inputMode="decimal" onChange={(event) => edit(() => setLimitPrice(event.target.value.replace(/[^\d.]/g, "")))} value={limitPrice} />
                </div>
              ) : <input aria-label="Price: at market" disabled value={`Market · ₹${price(quote.price)}`} />}
            </label>
          </div>

          <div className="xt-quick-qty" aria-label="Quick quantity">
            {quickQuantities.map((value) => (
              <button aria-pressed={qty === value} key={value} onClick={() => edit(() => setQuantity(String(value)))} type="button">{value}</button>
            ))}
            <button disabled={maxQuantity < 1} onClick={() => edit(() => setQuantity(String(Math.max(1, maxQuantity))))} type="button">Max</button>
          </div>

          <div aria-label="Order type" className="xt-seg wide" role="radiogroup">
            {([["market", "Market"], ["limit", "Limit"]] as const).map(([value, label]) => (
              <button aria-checked={orderType === value} key={value} onClick={() => edit(() => setOrderType(value))} role="radio" type="button">{label}</button>
            ))}
          </div>

          {!market.isOpen && (
            <p className="xt-order-info">
              Market closed{market.reason ? ` (${market.reason})` : ""}. Opens {istDateTime.format(new Date(market.nextChangeAt))}.
              {orderType === "limit" ? " Your limit order will be queued and checked once trading starts." : " Market orders can't be placed now."}
              {closedForMarket && <button className="xt-link" onClick={() => edit(() => setOrderType("limit"))} type="button">Use limit order</button>}
            </p>
          )}
          {confirming && (
            <p className="xt-order-confirm" role="status">
              Confirm: {verb.toLowerCase()} <b>{count(qty)}</b> {quote.symbol} at {orderType === "market" ? "market price" : `₹${price(limit)}`} for about <b>{money(value)}</b>. Press {verb} again to place it.
            </p>
          )}
          {error && <p className="xt-order-error" role="alert">{error}</p>}
        </div>

        <footer className="xt-order-foot">
          <dl className="xt-order-summary">
            <div><dt>{side === "buy" ? "Margin required" : "You receive"}</dt><dd>{money(value)}</dd></div>
            <div><dt>Available</dt><dd>{money(availableCash)}</dd></div>
            <div><dt>Charges</dt><dd>{money(0)}</dd></div>
          </dl>
          <div className="xt-order-actions">
            <button className="xt-btn ghost" onClick={onClose} type="button">Cancel</button>
            <button className={`xt-btn ${side} big`} disabled={pending} type="submit">
              <SideIcon side={side} size={15} />{pending ? "Placing…" : confirming ? `Confirm ${verb.toLowerCase()}` : verb}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
