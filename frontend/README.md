# XOCRISK Web

The Next.js app contains signup, login, and the authenticated practice dashboard.

## Local development

1. Set up PostgreSQL and the API using [the API setup guide](../backend/README.md).
2. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_API_URL`.
3. From the monorepo root, run `npm run dev` to build the shared core package and start both the API and web app.
4. Open `http://localhost:3000/signup` or `http://localhost:3000/login`.

The API manages email/password accounts, accepts either the registered email or Indian mobile number at login, and stores sessions in PostgreSQL; the web app sends each session token as a bearer token. PostgreSQL remains the source for account profiles and practice data.

Google login uses the Supabase project configured in `src/lib/supabase/public-config.ts` by default. This file contains only the public project URL and publishable key. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` override them at build time; when using a different project, provide both its URL and its key. Keep the backend `SUPABASE_URL` pointed at the same project and its secret key server-side. Missing public build variables must not silently route the production Google button to the separate legacy OAuth client.

After authentication, `/account` is the practice workspace for the portfolio summary, sample market watchlist, stock details, orders, holdings, learning guidance, opt-in college leaderboard, and portfolio reset. Market quotes and the chart are illustrative demo data, not live or delayed market feeds. The default ₹1,00,000 balance is virtual; practice orders use zero charges and slippage.
