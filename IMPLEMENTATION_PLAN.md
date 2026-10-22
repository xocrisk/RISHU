# XOCRISK MVP Implementation Plan

## Outcome

Deliver a web practice-trading product and Android app within 12 weeks, then run a campus pilot. The MVP uses virtual funds only, offers no trading recommendations, and provides two distinct modes: historical Replay and synthetic XO Exchange. No real-money trading, cash prizes, broker integration, iOS app, or licensed live market feed is in scope.

This plan translates the supplied PRD into an implementation sequence. The regulatory statements and cited circulars in the PRD are requirements to verify with qualified counsel before launch, not legal conclusions.

## Architecture

- **Monorepo:** Turborepo with `frontend` (Next.js), `apps/mobile` (React Native with Expo), and shared `packages/core` (validation, integer-paise money and fee calculations, API client, design tokens).
- **API:** Fastify REST API plus WebSocket endpoints. Keep auth, wallet/ledger, orders, replay, and exchange interfaces distinct so the two market modes cannot accidentally share data sources.
- **Persistence:** PostgreSQL for users, wallets, immutable ledger entries, orders, fills, fee schedule versions, and audit events. Redis for ephemeral fan-out and leaderboard data.
- **XO Exchange:** Single-process price-time-priority matching engine with an append-only event log and deterministic replay for recovery. Do not use exchange-derived market data in its synthetic instruments.
- **Replay:** Stream licensed/otherwise launch-cleared historical candles only after their age and permitted use have been validated. Keep the session's historical date hidden until completion, while clearly identifying the mode as replay and disclosing that its prices are at least 30 days old.
- **Charts:** TradingView Lightweight Charts with required attribution. Market data and indicators must use only the selected mode's allowed data.

## 12-Week Sequence

### Weeks 1–2: Foundations and launch gates

- Confirm product/legal assumptions with fintech or securities counsel, including the cited data rules, educational-data treatment, league rewards, and applicable privacy obligations.
- Confirm the initial historical-data source, intraday coverage, commercial-use rights, redistribution rights, and required attribution. Do not make public Replay data available until these are documented.
- Create the Turborepo structure, CI, local development setup, environment/secrets strategy, database migrations, and shared design tokens.
- Define API contracts and data models for account/session, instrument/mode, orders/fills, fee schedules, wallet ledger, and audit events.
- Implement auth foundations: signup/login routes, generic auth errors, rate limits, 18+ consent, secure sessions, account deletion workflow, and email OTP. Keep Google OAuth behind provider configuration; do not expose unfinished providers.
- Decide how market sessions are scheduled and how the app handles exchange holidays, time zones, and session boundaries.

**Exit gate:** CI and local setup work from a clean checkout; counsel/data-source questions have named owners and launch-blocking status; core API and money/ledger contracts are reviewed.

### Weeks 3–4: Account, wallet, instruments, and charges

- Build signup and login web flows, searchable NIRF institution selection, college-not-listed path, and certificate-name handling. Enable the LPU registration-number field only after the tie-up is confirmed and its data purpose/storage are approved.
- Implement shared phone/email validation and account security rules. Use email OTP for MVP; defer SMS until DLT registration and per-message cost are budgeted.
- Implement the ₹1,00,000 practice wallet, reset eligibility, retained wallet history, and an append-only paise-denominated ledger. Never update balances without corresponding ledger entries.
- Add instrument search/watchlists for the approved Replay instruments and synthetic XO Exchange companies.
- Implement versioned fee schedules with effective dates and immutable references from each filled order. Calculate estimates before confirmation and final charges on fills; use integer paise throughout.
- Add unit and property-style tests for validation, fee calculations, rounding, and ledger invariants. Reconcile the INFY example against an explicitly documented fee schedule before using it as an acceptance fixture.

**Exit gate:** Auth and wallet flows work end to end; old wallets remain auditable after reset; charge estimates and filled-order charges are reproducible from the saved fee version; balances reconcile to ledger entries.

### Weeks 5–6: Replay orders and portfolio

- Implement Replay session creation, candle streaming, supported replay speeds, and session completion/date reveal. Enforce the minimum data-age and display rules established by counsel.
- Implement market, limit, stop-loss, and stop-loss-market order lifecycle for Replay, including validation, cancellation, triggering, fills, and order history. Specify and test behavior for gaps, partial availability, and session end.
- Add delivery and intraday product handling, position/holding accounting, realised and unrealised P&L, charges paid, and automatic MIS close at the defined market-time cutoff.
- Build the web watchlist, instrument view/chart, order ticket with pre-trade charges, order status/history, and portfolio views.
- Add reconciliation tests covering order -> fill -> fees -> ledger -> positions -> displayed balance/P&L.

**Exit gate:** A user can place and review a complete Replay trade; the account and portfolio reconcile exactly in paise; Replay cannot source fresh or unauthorized data.

### Weeks 7–8: XO Exchange and web MVP hardening

