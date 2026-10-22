# XOCRISK security review — 22 October 2026

The application has useful security foundations, but it is not ready to be described as fully secure. Address password recovery and mobile session storage first. This review changes no application behavior.

## Evidence and scope

- Reviewed authentication, OAuth, session handling, API authorization, SQL access, payments, headers, native app storage, and configuration.
- Ran local Fastify injection probes using fake database responses and a mocked Supabase service. No real passwords, user records, or payments were changed.
- Queried the database configured in `backend/.env` in a read-only transaction: inspected role flags, table RLS, grants, and policies only. This does not prove a separately configured production database has the same settings.
- Queried the current npm advisory service: full dependency tree reports **9 affected packages: 8 high and 1 critical**; production-only audit reports **0 known vulnerabilities**. These are affected-package counts, not nine independent exploitable application bugs. An earlier offline install's zero-vulnerability output was not a current online audit.
- Compared private credential values from the backend environment against 338 source/build/public files without printing those values: no matches. Both private environment files are Git-ignored. A filename-based Git-history check found no commits for `.env`, `.env.local`, `.pem`, or `.key` files; this is not an exhaustive history secret scan.
- The existing 23 tests and production build passed during the immediately preceding cleanup. The focused audit probes described below also passed their assertions about current behavior. Existing tests do not cover all security properties.
- No live website penetration test, real recovery-token replay, device extraction, or payment settlement test was performed. Deployment headers, WAF/proxy rules, provider settings, and backups need separate verification.

## Findings, in priority order

### 1. High — recovery accepts general authentication tokens without recovery authorization

Location: `backend/src/auth.ts:521–550`.

The password-reset/link endpoint asks Supabase for the token's user and changes the local password based on the returned email. It does not require a recovery-specific challenge, recent verification, or even `email_confirmed_at`. It has no application-side consumed-token record. Password update and session revocation are separate database operations.

A local mock supplied an ordinary user identity with an unconfirmed email and the same token on two requests; both returned 200 and executed a password update. This establishes missing application checks, not that an arbitrary fabricated token works against Supabase. Exploitation requires a token Supabase accepts. A stolen ordinary session can be escalated into a persistent password change. Acceptance of an unconfirmed identity depends on provider configuration.

Fix: require verified identity and a short-lived, single-use recovery authorization bound to the user and purpose. Consume it atomically with the password update and session revocation. Require recent reauthentication for ordinary password changes. Provider logout alone is not a single-use recovery mechanism; Supabase documents that JWT validity may outlast logout and describes checking session existence for sensitive operations.

Source: https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out

### 2. High — mobile bearer tokens remain readable in web storage

Locations: `frontend/src/lib/auth-session.ts:19–25`, `frontend/src/lib/app-lock.ts:30–44`, `android/app/src/main/AndroidManifest.xml:5`.

The native app's bearer token is stored in localStorage. The app PIN is a fast salted SHA-256 hash stored beside a locally editable lock-mode setting. The PIN does not encrypt or gate retrieval of the token. It is four digits, and its attempt counter is React state that resets when the component restarts. Android allows backups without application-specific exclusions in the manifest reviewed.

Script execution in the WebView or access to application storage can expose the token or bypass the presentation-level lock. No XSS exploit or physical-device compromise was demonstrated. Web logins correctly use HttpOnly cookies instead.

Fix: protect native credentials with Android Keystore/iOS Keychain-backed storage and gate access with platform authentication where appropriate. Review backup exclusions. Treat a UI PIN as a convenience lock unless it actually protects access to credentials. OWASP advises against session identifiers in localStorage.

Source: https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html#local-storage

### 3. Medium — six-month sessions renew without an absolute lifetime

Location: `backend/src/auth.ts:43–47,129–150`.

Long sessions last 180 days and renew while used, without rotating the token or enforcing a maximum age from creation. An actively used stolen token can remain useful until explicit revocation. Short 12-hour sessions do not use this renewal path.

Fix: enforce an absolute session lifetime and meaningful inactivity timeout, rotate credentials where appropriate, and require recent authentication for sensitive changes.

Source: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#absolute-timeout

### 4. Medium — rate limiting is isolated to each server instance

Locations: `backend/src/app.ts:68`, authentication route rate-limit configuration, `backend/src/http.ts:32`.

Fastify uses its default local limiter store. A local probe hit 429 after 101 requests on one instance, while a second instance immediately accepted a request from the same IP. Serverless instances and restarts therefore do not share counters. No account-based limiter is configured. The HTTP adapter derives the IP from x-forwarded-for; trust depends on the deployment proxy sanitizing that header.

Fix: use a shared limiter store and account-plus-IP controls for login/recovery. Validate the proxy trust boundary. Actual externally spoofable IP behavior was not tested.

### 5. Medium — signup marks unproven email addresses as confirmed

Locations: `backend/src/auth.ts:155–207,676–697`.

