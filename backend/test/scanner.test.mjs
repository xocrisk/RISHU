import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { MarketScanner, parseSeries } from "../dist/market/scanner.js";
import { dailyAnalysis, completedDays, intradayBars, openingRangeAnalysis, rsi } from "../dist/market/scanner-math.js";
import { isTradingDay } from "../dist/market/hours.js";
import { registerScannerRoutes } from "../dist/market/scanner-routes.js";

const instant = text => new Date(`${text}+05:30`);
const now = instant("2026-10-29T12:00:00");
function history(end = "2026-10-28", values) {
  const dates = [];
  for (let date = new Date(`${end}T00:00:00Z`); dates.length < 40; date.setUTCDate(date.getUTCDate() - 1)) {
    const d = date.toISOString().slice(0, 10);
    if (isTradingDay(d)) dates.unshift(d);
  }
  return dates.map((date, i) => ({ time: instant(`${date}T09:15:00`).getTime(), close: values?.[i] ?? 100 + i, volume: 200000 }));
}
function intraday(end = 12 * 60, day = "2026-10-29") {
  const bars = [];
  for (let minute = 9 * 60 + 15, i = 0; minute < end; minute += 5, i++) {
    const close = i < 3 ? 100 : i === 3 ? 103 : 99;
    bars.push({ time: instant(`${day}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00`).getTime(), close, high: close + 1, low: close - 1 });
  }
  return bars;
}
function yahooSeries(bars) {
  return { timestamp: bars.map(b => b.time / 1000), meta: { regularMarketVolume: 200000 },
    indicators: { quote: [{ close: bars.map(b => b.close), high: bars.map(b => b.high ?? b.close + 1), low: bars.map(b => b.low ?? b.close - 1) }] } };
}
const dailyFetch = (bars, count = () => {}) => async url => {
  count(url);
  const symbols = new URL(url).searchParams.get("symbols").split(",");
  return Response.json({ spark: { result: symbols.map(symbol => ({ symbol, response: [yahooSeries(bars)] })) } });
};

test("completed daily bars exclude unfinished, future, holiday and duplicate sessions", () => {
  const old = history(), today = history("2026-10-29").at(-1);
  const holiday = { ...today, time: instant("2026-10-20T09:15:00").getTime() };
  const future = { ...today, time: instant("2026-10-30T09:15:00").getTime() };
  assert.deepEqual(completedDays([...old, today, holiday, future, old.at(-1)], now), old);
  assert.equal(completedDays([...old, today], instant("2026-10-29T15:30:00")).at(-1).time, today.time);
});

test("Wilder RSI handles flat, rising, falling and a known reference series", () => {
  assert.equal(rsi(Array(30).fill(50)), 50);
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => i + 1)), 100);
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => 100 - i)), 0);
  const reference = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
  assert.ok(Math.abs(rsi(reference) - 70.4641) < 0.001);
});

test("daily setup rules use the previous 20 closes, not the current close in the threshold", () => {
  const result = dailyAnalysis("TCS", "TCS", history());
  assert.equal(result.high20, 138);
  assert.equal(result.ma20, 129.5);
  assert.ok(result.setups.includes("breakout_20d"));
  const falling = history(undefined, Array.from({ length: 40 }, (_, i) => 200 - i));
  assert.deepEqual(dailyAnalysis("TCS", "TCS", falling).setups, ["oversold"]);
  falling.at(-1).close = falling.at(-2).close + 0.5;
  assert.ok(dailyAnalysis("TCS", "TCS", falling).setups.includes("oversold_bounce"));
  const reclaim = history(undefined, [...Array(38).fill(100), 98, 101]);
  assert.ok(dailyAnalysis("TCS", "TCS", reclaim).setups.includes("reclaim_ma20"));
  const flag = history(undefined, [...Array(24).fill(100), ...Array.from({length: 11}, (_, i) => 100 + 2 * i), ...Array(5).fill(119)]);
  assert.ok(dailyAnalysis("TCS", "TCS", flag).setups.includes("bull_flag"));
});

test("ORB uses NSE 09:15 range, completed bars and separates an earlier signal from its reversal", () => {
  const bars = intraday(), cutoff = instant("2026-10-29T09:35:00");
  assert.equal(intradayBars(bars, instant("2026-10-29T09:34:59")), null);
  assert.equal(intradayBars(bars, cutoff).length, 4);
  const result = openingRangeAnalysis("TCS", "TCS", intradayBars(bars, now));
  assert.equal(result.signalAt, cutoff.toISOString());
  assert.equal(result.signalPrice, 103);
  assert.equal(result.price, 99);
  assert.equal(result.aboveRange, false);
  assert.equal(result.rangeHigh, 101);
  assert.equal(intradayBars(bars.filter((_, i) => i !== 5), now), null);
  assert.equal(openingRangeAnalysis("TCS", "TCS", bars.map(b => ({ ...b, high: undefined }))), null);
});

