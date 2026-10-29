import type { MarketScan, ScanRequest, ScanSetup, ScanStock } from "@xocrisk/core";
import { answer, guardedAnswer, type AiContext } from "./ai-brain.ts";
import type { TutorLine } from "./trading-tutor.ts";

type Intent = ScanRequest | { message: string } | null;
const labels: Record<ScanSetup, string> = { breakout_20d: "20-day closing-high breakout", bull_flag: "bull flag on closes",
  reclaim_ma20: "reclaimed the 20-day average", oversold: "oversold (RSI below 30)", oversold_bounce: "oversold bounce", orb: "opening-range breakout" };
const time = (value: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) + " IST";
const rupees = (value: number) => `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function scanIntent(input: string, context: AiContext): Intent {
  const text = input.toLowerCase().replace(/मार्केट|बाज़ार|बाजार/g, " market ").replace(/स्कैन/g, " scan ")
    .replace(/विश्लेषण|एनालाइज/g, " analysis ").replace(/रिलायंस/g, " reliance ");
  // Learning and account questions retain the existing tutor/account paths.
  if (/\b(lesson|quiz|example|explain|what is|what are|kya hai|kaise|samjhao|sikhao|portfolio|holdings|strategy)\b/.test(text)) return null;
  const words: string[] = text.toUpperCase().match(/[A-Z0-9&-]+/g) ?? [];
  const stocks = [...context.quotes.values()].filter(q => q.industry !== "Index");
  const phrase = ` ${words.join(" ")} `;
  const named = stocks.filter(q => {
    const name = q.name.toUpperCase().replace(/\b(LTD|LIMITED)\.?/g, "").replace(/[^A-Z0-9&-]+/g, " ").trim();
    return name.includes(" ") && phrase.includes(` ${name} `);
  });
  const exact = stocks.filter(q => words.includes(q.symbol));
  // A bare RELIANCE ticker must not also match Reliance Power; full company names
  // are more specific still, and shared first names such as Tata are ambiguous.
  const matches = named.length ? named : exact.length ? exact : stocks.filter(q =>
    q.name.split(" ")[0].length > 3 && words.includes(q.name.split(" ")[0].toUpperCase()));
  const requested = /\b(scan|scanner|screen|screener|analy[sz]e|analy[sz]er|analysis|analize|breakouts?|oversold|bull flag|setups?)\b/.test(text)
    || (matches.length > 0 && /\b(rsi|ma20|technical|indicator)\b/.test(text));
  if (!requested) return null;
  if (matches.length > 1) return { message: "Please analyze one stock at a time, using its exact NSE ticker (for example: TCS analyze karo)." };
  const mode = /\b(orb|opening[ -]range|intraday)\b/.test(text) ? "orb" : "daily";
  if (matches.length === 1) return { mode, symbol: matches[0].symbol };
  if (/\b(nifty\s*50|nifty\s*500|market|bazaar|bazar|stocks|setups|trader-scanner)\b/.test(text)
    || /^(scan|scan karo|daily scan|opening range breakout scan|orb scan|find breakouts|find oversold stocks)[.!? ]*$/.test(text.trim())) {
    return { mode, scope: /\bnifty\s*50\b/.test(text) ? "nifty50" : "nifty500" };
  }
  return { message: "Which NSE stock should I analyze? Use a supported ticker such as RELIANCE or TCS, or ask 'market scan karo'. This scanner covers XOCRISK's NSE stock list." };
}

function stockText(stock: ScanStock, mode: ScanRequest["mode"]): string {
  const result = stock.setups.length ? stock.setups.map(s => labels[s]).join(", ") : "none of the scanned setup rules matched";
  if (mode === "daily") return `${stock.symbol}: completed close ${rupees(stock.price)}; RSI(14) ${stock.rsi?.toFixed(1)}; MA20 ${rupees(stock.ma20!)}; previous 20-session closing high ${rupees(stock.high20!)}.\nMatched rules: ${result}.`;
  return `${stock.symbol}: opening range ${rupees(stock.rangeLow!)}–${rupees(stock.rangeHigh!)} (09:15–09:30 IST).\n${stock.signalAt ? `First breakout: ${time(stock.signalAt)}, signal close ${rupees(stock.signalPrice!)}.` : "No completed five-minute close above the opening-range high."}\nLatest completed close: ${rupees(stock.price)} at ${time(stock.asOf)}; ${stock.aboveRange ? "still above" : "at or below"} the range high.`;
}

export function formatMarketScan(report: MarketScan): string {
  const c = report.counts;
  const lines = [
    `${report.mode === "daily" ? "Daily setup analysis" : "Opening-range breakout analysis"} — ${report.scope}`,
    `${c.scanned ? "Data" : "Required data cutoff"}: ${report.mode === "daily" ? `${report.asOf} (IST)` : time(report.asOf)}. Source: ${report.source}.${report.cached ? " Reused a recent scan." : ""}`,
    `${report.partial ? "PARTIAL: " : ""}Fetched ${c.fetched}/${c.requested} charts; ${c.scanned} usable after freshness, history and price checks; ${c.matched} matched a rule.`,
  ];
  if (report.mode === "orb") lines.push(`${c.candidates} candidates; ${c.checked} checked with highs/lows; ${c.unchecked} unchecked.`);
  lines.push(`Filters: price ${rupees(report.filters.minPrice)} or above; no minimum-volume filter.`);
  if (c.scanned === 0) lines.push("Analysis unavailable: no fresh, usable charts. Please retry later.");
  else if (report.stocks.length === 0) lines.push("No matches in the charts checked. Unchecked or unavailable charts may contain other setups.");
  const shown = report.stocks.slice(0, 8);
  lines.push(...shown.map(s => `\n${stockText(s, report.mode)}`));
  if (report.stocks.length > shown.length) lines.push(`\nShowing ${shown.length} of ${c.matched} matches, ${report.mode === "daily" ? "ranked by reported price × volume" : "most recent first breakout first"}. Ask to analyze a named stock for its own result.`);
  if (report.warnings.length) lines.push(`\nCoverage notes: ${report.warnings.join(" ")}`);
  lines.push("\nThese are chart-rule matches, not buy/sell recommendations. Delayed data can change; recheck the chart before using a signal. No order was placed.");
  return lines.join("\n");
}

export async function answerWithMarket(input: string, context: AiContext, history: TutorLine[],
  fetcher: (path: string, init?: RequestInit) => Promise<Response>, signal?: AbortSignal): Promise<string> {
  const guarded = guardedAnswer(input, context);
  if (guarded) return guarded;
  const intent = scanIntent(input, context);
  if (!intent) return answer(input, context, history);
  if ("message" in intent) return intent.message;
  const query = new URLSearchParams({ mode: intent.mode, ...(intent.symbol ? { symbol: intent.symbol } : { scope: intent.scope ?? "nifty500" }) });
  try {
    const response = await fetcher(`/v1/market/scan?${query}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35_000)]) : AbortSignal.timeout(35_000) });
    if (response.status === 401) return "Please sign in again to run market analysis.";
    const body = await response.json();
    if (!response.ok) return typeof body?.message === "string" ? body.message : "Market analysis is temporarily unavailable. Please retry.";
    if (!body || !["daily", "orb"].includes(body.mode) || !body.counts || !Array.isArray(body.stocks) || !Array.isArray(body.warnings)) throw new Error("Invalid scan response");
    return formatMarketScan(body as MarketScan);
  } catch {
    return "I couldn't fetch reliable chart data for this analysis. Check your connection and try again. I haven't inferred a signal from missing data.";
  }
}
