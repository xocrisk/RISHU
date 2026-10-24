# Friends & Groups

Entry: Account sidebar or Profile → Friends & Groups. Routes use `#friends/chats`, `contacts`, `groups`, `add`, `requests`, `search-groups`, `select`, `name`, `qr`, `scan`, `notices`, and `thread/<id>` so browser Back/Forward works with the existing account navigation.

The account page passes `createSupabaseFriendsRepository` (`src/lib/api/friends.ts`), so friends, requests and groups come from Supabase (`supabase/migrations/001_friends_groups.sql`). It reuses the existing `public.users` table (adds `auth_user_id`, `nickname`, `avatar_url`, `public_id`) behind a `profiles` view; no second profile table is created. RLS enforces every rule; accepting a request and creating a group run as RPCs (`accept_friend_request`, `create_group`) in one transaction. The view subscribes to Realtime so the New Friends badge updates live, and Search User ID does an exact server-side `public_id` lookup excluding your own ID. Direct messages are not backed yet: sending one shows an error and stores nothing.

`model.ts` holds models, validation, transitions, fixtures and the `FriendsRepository` interface. `createMockFriendsRepository` (localStorage, sample labels shown) is the default when no repository factory is passed and is used by tests. `FriendsIntegrations` reserves optional leaderboard/consented portfolio-sharing hooks; neither is implemented or enabled.

`components.tsx` provides reusable avatar, row, search, empty state, icons, QR and scanner. Camera access is requested only when the user opens Scan. Denial, missing camera, invalid IDs, retry and camera shutdown on navigation/background are handled. Android CAMERA permission is already in the manifest. Verify permission prompts on a physical device when building the mobile app.

System sharing uses `NEXT_PUBLIC_APP_INVITE_URL` or the existing public app domain's `/signup/` page; clipboard fallback is used when Web Share is unavailable. All shared content stays generic and contains no dummy referral ID.

Run model checks from the repository root: `node --test frontend/test/friends.test.mjs`.
