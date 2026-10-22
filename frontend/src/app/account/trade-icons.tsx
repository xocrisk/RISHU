import type { Side } from "./types";

/** Buy is an arrow rising into the position, sell an arrow leaving it. */
export function SideIcon({ side, size = 14 }: { side: Side; size?: number }) {
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 16 16" width={size}>
      {side === "buy"
        ? <path d="M4 12L12 4M6 4h6v6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        : <path d="M4 4l8 8M12 6v6H6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />}
    </svg>
  );
}

/** Compact B / S button used in lists. */
export function TradeMini({ side, onClick, title }: { side: Side; onClick: () => void; title?: string }) {
  return (
    <button aria-label={title ?? (side === "buy" ? "Buy" : "Sell")} className={`xt-mini ${side}`} onClick={onClick} title={title ?? (side === "buy" ? "Buy" : "Sell")} type="button">
      <SideIcon side={side} size={12} /><span>{side === "buy" ? "B" : "S"}</span>
    </button>
  );
}
