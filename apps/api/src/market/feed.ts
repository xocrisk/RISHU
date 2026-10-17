import type { Pool } from "pg";
import { istDate, lastSessionClose, marketStatus, type MarketStatus } from "./hours.js";
import { instruments } from "./instruments.js";

export type Quote = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  /** Day open; null until it has been fetched for the stock's latest session. */
  open: number | null;
  high: number;
  low: number;
  /** Previous session close. */
  close: number;
  volume: number;
  marketTime: string;
};

type Logger = { info: (message: string) => void; warn: (message: string) => void };

type SparkMeta = {
  symbol: string; regularMarketPrice?: number; chartPreviousClose?: number; regularMarketDayHigh?: number;
  regularMarketDayLow?: number; regularMarketVolume?: number; regularMarketTime?: number;
};

const refreshIntervalMs = 10 * 60 * 1000;
// Yahoo publishes the closing auction price a few minutes after 15:30.
const closingSettleMs = 10 * 60 * 1000;
const batchSize = 20; // Yahoo's spark endpoint accepts at most 20 symbols per request.
const yahooHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
};
const names = new Map(instruments.map((instrument) => [instrument.symbol, instrument.name]));
const order = new Map(instruments.map((instrument, index) => [instrument.symbol, index]));

const yahooSymbol = (symbol: string) => `${symbol}.NS`;
const round = (value: number) => Number(value.toFixed(2));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Delayed NSE prices for the NIFTY 500, from Yahoo Finance, cached in memory and in the market_quotes table.
 * Refreshes every 10 minutes while the market is open, and once after each close for the closing prices.
 */
