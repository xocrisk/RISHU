export type ScanMode = "daily" | "orb";
export type ScanSetup = "breakout_20d" | "bull_flag" | "reclaim_ma20" | "oversold" | "oversold_bounce" | "orb";
export type ScanRequest = { mode: ScanMode; symbol?: string; scope?: "nifty50" | "nifty500" };
export type ScanStock = {
  symbol: string; name: string; price: number; asOf: string; setups: ScanSetup[];
  rsi?: number; ma20?: number; high20?: number;
  rangeHigh?: number; rangeLow?: number; signalAt?: string; signalPrice?: number;
  aboveRange?: boolean;
};
export type MarketScan = {
  mode: ScanMode; scope: string; source: "Yahoo Finance (delayed/unofficial)";
  generatedAt: string; asOf: string; cached: boolean; partial: boolean;
  counts: { requested: number; fetched: number; failed: number; stale: number; insufficient: number;
    filtered: number; scanned: number; candidates: number; checked: number; unchecked: number; matched: number };
  filters: { minPrice: number; minVolume: number };
  stocks: ScanStock[]; warnings: string[];
};
