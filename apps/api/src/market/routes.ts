import type { FastifyInstance } from "fastify";
import { isQuotedSymbol, yahooSymbol } from "./feed.js";

export type ChartRange = "1D" | "1W" | "1M" | "6M" | "1Y" | "5Y";
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type Chart = { symbol: string; range: ChartRange; previousClose: number | null; fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null; candles: Candle[] };

// Yahoo range/interval per chart range, and how long a fetched chart is reused.
const ranges: Record<ChartRange, { range: string; interval: string; ttlMs: number }> = {
  "1D": { range: "1d", interval: "5m", ttlMs: 5 * 60_000 },
  "1W": { range: "5d", interval: "15m", ttlMs: 10 * 60_000 },
  "1M": { range: "1mo", interval: "1d", ttlMs: 60 * 60_000 },
  "6M": { range: "6mo", interval: "1d", ttlMs: 3 * 60 * 60_000 },
  "1Y": { range: "1y", interval: "1d", ttlMs: 3 * 60 * 60_000 },
  "5Y": { range: "5y", interval: "1wk", ttlMs: 12 * 60 * 60_000 },
};
const cache = new Map<string, { expires: number; chart: Chart }>();
const maxCacheEntries = 600;
const round = (value: number) => Number(value.toFixed(2));

async function fetchChart(symbol: string, range: ChartRange): Promise<Chart> {
  const { range: yahooRange, interval } = ranges[range];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol(symbol))}?range=${yahooRange}&interval=${interval}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Yahoo returned ${response.status}`);
  const body = await response.json() as { chart?: { result?: {
    meta?: { chartPreviousClose?: number; fiftyTwoWeekHigh?: number; fiftyTwoWeekLow?: number };
    timestamp?: number[];
    indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[];
      close?: (number | null)[]; volume?: (number | null)[] }[] };
  }[] } };
  const result = body.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const candles: Candle[] = [];
  (result?.timestamp ?? []).forEach((time, index) => {
    const open = quote?.open?.[index], high = quote?.high?.[index], low = quote?.low?.[index], close = quote?.close?.[index];
    if (open == null || high == null || low == null || close == null) return; // gaps in the series
    candles.push({ time: time * 1000, open: round(open), high: round(high), low: round(low), close: round(close),
      volume: Math.round(quote?.volume?.[index] ?? 0) });
  });
  const meta = result?.meta;
  return {
    symbol, range, candles,
    previousClose: meta?.chartPreviousClose ? round(meta.chartPreviousClose) : null,
    fiftyTwoWeekHigh: meta?.fiftyTwoWeekHigh ? round(meta.fiftyTwoWeekHigh) : null,
    fiftyTwoWeekLow: meta?.fiftyTwoWeekLow ? round(meta.fiftyTwoWeekLow) : null,
  };
}

export async function registerMarketRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { symbol?: string; range?: string } }>("/v1/market/chart", async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ message: "Sign in to continue." });
    const symbol = request.query.symbol ?? "";
    const range = (request.query.range ?? "1D") as ChartRange;
    if (!isQuotedSymbol(symbol)) return reply.code(400).send({ message: "Choose a supported stock or index." });
    if (!(range in ranges)) return reply.code(400).send({ message: "Choose a chart range: 1D, 1W, 1M, 6M, 1Y or 5Y." });

    const key = `${symbol}|${range}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.chart;
    try {
      const chart = await fetchChart(symbol, range);
      if (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value!);
      cache.set(key, { expires: Date.now() + ranges[range].ttlMs, chart });
      return chart;
    } catch (error) {
      request.log.warn(`Chart fetch failed for ${key}: ${String(error)}`);
      if (cached) return cached.chart; // stale is better than nothing
      return reply.code(502).send({ message: "Chart data is temporarily unavailable. Try again in a minute." });
    }
  });
}