test("malformed bars remain gaps and never become false price signals", () => {
  const series = parseSeries({ timestamp: [1,2,3,4,5], indicators: { quote: [{ close: [null, 0, -5, NaN, 100], high: [1,1,1,1,99], low: [1,1,1,1,101] }] } });
  assert.equal(series.bars.length, 1);
  assert.equal(series.bars[0].high, undefined);
  assert.equal(parseSeries(null).bars.length, 0);
});

test("single-stock daily scan fetches on demand, coalesces requests and expires cache", async () => {
  let calls = 0, clock = now;
  const scanner = new MarketScanner(dailyFetch(history(), () => calls++), () => clock);
  const request = { mode: "daily", symbol: "TCS" };
  const [a, b] = await Promise.all([scanner.scan(request), scanner.scan(request)]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.counts.scanned, 1);
  assert.equal(a.stocks[0].symbol, "TCS");
  assert.equal(a.asOf, "2026-10-28 close");
  assert.equal((await scanner.scan(request)).cached, true);
  clock = new Date(now.getTime() + 301000);
  assert.equal((await scanner.scan(request)).cached, false);
  assert.equal(calls, 2);
});

test("missing and stale data are reported as unavailable, not a successful zero-match scan", async () => {
  for (const fetcher of [async () => new Response(null, { status: 503 }), dailyFetch(history("2026-10-27"))]) {
    const report = await new MarketScanner(fetcher, () => now).scan({ mode: "daily", symbol: "TCS" });
    assert.equal(report.partial, true);
    assert.equal(report.counts.scanned, 0);
    assert.equal(report.stocks.length, 0);
    assert.ok(report.warnings.some(w => w.includes("does not mean")));
  }
});

test("market scan covers catalog, bounds provider concurrency and truthfully reports presentation limit", async () => {
  let active = 0, peak = 0;
  const base = dailyFetch(history());
  const report = await new MarketScanner(async url => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    const result = await base(url); active--; return result;
  }, () => now).scan({ mode: "daily", scope: "nifty500" });
  assert.ok(report.counts.requested >= 500);
  assert.equal(report.counts.fetched, report.counts.requested);
  assert.equal(report.counts.matched, report.counts.requested);
  assert.equal(report.stocks.length, 50);
  assert.ok(peak <= 3);
});

test("ORB caps confirmations and reports unchecked candidates", async () => {
  let confirmations = 0;
  const fetcher = async url => {
    if (url.includes("/spark?")) return dailyFetch(intraday())(url);
    confirmations++;
    return Response.json({ chart: { result: [yahooSeries(intraday())] } });
  };
  const report = await new MarketScanner(fetcher, () => now).scan({ mode: "orb", scope: "nifty500" });
  assert.equal(confirmations, 50);
  assert.equal(report.counts.checked, 50);
  assert.equal(report.counts.unchecked, report.counts.candidates - 50);
  assert.equal(report.partial, true);
  assert.equal(report.stocks[0].aboveRange, false);
});

test("closed sessions and unsupported symbols never contact Yahoo", async () => {
  const fail = async () => { assert.fail("No upstream request expected"); };
  const scanner = new MarketScanner(fail, () => instant("2026-10-31T12:00:00"));
  await assert.rejects(scanner.scan({ mode: "orb" }), /NSE session/);
  await assert.rejects(scanner.scan({ mode: "daily", symbol: "TSLA" }), /NSE stock/);
});

test("scan API requires authentication and validates mode/symbol before provider access", async () => {
  let calls = 0;
  const app = Fastify();
  app.addHook("onRequest", async request => { if (request.headers.authorization === "test") request.authUser = { id: "test" }; });
  await registerScannerRoutes(app, { scan: async request => { calls++; return { mode: request.mode }; } });
  try {
    assert.equal((await app.inject("/v1/market/scan")).statusCode, 401);
    for (const query of ["mode=anything", "symbol=https%3A%2F%2Fexample.com", "scope=all"]) {
      assert.equal((await app.inject({ url: `/v1/market/scan?${query}`, headers: { authorization: "test" } })).statusCode, 400);
    }
    assert.equal(calls, 0);
    const result = await app.inject({ url: "/v1/market/scan?symbol=TCS", headers: { authorization: "test" } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().mode, "daily");
    assert.equal(result.headers["cache-control"], "private, no-store");
  } finally { await app.close(); }
});
