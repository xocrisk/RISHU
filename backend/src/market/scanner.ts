import type { MarketScan, ScanRequest, ScanStock } from "@xocrisk/core";
import { instruments } from "./instruments.js";
import { istDate, lastSessionClose, marketStatus } from "./hours.js";
import { completedDays, dailyAnalysis, intradayBars, openingRangeAnalysis, sessionOpen, type ScanBar, type ScanSeries } from "./scanner-math.js";

const catalog = new Map(instruments.map(i => [i.symbol, i]));
const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export class ScannerError extends Error {
  constructor(message: string, readonly statusCode = 502) { super(message); }
}

/** Invalid/null prices are gaps, never zero-priced candles. Keep precision until presentation. */
export function parseSeries(input: unknown): ScanSeries {
  const item = object(input), quote = object(array(object(item.indicators).quote)[0]);
  const closes = array(quote.close), highs = array(quote.high), lows = array(quote.low), volumes = array(quote.volume);
  const bars: ScanBar[] = [];
  array(item.timestamp).forEach((t, i) => {
    const c = closes[i], h = highs[i], l = lows[i], v = volumes[i];
    if (!valid(t) || !valid(c) || c <= 0 || !Number.isFinite(new Date(t * 1000).getTime())) return;
    const goodRange = valid(h) && valid(l) && l > 0 && h >= c && l <= c;
    bars.push({ time: t * 1000, close: c, ...(goodRange ? { high: h, low: l } : {}),
      ...(valid(v) && v >= 0 ? { volume: v } : {}) });
  });
  const volume = object(item.meta).regularMarketVolume;
  return { bars, volume: valid(volume) && volume >= 0 ? volume : null };
}

async function parallel<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

export class MarketScanner {
  private cache = new Map<string, { expires: number; report: MarketScan }>();
  private pending = new Map<string, Promise<MarketScan>>();

  constructor(private readonly fetcher: typeof fetch = fetch, private readonly now = () => new Date()) {}

