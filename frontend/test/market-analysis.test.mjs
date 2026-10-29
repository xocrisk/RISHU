import test from "node:test";
import assert from "node:assert/strict";
import { answerWithMarket, scanIntent, formatMarketScan } from "../src/app/account/market-analysis.ts";

const quote = { symbol: "RELIANCE", name: "Reliance Industries", industry: "Energy", price: 1400, change: 1, changePercent: 1, low: 1300, high: 1500, marketTime: "2026-10-28T09:00:00Z" };
const context = { data: { user: { fullName: "Test" }, market: { quotes: [quote] } }, quotes: new Map([[quote.symbol, quote]]), indices: new Map() };
const report = { mode: "daily", scope: "RELIANCE", source: "Yahoo Finance (delayed/unofficial)", generatedAt: "2026-10-29T06:30:00Z",
  asOf: "2026-10-28 close", cached: false, partial: false, filters: { minPrice: 0, minVolume: 0 }, warnings: [],
  counts: { requested: 1, fetched: 1, failed: 0, stale: 0, insufficient: 0, filtered: 0, scanned: 1, candidates: 0, checked: 1, unchecked: 0, matched: 1 },
  stocks: [{ symbol: "RELIANCE", name: "Reliance Industries", price: 1400, rsi: 60, ma20: 1300, high20: 1390, setups: ["breakout_20d"], asOf: "2026-10-28T10:00:00Z" }] };

test("English and Hinglish questions route to real analysis, lessons retain tutor routing", () => {
  for (const text of ["Reliance analyze karo", "analyze RELIANCE", "Reliance ka analysis", "Reliance RSI", "रिलायंस विश्लेषण"]) {
    assert.deepEqual(scanIntent(text, context), { mode: "daily", symbol: "RELIANCE" }, text);
  }
  assert.deepEqual(scanIntent("market scan karo", context), { mode: "daily", scope: "nifty500" });
  assert.deepEqual(scanIntent("मार्केट स्कैन करो", context), { mode: "daily", scope: "nifty500" });
  assert.deepEqual(scanIntent("opening range breakout scan", context), { mode: "orb", scope: "nifty500" });
  assert.deepEqual(scanIntent("Nifty 50 scan", context), { mode: "daily", scope: "nifty50" });
  for (const text of ["RSI kya hai?", "explain bull flag", "review my strategy", "analyze my portfolio", "price of Reliance"]) assert.equal(scanIntent(text, context), null, text);
  assert.ok(scanIntent("TSLA analyze karo", context).message.includes("NSE"));
});

test("assistant calls authenticated scanner API and explains actual calculated values", async () => {
  let url;
  const result = await answerWithMarket("Reliance analyze karo", context, [], async path => { url = path; return Response.json(report); });
  assert.equal(url, "/v1/market/scan?mode=daily&symbol=RELIANCE");
  assert.match(result, /RSI\(14\) 60.0/);
  assert.match(result, /20-day closing-high breakout/);
  assert.match(result, /2026-10-28 close/);
  assert.match(result, /not buy\/sell recommendations/);
});

test("exact tickers and full company names take precedence over shared first names", () => {
  const power = { ...quote, symbol: "RPOWER", name: "Reliance Power Ltd." };
  const expanded = { ...context, quotes: new Map([...context.quotes, [power.symbol, power]]) };
  assert.deepEqual(scanIntent("Reliance analyze karo", expanded), { mode: "daily", symbol: "RELIANCE" });
  assert.deepEqual(scanIntent("Reliance Power analyze karo", expanded), { mode: "daily", symbol: "RPOWER" });
});

test("risk guards and learning questions never call the scanner", async () => {
  const fail = async () => assert.fail("No fetch expected");
  for (const text of ["predict Reliance price tomorrow analysis", "market scan guaranteed profit", "best stock for breakout"]) {
    assert.doesNotMatch(await answerWithMarket(text, context, [], fail), /Daily setup analysis/);
  }
  assert.match(await answerWithMarket("RSI kya hai?", context, [], fail), /RSI and momentum/);
});

test("failures, expired login and malformed responses do not produce fabricated analysis", async () => {
  for (const fetcher of [async () => { throw new Error("offline"); }, async () => Response.json({}), async () => new Response("bad response")]) {
    assert.match(await answerWithMarket("market scan karo", context, [], fetcher), /couldn't fetch reliable/);
  }
  assert.match(await answerWithMarket("market scan karo", context, [], async () => new Response(null, { status: 401 })), /sign in again/);
  assert.equal(await answerWithMarket("market scan karo", context, [], async () => Response.json({message:"The scanner is busy."}, {status:429})), "The scanner is busy.");
});

test("partial results, stale data, cache and reversed ORB signals remain visible", () => {
  const orb = { ...report, mode: "orb", cached: true, partial: true, asOf: "2026-10-29T06:30:00Z",
    counts: { ...report.counts, candidates: 10, checked: 1, unchecked: 9 }, warnings: ["9 candidates were not confirmed."],
    stocks: [{ symbol: "RELIANCE", price: 99, rangeLow: 98, rangeHigh: 101, signalPrice: 103,
      signalAt: "2026-10-29T04:05:00Z", asOf: "2026-10-29T06:30:00Z", aboveRange: false, setups: ["orb"] }] };
  const result = formatMarketScan(orb);
  assert.match(result, /PARTIAL/);
  assert.match(result, /9 unchecked/);
  assert.match(result, /Reused a recent scan/);
  assert.match(result, /signal close ₹103.00/);
  assert.match(result, /Latest completed close: ₹99.00/);
  assert.match(result, /at or below/);
  assert.match(formatMarketScan({...report, counts:{...report.counts, scanned:0}, stocks:[]}), /Analysis unavailable/);
});
