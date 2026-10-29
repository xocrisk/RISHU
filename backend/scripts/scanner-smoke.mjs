// Read-only upstream smoke check. Build @xocrisk/api first; no database/account is used.
import { MarketScanner } from "../dist/market/scanner.js";
const symbol = process.argv[2] ?? "RELIANCE";
const scanner = new MarketScanner();
const report = await scanner.scan(symbol === "market" ? { mode: "daily", scope: "nifty500" } : { mode: "daily", symbol });
console.log(JSON.stringify({ ...report, stocks: report.stocks.slice(0, 3) }, null, 2));
if (!report.counts.scanned) process.exitCode = 1;
