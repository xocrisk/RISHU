# XOCRISK API

The Fastify service provides PostgreSQL-backed authentication and practice APIs. Passwords are scrypt-hashed; clients receive opaque session tokens whose keyed hashes are stored in PostgreSQL.

## Local setup

1. Create a PostgreSQL database.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL`, `WEB_ORIGIN` (a comma-separated allowlist, for example `http://localhost:3000,http://localhost:5173,https://localhost,capacitor://localhost`), and a strong random `AUTH_SESSION_SECRET` (at least 32 random bytes). Add the deployed website origin when publishing, and keep the session secret on the API only.
3. Apply the database migrations from the monorepo root with `npm run migrate --workspace @xocrisk/api`.
4. Copy `frontend/.env.example` to `frontend/.env.local` and set `NEXT_PUBLIC_API_URL`.
5. Start the web app and API together from the root with `npm run dev`. Turbo builds the shared core package before starting either app.

The API listens on `http://127.0.0.1:4000` by default. `WEB_ORIGIN` must exactly match the web app origin for API CORS.

## Practice trading

Migration `004_practice_trading.sql` adds persistent user portfolios, holdings, orders, performance snapshots, and a leaderboard preference. The authenticated `/v1/practice` routes back the dashboard, order entry, open-order cancellation, portfolio reset, and college leaderboard.

The initial balance is ₹1,00,000. The current supported-stock list and quote values are fixed illustrative demo data in `src/practice.ts`; they are not live or delayed exchange prices and have no automatic refresh. Market orders fill at those sample values, limit orders use a 20% reference-price band, and practice charges and slippage are zero. Replace the demo quote catalog with a licensed market-data provider before presenting prices as current market data.

Leaderboard participation defaults to off. A user must explicitly opt in before their account display name and practice return appear for opted-in users with the same college. Resetting a portfolio removes its holdings, orders, and performance snapshots while keeping the account profile and leaderboard preference.

## Authentication behavior

- Signup creates an account with email, password, Indian mobile number, college, and explicit 18+/terms consent. Passwords must be at least 10 characters. Passwords and phone numbers are not currently verified by an email or SMS provider.
- Login accepts the registered email address or Indian mobile number with the account password. Without “Remember me”, the browser cookie is session-only and its API token expires after 12 hours; enabling it extends both to 30 days. Tokens are stored as keyed hashes in `auth_sessions`.
- The optional Google and Microsoft OIDC providers are enabled by setting each provider's client ID, secret, and exact callback URL. OAuth only signs in an already-linked account; first-time linking requires the existing XOCRISK password. No account is created from provider data.
- Password recovery requires SMTP settings. The API sends a short-lived six-digit code, limits requests and verification attempts, and revokes the account's existing sessions after a successful reset.
- The API enforces a global rate limit and tighter per-minute limits on signup and login. Account deletion records a request and revokes existing sessions; a separately operated deletion process must complete data erasure.
- Migrations `006_clerk_auth.sql` and `007_remove_firebase_auth.sql` are retained as historical migration records. Migration `008_remove_clerk_auth.sql` removes the unused Clerk identity table.

PostgreSQL is required. The signup college suggestions are a curated local list with a manual-entry fallback; maintain the list in `../web/src/app/signup/college-options.ts`.

### Provider and email setup

- Apply `009_login_providers.sql` after the earlier migrations.
- In Google Cloud, register the OAuth web client callback `https://<api-host>/v1/auth/oauth/google/callback` (use the matching localhost URL for local development) and set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and `GOOGLE_OAUTH_REDIRECT_URI`.
- In Microsoft Entra, register a Web redirect URI at `https://<api-host>/v1/auth/oauth/microsoft/callback`; set the client credentials and `MICROSOFT_TENANT_ID` (`common` accepts organizational and personal Microsoft accounts; use a tenant ID to restrict it).
- Both providers use Authorization Code with PKCE, one-time state and nonce validation, and HTTPS callback URLs outside local development.
- Configure all SMTP variables in `.env` to enable password reset. Keep provider secrets and SMTP credentials server-side; never use `NEXT_PUBLIC_` for these values.
