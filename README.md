# XOCRISK

## Project layout

- `frontend/`: Next.js pages, React components, styles, public images, and public client configuration.
- `backend/`: API routes, authentication, database access, migrations, market services, payment integration, and private configuration.
- `packages/core/`: shared, browser-safe validation and money utilities. Never put secrets here.
- `android/`, `www/`, `capacitor.config.json`: native app wrapper and generated mobile web assets.
- `scripts/`: repository build and mobile export tooling.

## Development

Run `npm install` and `npm run dev` from this directory. See [backend setup](backend/README.md) and [frontend setup](frontend/README.md).

Run `npm run build`, `npm run typecheck`, `npm run lint`, and `npm test` from the root. `npm run build:web` generates the Capacitor static export.

## Private configuration

Keep database credentials, OAuth client secrets, SMTP passwords, payment secrets, and Supabase secret/service-role keys only in `backend/.env` locally or server-side deployment environment settings. Environment files are ignored by Git. Only public values belong in `frontend/.env.local`; every `NEXT_PUBLIC_*` value can be read by visitors. Supabase publishable keys are intentionally public; access control is enforced by the API and database policies.

The frontend `/v1` route is a server-only Vercel entry point that calls `backend/src/http.ts`; it contains no credentials or business logic and is excluded from mobile exports. Existing same-origin API behavior is preserved. The frontend and API still share the website server deployment; folders alone are not a separate hosting boundary. Do not serve the repository or backend directory as static content.

For Vercel, set the project Root Directory to `frontend` (previously `apps/web`) and keep monorepo files outside the root available to the build. Private environment values belong to the server runtime and must never use the `NEXT_PUBLIC_` prefix. External deployment settings are not changed by this repository refactor.
