# XOCRISK AI market scanner

XOCRISK AI now routes market-analysis questions to an authenticated API which
fetches Yahoo Finance charts and calculates scanner rules. This is a native
TypeScript adaptation of the installed `trader-scanner` skill, so it also works
in the existing Node/serverless deployment without Python. Attribution and the
upstream MIT license are in `backend/THIRD_PARTY_NOTICES.md`.

## Use in XOCRISK AI

- `market scan karo` — daily setup scan of the app's configured NIFTY 500 list.
- `Nifty 50 scan` — a narrower universe.
- `Reliance analyze karo` or `TCS RSI` — completed daily closes, Wilder RSI(14),
  MA20, previous 20-session closing high, and matching rules for one stock.
- `opening range breakout scan` — intraday screening of the configured list.
- `Reliance intraday analysis` — one stock's opening range, first breakout,
  and latest completed close, including whether it has fallen back below the range.

English and common Hinglish phrases are supported, plus basic Hindi scan wording.
This is rule-based intent routing, not general language-model reasoning.
Existing lessons, quizzes, account responses and risk guards remain in place.
US equities, orders, news retrieval, earnings and simulation skills are not
connected by this integration.

## Rules and data

Daily analysis uses three months of daily closes and requires at least 30 completed
bars with the latest completed NSE session present. It identifies a 20-session
closing-high breakout, a bull flag on closes, reclaim of MA20, RSI below 30 and an
oversold bounce. Today's candle is excluded until 15:30 IST. Flat-series RSI is 50.

Opening-range analysis runs from 09:35 until 15:30 IST on the NSE trading days
defined in `backend/src/market/hours.ts`. It uses the 09:15, 09:20 and 09:25 bars;
only a later completed five-minute close above their highest high is a breakout.
Missing bars make a chart unusable. An old breakout is not a fresh entry signal;
the signal timestamp/price and latest completed close are reported separately.

The app's instrument list and exchange calendar are maintained separately. This
does not cover every NSE/BSE security, ETFs, US securities or special sessions
absent from that calendar. Yahoo is an unofficial, delayed provider and can fail,
lag or revise candles; software checks are not evidence of strategy profitability.

Market scans apply a ₹5 price floor and no volume floor; individual analysis has
no price floor. Daily matches are ranked by reported price × volume, not expected
return. During a session that volume may be partial. ORB prefilters the universe
in batches and confirms at most 50 candidates, ranked the same way, using actual
highs/lows. All exclusions, failures and unchecked candidates are counted. Missing
data produces an unavailable/partial answer, not fabricated indicators.

## API and deployment

`GET /v1/market/scan?mode=daily&scope=nifty500` accepts `mode=daily|orb`, optional
`scope=nifty50|nifty500`, or a supported uppercase NSE `symbol` (takes precedence).
It uses the existing signed-in cookie/token and is limited to 8 requests/minute.
No provider key, migration, Python runtime or new npm dependency is required.

Provider work has a 24-second deadline, batches at most 20 symbols, and uses at
most 3 simultaneous batch requests / 5 confirmation requests per scan. The server
coalesces identical requests and permits at most 3 distinct active scans per
instance. Results are cached for 5 minutes (daily) or 1 minute (ORB); cache keys
include the applicable session. Caches are per instance, not shared across a
serverless fleet. Failed scans with no usable data are not cached. API responses
are private/no-store; scan timestamps remain visible when the server reuses data.

The chat cancels its wait when unmounted and blocks duplicate sends while busy.
No trade or account mutation is performed. Chart-rule outputs use existing plain
text rendering; no model API receives user/account data.

Build and deploy the API and frontend together through the project's usual flow.
Mobile clients need an updated web bundle and the updated hosted API. Local source
integration alone does not update an already deployed website or installed APK.

## Checks

```powershell
npm run build --workspace @xocrisk/core
npm run build --workspace @xocrisk/api
node --test backend/test/scanner.test.mjs frontend/test/market-analysis.test.mjs frontend/test/ai-brain.test.mjs
npm run typecheck
npm run lint
npm run build
node backend/scripts/scanner-smoke.mjs RELIANCE
node backend/scripts/scanner-smoke.mjs market
```

The smoke checks contact Yahoo and print a scan; they do not use a brokerage,
database or user account. Automated tests use synthetic data and cover indicator
math, NSE timing, incomplete/stale bars, coverage, cache/coalescing, concurrency,
authentication, validation, failure handling, prompt routing and tutor regressions.