export class MarketFeed {
  private quotes = new Map<string, Quote>();
  private loading: Promise<void> | null = null;
  private refreshing: Promise<void> | null = null;
  private fetchingOpens = false;
  private lastAttemptAt: Date | null = null;
  private lastOpensAttemptAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private listeners: (() => Promise<void>)[] = [];
  lastUpdatedAt: Date | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly log: Logger = console,
    private readonly now: () => Date = () => new Date(),
  ) {}

  status(): MarketStatus {
    return marketStatus(this.now());
  }

  /** Runs after every successful refresh, e.g. to fill limit orders at the new prices. */
  onRefresh(listener: () => Promise<void>): void {
    this.listeners.push(listener);
  }

  start(): void {
    void this.ensureFresh().catch((error) => this.log.warn(`Market feed refresh failed: ${String(error)}`));
    this.timer = setInterval(() => {
      void this.ensureFresh().catch((error) => this.log.warn(`Market feed refresh failed: ${String(error)}`));
    }, 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Quotes for every tradeable stock, NIFTY 50 first. Starts a background refresh when the data is stale. */
  async list(): Promise<Quote[]> {
    await this.load();
    if (this.quotes.size === 0) await this.ensureFresh();
    else if (this.isStale()) void this.ensureFresh().catch((error) => this.log.warn(`Market feed refresh failed: ${String(error)}`));
    return [...this.quotes.values()].sort((a, b) => (order.get(a.symbol) ?? 1e9) - (order.get(b.symbol) ?? 1e9));
  }

  async get(symbol: string): Promise<Quote | undefined> {
    await this.list();
    return this.quotes.get(symbol);
  }

  private isStale(): boolean {
    if (!this.lastUpdatedAt) return true;
    const now = this.now();
    // Some stocks are missing (e.g. a refresh partly failed): retry, but no more than every 10 minutes.
    const incomplete = this.quotes.size < instruments.length - 10;
    if (incomplete && (!this.lastAttemptAt || now.getTime() - this.lastAttemptAt.getTime() >= refreshIntervalMs)) return true;
    if (marketStatus(now).isOpen) return now.getTime() - this.lastUpdatedAt.getTime() >= refreshIntervalMs;
    // Closed: refresh once the last session's closing prices have settled.
    const settled = lastSessionClose(now).getTime() + closingSettleMs;
    return now.getTime() >= settled && this.lastUpdatedAt.getTime() < settled;
  }

  private load(): Promise<void> {
    this.loading ??= (async () => {
      const result = await this.pool.query<{
        symbol: string; name: string; price: string; previous_close: string; high: string; low: string;
        volume: string; market_time: Date; open: string | null; open_date: string | null; updated_at: Date;
      }>("SELECT symbol, name, price, previous_close, high, low, volume, market_time, open, open_date::text, updated_at FROM market_quotes");
      for (const row of result.rows) {
        if (!names.has(row.symbol)) continue; // dropped from the NIFTY 500
        const sessionOpen = row.open !== null && row.open_date === istDate(row.market_time) ? Number(row.open) : null;
        this.quotes.set(row.symbol, this.toQuote(row.symbol, Number(row.price), Number(row.previous_close),
          Number(row.high), Number(row.low), Number(row.volume), row.market_time, sessionOpen));
        if (!this.lastUpdatedAt || row.updated_at > this.lastUpdatedAt) this.lastUpdatedAt = row.updated_at;
      }
    })().catch((error) => {
      this.loading = null;
      throw error;
    });
    return this.loading;
  }

  private ensureFresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      await this.load();
      if (this.quotes.size > 0 && !this.isStale()) {
        // Prices are fresh, but day opens may still be missing (e.g. after a restart).
        if (Date.now() - this.lastOpensAttemptAt >= refreshIntervalMs) void this.refreshOpens();
        return;
      }
      await this.refresh();
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private toQuote(symbol: string, price: number, previousClose: number, high: number, low: number,
    volume: number, marketTime: Date, open: number | null): Quote {
    const change = round(price - previousClose);
    return {
      symbol, name: names.get(symbol) ?? symbol, price, change,
      changePercent: previousClose ? round((change / previousClose) * 100) : 0,
      open, high, low, close: previousClose, volume, marketTime: marketTime.toISOString(),
    };
  }

  private async refresh(): Promise<void> {
    this.lastAttemptAt = this.now();
    const symbols = instruments.map((instrument) => instrument.symbol);
    let updated = 0;
    for (let start = 0; start < symbols.length; start += batchSize) {
      const batch = symbols.slice(start, start + batchSize);
      try {
        updated += await this.refreshBatch(batch);
      } catch (error) {
        this.log.warn(`Market feed batch ${batch[0]}..${batch.at(-1)} failed: ${String(error)}`);
      }
      await sleep(250);
    }
    if (updated === 0) throw new Error("No quotes could be fetched.");
    this.lastUpdatedAt = this.now();
    const missing = symbols.filter((symbol) => !this.quotes.has(symbol));
    this.log.info(`Market feed updated ${updated} quotes${missing.length ? `; no data for ${missing.join(", ")}` : ""}.`);
    for (const listener of this.listeners) {
      await listener().catch((error) => this.log.warn(`Market feed listener failed: ${String(error)}`));
    }
    void this.refreshOpens();
  }

  private async refreshBatch(batch: string[]): Promise<number> {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?range=1d&interval=1d&symbols=${batch.map((symbol) => encodeURIComponent(yahooSymbol(symbol))).join(",")}`;
    const response = await fetch(url, { headers: yahooHeaders, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Yahoo returned ${response.status}`);
    const body = await response.json() as { spark?: { result?: { symbol: string; response?: { meta?: SparkMeta }[] }[] } };
    const rows = (body.spark?.result ?? []).flatMap((entry) => {
      const meta = entry.response?.[0]?.meta;
      const symbol = entry.symbol.replace(/\.NS$/, "");
      if (!meta?.regularMarketPrice || !meta.chartPreviousClose || !meta.regularMarketTime || !names.has(symbol)) return [];
      return [{
        symbol,
        price: round(meta.regularMarketPrice),
        previousClose: round(meta.chartPreviousClose),
        high: round(meta.regularMarketDayHigh ?? meta.regularMarketPrice),
        low: round(meta.regularMarketDayLow ?? meta.regularMarketPrice),
        volume: Math.round(meta.regularMarketVolume ?? 0),
        marketTime: new Date(meta.regularMarketTime * 1000),
      }];
    });
    if (!rows.length) return 0;
    await this.pool.query(
      `INSERT INTO market_quotes (symbol, name, price, previous_close, high, low, volume, market_time, updated_at)
       SELECT r.symbol, r.name, r.price, r.previous_close, r.high, r.low, r.volume, r.market_time, now()
       FROM json_to_recordset($1::json) AS r(symbol TEXT, name TEXT, price NUMERIC, previous_close NUMERIC,
         high NUMERIC, low NUMERIC, volume BIGINT, market_time TIMESTAMPTZ)
       ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price,
         previous_close = EXCLUDED.previous_close, high = EXCLUDED.high, low = EXCLUDED.low,
         volume = EXCLUDED.volume, market_time = EXCLUDED.market_time, updated_at = now()`,
      [JSON.stringify(rows.map((row) => ({
        symbol: row.symbol, name: names.get(row.symbol), price: row.price, previous_close: row.previousClose,
        high: row.high, low: row.low, volume: row.volume, market_time: row.marketTime.toISOString(),
      })))],
    );
    for (const row of rows) {
      const existing = this.quotes.get(row.symbol);
      // Keep the day open only if it belongs to the same session as the new price.
      const open = existing?.open != null && istDate(new Date(existing.marketTime)) === istDate(row.marketTime) ? existing.open : null;
      this.quotes.set(row.symbol, this.toQuote(row.symbol, row.price, row.previousClose, row.high, row.low,
        row.volume, row.marketTime, open));
    }
    return rows.length;
  }

  /** Fetches the day open (not included in the batch endpoint) for stocks that don't have one for their latest session. */
  private async refreshOpens(): Promise<void> {
    if (this.fetchingOpens) return;
    this.fetchingOpens = true;
    this.lastOpensAttemptAt = Date.now();
    const pending = [...this.quotes.values()].filter((quote) => quote.open === null).map((quote) => quote.symbol);
    const workers = Array.from({ length: 4 }, async () => {
      for (let symbol = pending.shift(); symbol; symbol = pending.shift()) {
        try {
          await this.refreshOpen(symbol);
        } catch {
          // Leave the open empty; it is retried on the next refresh.
        }
        await sleep(100);
      }
    });
    await Promise.all(workers).finally(() => {
      this.fetchingOpens = false;
    });
  }

  private async refreshOpen(symbol: string): Promise<void> {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?range=1d&interval=1d`;
    const response = await fetch(url, { headers: yahooHeaders, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return;
    const body = await response.json() as {
      chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { open?: (number | null)[] }[] } }[] };
    };
    const result = body.chart?.result?.[0];
    const open = result?.indicators?.quote?.[0]?.open?.at(-1);
    const sessionStart = result?.timestamp?.at(-1);
    const quote = this.quotes.get(symbol);
    if (!open || !sessionStart || !quote) return;
    const sessionDate = istDate(new Date(sessionStart * 1000));
    if (sessionDate !== istDate(new Date(quote.marketTime))) return;
    await this.pool.query("UPDATE market_quotes SET open = $2, open_date = $3 WHERE symbol = $1", [symbol, round(open), sessionDate]);
    this.quotes.set(symbol, { ...quote, open: round(open) });
  }
}
