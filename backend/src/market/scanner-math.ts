// Adapted from Jakeschincariol/day-trader-skill (MIT). See THIRD_PARTY_NOTICES.md.
// NSE session handling is local; all indicators use completed bars only.
import type { ScanSetup, ScanStock } from "@xocrisk/core";
import { isTradingDay, istDate, lastSessionClose } from "./hours.js";

export type ScanBar = { time: number; close: number; high?: number; low?: number; volume?: number };
export type ScanSeries = { bars: ScanBar[]; volume: number | null };
const round = (n: number) => Number(n.toFixed(2));
export const sessionOpen = (date: string) => Date.parse(`${date}T09:15:00+05:30`);
export const sessionClose = (date: string) => Date.parse(`${date}T15:30:00+05:30`);

export function rsi(closes: number[]): number {
  let gain = 0, loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const move = closes[i] - closes[i - 1];
    if (i <= 14) { gain += Math.max(move, 0) / 14; loss += Math.max(-move, 0) / 14; }
    else { gain = (gain * 13 + Math.max(move, 0)) / 14; loss = (loss * 13 + Math.max(-move, 0)) / 14; }
  }
  // A flat series is neutral, rather than the upstream implementation's 100.
  return loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
}

export function completedDays(bars: ScanBar[], now: Date): ScanBar[] {
  const last = istDate(lastSessionClose(now));
  const unique = new Map<string, ScanBar>();
  for (const bar of bars) {
    const date = istDate(new Date(bar.time));
    if (date <= last && isTradingDay(date) && bar.time <= now.getTime()) unique.set(date, bar);
  }
  return [...unique.values()].sort((a, b) => a.time - b.time);
}

export function dailyAnalysis(symbol: string, name: string, bars: ScanBar[]): ScanStock {
  const c = bars.map(b => b.close), last = c.at(-1)!;
  const high20 = Math.max(...c.slice(-21, -1));
  const mean = (a: number[]) => a.reduce((sum, n) => sum + n, 0) / a.length;
  const ma20 = mean(c.slice(-20)), previousMa = mean(c.slice(-21, -1));
  const strength = rsi(c), previousRsi = rsi(c.slice(0, -1));
  const setups: ScanSetup[] = [];
  if (last > high20) setups.push("breakout_20d");
  if (c.at(-6)! / c.at(-16)! - 1 > 0.1 && (Math.max(...c.slice(-5)) - Math.min(...c.slice(-5))) / last < 0.05) setups.push("bull_flag");
  if (c.at(-2)! < previousMa && last > ma20) setups.push("reclaim_ma20");
  if (strength < 30) setups.push("oversold");
  if (previousRsi < 30 && last > c.at(-2)!) setups.push("oversold_bounce");
  return { symbol, name, price: round(last), asOf: new Date(sessionClose(istDate(new Date(bars.at(-1)!.time)))).toISOString(),
    setups, rsi: round(strength), ma20: round(ma20), high20: round(high20) };
}

export function intradayBars(bars: ScanBar[], cutoff: Date): ScanBar[] | null {
  const open = sessionOpen(istDate(cutoff)), end = Math.min(cutoff.getTime(), sessionClose(istDate(cutoff)));
  const step = 5 * 60_000, want = Math.floor((end - open) / step);
  if (want < 4) return null;
  const byTime = new Map(bars.filter(b => b.time >= open && b.time + step <= end && (b.time - open) % step === 0).map(b => [b.time, b]));
  const complete: ScanBar[] = [];
  for (let i = 0; i < want; i++) {
    const bar = byTime.get(open + i * step);
    if (!bar) return null;
    complete.push(bar);
  }
  return complete;
}

export function openingRangeAnalysis(symbol: string, name: string, bars: ScanBar[]): ScanStock | null {
  const range = bars.slice(0, 3);
  if (range.length !== 3 || range.some(b => b.high == null || b.low == null)) return null;
  const high = Math.max(...range.map(b => b.high!)), low = Math.min(...range.map(b => b.low!));
  const signal = bars.slice(3).find(b => b.close > high);
  const last = bars.at(-1)!;
  return { symbol, name, price: round(last.close), asOf: new Date(last.time + 300_000).toISOString(),
    rangeHigh: round(high), rangeLow: round(low), aboveRange: last.close > high, setups: signal ? ["orb"] : [],
    ...(signal ? { signalAt: new Date(signal.time + 300_000).toISOString(), signalPrice: round(signal.close) } : {}) };
}