Email/password signup creates an active local session without verifying email ownership, then mirrors the account into Supabase with `email_confirm: true`. A supplied email is therefore marked confirmed without proof. This enables account pre-registration/impersonation and makes automatic email-based identity merging risky. The review did not demonstrate takeover of an existing verified account.

Fix: keep addresses unverified until a real email challenge or a trusted provider proves ownership. Review linking and revocation of pre-existing sessions when ownership is established.

### 6. Medium — payment signature is treated as final payment settlement

Location: `backend/src/community.ts:169–204`.

The code validates the payment signature and binds the order to the logged-in user and championship, which is good. It then marks the payment paid and enrolls the user without independently checking captured status or reconciling a capture webhook. A valid checkout signature alone does not establish final settlement. Exposure depends on Razorpay capture configuration; no live payment was made.

Fix: confirm captured status and expected amount/currency using the provider API or a verified, idempotent webhook before granting paid access. Make local payment/enrollment state changes transactional and handle retries/refunds.

Source: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/

### 7. Low–Medium — public health endpoint discloses internal diagnostics

Location: `backend/src/app.ts:71–103`.

The unauthenticated /v1/health route exposes database hostname, configuration status, origin configuration, a session-secret fingerprint when configured, and selected upstream/database errors. A local probe confirmed public access to diagnostic fields. The fingerprint is not the secret, but these details unnecessarily aid reconnaissance. It also performs dependency probes on each health request.

Fix: keep public health to a minimal availability result. Put diagnostics behind operator authentication and avoid exposing raw upstream error text.

### 8. Medium hardening gap — database runtime role bypasses RLS

The configured database has RLS enabled on all 19 public tables, no policies, and no table grants found for anon/authenticated/PUBLIC. However, the application's connection role has `rolbypassrls=true` (not superuser). RLS consequently protects public API access, but does not constrain this backend connection.

Fix: separate migration/admin credentials from runtime credentials and grant the runtime role only required privileges. Continue enforcing ownership in every API query. Lack of RLS enforcement for the backend is not itself evidence of unauthorized data access.

### 9. Dependency findings — critical/high ratings in development tooling

Current full npm audit reports:

- `tar` through `@capacitor/cli`: critical/high archive handling advisories.
- `braces` through `micromatch`, `fast-glob`, and Next ESLint tooling: denial-of-service advisory.
- `compression` through `serve`: denial-of-service advisory; relevant if the preview server is exposed.

All currently reported affected packages disappear in `npm audit --omit=dev`. That does not make the developer/build environment safe or guarantee no unknown runtime vulnerabilities. Review compatible upgrades/overrides and rerun Android and web builds. Do not blindly apply `npm audit fix --force`: the suggestions include major changes and downgrades.

Advisories: https://github.com/advisories/GHSA-23hp-3jrh-7fpw ; https://github.com/advisories/GHSA-vfj7-8cjw-p6xm ; https://github.com/advisories/GHSA-vc2v-76pw-4v95

## Other improvements

- The CSP in `frontend/next.config.ts:31` blocks framing/objects and restricts form actions, but has no script-src/default-src policy. Add a compatible script policy after testing Next.js and Razorpay; no exploitable XSS was found in this review.
- Production config falls back to a random session secret when the configured secret is absent/short (`backend/src/config.ts:104–109`). Fail startup in production instead; random fallback is not predictable but causes inconsistent sessions across instances.
- Add explicit Cache-Control: no-store to sensitive API responses. The service worker already excludes /v1/ requests, but the dashboard snapshot is persisted in localStorage until cleared.
- Review CSRF protection for cookie-authenticated mutations beyond SameSite=Lax and CORS. Do not treat a CORS response policy as a complete request-forgery control.
- `auth_audit_events` exists, but no writer was found in the reviewed source. Add useful security events without tokens/passwords, plus alerts and retention rules.
- Expand security tests for recovery purpose/replay, cross-user access, payment state transitions, shared rate limits, and revocation failure paths.

## What is already working well

- Passwords use per-password random salts and scrypt, with constant-time verification.
- Session tokens have 32 random bytes and are stored as HMAC digests in PostgreSQL.
- Website cookies are HttpOnly, SameSite=Lax, and Secure in production.
- Reviewed SQL uses parameterized values; ownership constraints appear on sampled private operations.
- Sampled private endpoints returned 401 without a session.
- SMTP reset codes expire, have attempt limits, and are consumed transactionally with password changes/session revocation.
- Direct OAuth flow includes state cookies, PKCE, nonce and identity-token validation, and allowlisted return origins.
- Supabase Postgres configuration verifies TLS certificates.
- The configured database blocks the inspected public-role table access through grants/RLS.
- Private values were absent from the sampled browser assets and tracked source files.

Recommended sequence: fix recovery authorization and mobile credential protection, then session/rate-limit/email-verification issues; verify payment settlement before accepting paid entries; reduce diagnostic exposure and runtime privileges; upgrade affected tooling with compatibility checks.