  async scan(request: ScanRequest): Promise<MarketScan> {
    if (request.symbol && !catalog.has(request.symbol)) throw new ScannerError("Choose an NSE stock supported by XOCRISK, such as RELIANCE or TCS. US stocks and indices are not part of this scanner.", 400);
    const now = this.now();
    if (request.mode === "orb" && (!marketStatus(now).isOpen || now.getTime() < sessionOpen(istDate(now)) + 20 * 60_000)) {
      throw new ScannerError("Opening-range scans run during the NSE session, from 09:35 to 15:30 IST. Ask for a daily market scan or analyze a stock using its completed daily closes.", 409);
    }
    const key = `${request.mode}|${request.symbol ?? request.scope ?? "nifty500"}|${request.mode === "daily" ? istDate(lastSessionClose(now)) : istDate(now)}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > now.getTime()) return { ...cached.report, cached: true };
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.pending.size >= 3) throw new ScannerError("The scanner is busy. Try again in a moment.", 429);
    const work = this.run(request, now).then(report => {
      if (report.counts.scanned > 0) {
        if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { expires: this.now().getTime() + (request.mode === "daily" ? 300_000 : 60_000), report });
      }
      return report;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, work);
    return work;
  }

  private async json(path: string, signal: AbortSignal): Promise<unknown> {
    for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
      signal.throwIfAborted();
      try {
        const response = await this.fetcher(`https://${host}${path}`, {
          headers: { "User-Agent": "Mozilla/5.0 XOCRISK-scanner/1.0" },
          signal: AbortSignal.any([signal, AbortSignal.timeout(4500)]),
        });
        if (response.ok) return await response.json();
        // Authentication, permission and invalid-symbol failures are not retried.
        if (response.status !== 429 && response.status < 500) break;
      } catch { if (signal.aborted) throw new ScannerError("Market data request timed out."); }
    }
    throw new ScannerError("Yahoo Finance chart data is temporarily unavailable.");
  }

  private async run(request: ScanRequest, now: Date): Promise<MarketScan> {
    // Bound total network work to fit a serverless request; unfinished charts remain explicitly partial.
    const signal = AbortSignal.timeout(24_000);
    const selected = request.symbol ? [catalog.get(request.symbol)!]
      : instruments.filter(i => request.scope !== "nifty50" || i.nifty50);
    const symbols = selected.map(i => i.symbol), daily = request.mode === "daily";
    const expectedDate = daily ? istDate(lastSessionClose(now)) : istDate(now);
    const cutoff = new Date(Math.floor(now.getTime() / 300_000) * 300_000);
    const counts: MarketScan["counts"] = { requested: symbols.length, fetched: 0, failed: 0, stale: 0,
      insufficient: 0, filtered: 0, scanned: 0, candidates: 0, checked: 0, unchecked: 0, matched: 0 };
    const data = new Map<string, ScanSeries>();
    const batches: string[][] = [];
    for (let i = 0; i < symbols.length; i += 20) batches.push(symbols.slice(i, i + 20));
    await parallel(batches, 3, async batch => {
      if (signal.aborted) return;
      try {
        const query = new URLSearchParams({ symbols: batch.map(s => `${s}.NS`).join(","), range: daily ? "3mo" : "1d", interval: daily ? "1d" : "5m" });
        const body = object(await this.json(`/v7/finance/spark?${query}`, signal));
        for (const item of array(object(body.spark).result)) {
          const row = object(item), sym = String(row.symbol).replace(/\.NS$/, "");
          if (!batch.includes(sym)) continue;
          const series = parseSeries(array(row.response)[0]);
          if (series.bars.length) data.set(sym, series);
        }
      } catch { /* Count absent charts below; never manufacture an empty successful chart. */ }
    });
    counts.fetched = data.size;
    counts.failed = symbols.length - data.size;
    const minPrice = request.symbol ? 0 : 5;
    const stocks: ScanStock[] = [];
    const candidates: { symbol: string; turnover: number }[] = [];
    const turnover = new Map<string, number>();
    const staleDates = new Set<string>();
    for (const symbol of symbols) {
      const series = data.get(symbol);
      if (!series) continue;
      const bars = daily ? completedDays(series.bars, now) : intradayBars(series.bars, cutoff);
      if (daily && bars?.length && istDate(new Date(bars.at(-1)!.time)) !== expectedDate) {
        staleDates.add(istDate(new Date(bars.at(-1)!.time))); counts.stale++; continue;
      }
      if (!daily && !series.bars.some(b => istDate(new Date(b.time)) === expectedDate)) {
        staleDates.add(istDate(new Date(Math.max(...series.bars.map(b => b.time))))); counts.stale++; continue;
      }
      if (!bars || bars.length < (daily ? 30 : 4)) { counts.insufficient++; continue; }
      if (bars.at(-1)!.close < minPrice) { counts.filtered++; continue; }
      counts.scanned++;
      const traded = bars.at(-1)!.close * (series.volume ?? 0);
      turnover.set(symbol, traded);
      if (daily) {
        const stock = dailyAnalysis(symbol, catalog.get(symbol)!.name, bars);
        if (stock.setups.length || request.symbol) stocks.push(stock);
      } else {
        const top = Math.max(...bars.slice(0, 3).map(b => b.close));
        if (request.symbol || bars.slice(3).some(b => b.close >= top)) candidates.push({ symbol, turnover: traded });
      }
    }
    if (!daily) {
      candidates.sort((a, b) => b.turnover - a.turnover || a.symbol.localeCompare(b.symbol));
      counts.candidates = candidates.length;
      const check = candidates.slice(0, 50);
      await parallel(check, 5, async ({ symbol }) => {
        if (signal.aborted) return;
        try {
          const query = new URLSearchParams({ range: "1d", interval: "5m" });
          const body = object(await this.json(`/v8/finance/chart/${encodeURIComponent(`${symbol}.NS`)}?${query}`, signal));
          const series = parseSeries(array(object(body.chart).result)[0]);
          const bars = intradayBars(series.bars, cutoff);
          if (!bars) return;
          const stock = openingRangeAnalysis(symbol, catalog.get(symbol)!.name, bars);
          if (!stock) return;
          counts.checked++;
          if (stock.setups.length || request.symbol) stocks.push(stock);
        } catch { /* Unchecked below includes failed confirmation and the confirmation cap. */ }
      });
      counts.unchecked = candidates.length - counts.checked;
    } else { counts.checked = counts.scanned; }
    counts.matched = stocks.filter(s => s.setups.length > 0).length;
    stocks.sort((a, b) => daily ? (turnover.get(b.symbol)! - turnover.get(a.symbol)! || a.symbol.localeCompare(b.symbol))
      : (b.signalAt ?? "").localeCompare(a.signalAt ?? "") || a.symbol.localeCompare(b.symbol));
    const warnings: string[] = [];
    if (counts.failed) warnings.push(`${counts.failed} charts could not be fetched.`);
    if (counts.stale) warnings.push(`${counts.stale} charts were from older sessions (${[...staleDates].sort().slice(-3).join(", ")}) and excluded.`);
    if (counts.insufficient) warnings.push(`${counts.insufficient} charts had missing bars or insufficient history.`);
    if (counts.filtered) warnings.push(`${counts.filtered} stocks were below the ₹${minPrice} price floor.`);
    if (counts.unchecked) warnings.push(`${counts.unchecked} candidates were not confirmed; at most 50 are checked, ranked by reported price × volume.`);
    if (signal.aborted) warnings.push("The scan reached its time limit; coverage may be incomplete.");
    if (daily && marketStatus(now).isOpen) warnings.push("Today's unfinished daily candle is excluded; this is an analysis of the last completed session.");
    if (!daily) warnings.push("A first breakout earlier in the session may already have reversed. Signal price and latest completed close are shown separately.");
    if (!counts.scanned) warnings.push("No fresh, usable charts were available. This does not mean that no setups exist.");
    if (counts.matched > 50) warnings.push(`Showing 50 of ${counts.matched} matches.`);
    return { mode: request.mode, scope: request.symbol ?? (request.scope === "nifty50" ? "XOCRISK NIFTY 50 list" : "XOCRISK NIFTY 500 list"),
      source: "Yahoo Finance (delayed/unofficial)", generatedAt: now.toISOString(), asOf: daily ? `${expectedDate} close` : cutoff.toISOString(),
      cached: false, partial: counts.failed + counts.stale + counts.insufficient + counts.unchecked > 0,
      counts, filters: { minPrice, minVolume: 0 }, stocks: stocks.slice(0, 50), warnings };
  }
}
