# Friends & Groups

Entry: Account sidebar or Profile → Friends & Groups. Routes use `#friends/chats`, `contacts`, `groups`, `add`, `requests`, `search-groups`, `select`, `name`, `qr`, `scan`, `notices`, and `thread/<id>` so browser Back/Forward works with the existing account navigation.

All social identities and messages are placeholders, including current user `XO000001`. `Friend 1`–`Friend 8` are friends; `Friend 9` and `Friend 10` have incoming requests; `FR000011` is available to add/search/scan. Groups 1 and 2 are discoverable but initially not joined. No social action sends a real message, grants a referral reward or exposes a real portfolio.

`model.ts` contains models, validation, immutable transitions, fixture data and `FriendsRepository`. The mock repository persists per account UID to a namespaced localStorage key, with an in-memory fallback. Pass a repository prop to `FriendsView` to replace load/dispatch with authenticated API requests; server-side authorization, membership checks, request uniqueness and persistence must be enforced there. `FriendsIntegrations` reserves optional leaderboard/consented portfolio-sharing hooks; neither is implemented or enabled.

`components.tsx` provides reusable avatar, row, search, empty state, icons, QR and scanner. Camera access is requested only when the user opens Scan. Denial, missing camera, invalid IDs, retry and camera shutdown on navigation/background are handled. Android CAMERA permission is already in the manifest. Verify permission prompts on a physical device when building the mobile app.

System sharing uses `NEXT_PUBLIC_APP_INVITE_URL` or the existing public app domain's `/signup/` page; clipboard fallback is used when Web Share is unavailable. All shared content stays generic and contains no dummy referral ID.

Run model checks from the repository root: `node --test frontend/test/friends.test.mjs`.