- Implement synthetic instrument definitions and deterministic bot order flow.
- Implement price-time matching, partial fills, order-book snapshots, event logging, and recovery by replaying the event log. Make matching deterministic under a fixed event sequence.
- Complete order handling for XO Exchange and distinguish its live synthetic book from historical Replay in API types and user-facing labels.
- Finish F-01 through F-07 web workflows, responsive layouts, loading/empty/error states, accessibility basics, security headers, and audit coverage.
- Add authorization and abuse tests for all auth endpoints; verify generic login errors, IP/account rate limiting, secure cookies, and no secrets or sensitive identifiers in logs.
- Run a small internal test with synthetic instruments and seeded historical fixtures. Do not use publicly redistributable data until rights are confirmed.

**Exit gate:** Web P0 requirements pass acceptance tests in both modes; an exchange restart reconstructs the same book/state from its event log; security and data-source review has no unresolved launch blocker.

### Weeks 9–10: Android and learning loop

- Build the Expo Android app against the shared API and `packages/core`; keep mobile tokens in secure device storage.
- Implement the essential signup/login, watchlist, instrument, order, order slip, and portfolio workflows for the pilot.
- Add the required trade-journal reason and post-exit review prompt (F-09), plus a small initial set of micro-lessons tied to practice tasks (F-11).
- Generate shareable order-slip images (F-08) with the required costs and mode context; avoid including hidden Replay dates before session completion.
- Add mobile offline/error handling and test session expiry, device storage, and API authorization.

**Exit gate:** Android users can complete the pilot's core practice loop; shared calculations match web results; journal and lesson completion persist correctly.

### Weeks 11–12: Pilot readiness and campus launch

- Implement weekly XO Exchange leagues ranked by a documented risk-adjusted metric and drawdown penalty (F-10). Define treatment of insufficient history, ties, inactive users, resets, and suspicious activity before publishing rankings.
- Add coordinator setup and export only if required to operate the first pilot (F-14 is otherwise deferred beyond MVP); verify exports minimize personal data.
- Add monitoring, backups/restore rehearsal, incident response contacts, support process, account deletion operations, and production rate limits.
- Run end-to-end, load, security, and accessibility checks; test on supported desktop/mobile browsers and Android devices.
- Conduct a closed pilot with a small cohort before opening the target campus league. Confirm consent, eligibility, data disclosures, support, and competition rules.
- Review the first-week funnel and operational incidents before expanding the pilot. Track signup-to-first-order, weekly retention, orders per weekly active user, league participation, and lesson completion as defined in the PRD.

**Exit gate:** Written launch approval from the product owner and counsel; data rights and disclosures are documented; backups restore successfully; no unresolved critical security or accounting defects; pilot support and deletion workflows are staffed.

## MVP Acceptance Checks

- A new eligible user can register, authenticate, select a college, and receive generic failures for invalid login attempts.
- The virtual wallet starts at ₹1,00,000, cannot receive deposits or withdrawals, and every balance movement has a ledger entry.
- Fee estimates appear before confirmation; filled-order charges use the fee schedule version effective for that fill and reconcile to the paisa.
- Replay uses only approved historical data meeting the legal/data-age gate, identifies itself as replay, and reveals the session date only after completion.
- XO Exchange uses synthetic instruments and price-time matching; partial fills and recovery from the event log are tested.
- Portfolio holdings, positions, P&L, charges, and order history reconcile with fills and ledger entries.
- Intraday positions close at the configured 3:20 pm market-time cutoff, with holiday/session behavior tested.
- Under-18 signup is blocked; users can request account deletion; sensitive data is protected and access is auditable.
- No tips, signals, target prices, model portfolios, entry fees, or cash prizes appear in the product.

## Decisions and Risks to Resolve Early

1. **Legal and market-data clearance:** The PRD cites specific 2024–2026 rules. Counsel must verify the exact current requirements, scope, effective dates, and product implications. Historical data needs written commercial/redistribution rights and sufficient intraday coverage before Replay can launch publicly.
2. **Fee schedule fixture:** The ₹18.42 INFY example is not enough to define a fee engine. Document each rate, rounding stage, minimum/maximum, applicable product/venue, DP-charge conditions, and effective date; then independently reconcile the example.
3. **Order semantics:** Define trigger/reference prices for stop orders in Replay and XO Exchange, gap behavior, market-order slippage, partial-fill handling, insufficient funds, and end-of-session treatment.
4. **MVP mobile scope:** The goal says web and Android within 12 weeks, while the detailed P0 list and roadmap prioritize web first. Keep Android to the pilot's core loop unless delivery capacity supports full parity.
5. **College data and privacy:** Confirm which institution list/version is permitted, how aliases and duplicate abbreviations are resolved, and what personal data is truly necessary. Keep the LPU field feature-gated until the relationship and purpose are confirmed.
6. **League scoring:** Choose and publish a formula with guardrails against tiny-sample outliers and wallet-reset gaming. A Sortino-style score is a candidate, not a complete specification.
7. **Operations cost:** Free tiers are prototype conveniences, not a production availability plan. Price database, server, email, monitoring, domain, mobile distribution, and market-data costs before pilot commitments.

## Deferred Beyond the Pilot MVP

- iOS app and Apple sign-in, until an iOS release is funded and Sign in with Apple requirements are addressed.
- SMS OTP, until DLT registration, templates, and message costs are ready.
- Licensed delayed data, F&O simulation, certificates/verification, advanced behavior analytics, and full coordinator administration unless one is necessary for the first pilot.
- Paid subscriptions, sponsored leagues, cash rewards, real-money trading, broker integration, and recommendations.