# Huddle: developer notes

## Setup

```sh
npm install
cp .env.example .env        # then fill in AUTH_SECRET, ADMIN_EMAIL, Google creds
npm run db:up               # Postgres 16 on 127.0.0.1:5433 (creates huddle + huddle_test)
npm run db:migrate          # dev DB
DATABASE_URL=postgres://huddle:huddle@localhost:5433/huddle_test npm run db:migrate   # test DB (tests also do this themselves)
npm run dev                 # http://localhost:3000
```

## Auth

- Auth.js v5 (`next-auth@5.0.0-beta.32`) with the Drizzle adapter, Google only, **database sessions**
  (`sessions` table; the cookie holds the session token). Config: `src/lib/auth.ts`.
- Who may sign in: `decideSignIn()` in `src/lib/auth-policy.ts` (pure, unit-tested). The Google email must be
  verified, and it must be `ADMIN_EMAIL` (case-insensitive) or be in `allowed_emails` with no deactivated user row.
  Everyone else is sent to `/denied`.
- `is_admin` is recomputed on every sign-in (`enforceAdminFlags()` in `src/lib/auth-db.ts`): true only for
  `ADMIN_EMAIL`. Changing `ADMIN_EMAIL` demotes the old admin on the next sign-in by anyone.
- Emails are stored lowercase (CHECK constraints on `users.email` and `allowed_emails.email`).
- The admin panel lives at `/admin` (allowlist, groups, users, data; 404 for non-admins; entry card on `/profile`). Mutations are
  server actions in `src/app/admin/actions.ts`, backed by `src/lib/admin/*`. `onUserDeactivated()` in
  `src/lib/admin/lifecycle.ts` is where M3 adds API-key revocation. The e2e server sets `ADMIN_EMAIL=e2e-admin@example.com`
  (`tests/support/e2e.ts`).
- Adding a friend without the admin UI:
  `docker exec huddle-db psql -U huddle -d huddle -c "insert into allowed_emails(email) values ('friend@gmail.com')"`
- Route protection:
  - `src/proxy.ts` (Next 16's renamed middleware) only checks that a session cookie exists: pages redirect to
    `/login`, APIs get 401. Public paths are listed in `src/lib/route-access.ts`.
  - The real checks are server-side: `(app)/layout.tsx` calls `requireOnboardedUser()`. Helpers in
    `src/lib/session.ts`: `getCurrentUser()`, `requireUser()`, `requireOnboardedUser()`, `requireAdmin()` (404s).
    Layouts don't re-run on client navigation, so pages/actions/APIs that read or change data must call a helper too.
- Google OAuth client: authorized redirect URI is `<APP_URL>/api/auth/callback/google` (e.g.
  `http://localhost:3000/api/auth/callback/google` in dev, the tunnel hostname in prod). Without
  `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`, "Continue with Google" logs an error and shows a friendly message on `/login`.

## Tests

| Command | What |
| --- | --- |
| `npm test` | Vitest: `unit` project (pure) + `integration` project (real Postgres `huddle_test`; migrated in global setup, all tables truncated before each test). Override the DB with `TEST_DATABASE_URL`; its name must be `huddle_test` or `huddle_test_<slot>`. |
| `npm run test:e2e` | Playwright (iPhone 15, Chromium). Starts its **own** `next dev` on **:3200** (override with `E2E_PORT`) with `E2E_AUTH=1`, `DATABASE_URL=$TEST_DATABASE_URL` (default `huddle_test`), empty Google creds and `NEXT_DIST_DIR=.next-e2e-<port>` (so it can run next to the :3000 dev server; Next 16 locks each dist dir). Global setup migrates the DB and truncates every app table, so each run starts clean and tests create their own data. Reuses a running server on that port locally. `expect` waits 15 s (a cold `next dev` compiles routes on first hit). |

### Running tests in parallel

Two checkouts/worktrees (or agents) running the suites at once would share `huddle_test` (truncated between tests and at e2e start) and
port :3200. Give each its own database and port:

```sh
npm run db:test:create -- a        # creates + migrates huddle_test_a (slot: [a-z0-9_]{1,20}); prints the URL
TEST_DATABASE_URL=postgres://huddle:huddle@localhost:5433/huddle_test_a npm test
TEST_DATABASE_URL=postgres://huddle:huddle@localhost:5433/huddle_test_a E2E_PORT=3210 npm run test:e2e
```

`E2E_PORT` (default 3200) sets the e2e server port and its dist dir `.next-e2e-<port>`. `assertTestDatabase` only accepts
`huddle_test` and `huddle_test_<slot>`. E2E tests must create the data they need; the e2e global setup empties the database.

### E2E login bypass (`POST /api/test/login`)

Playwright can't do Google OAuth, so e2e tests sign in through a test-only route:

```ts
await page.request.post("/api/test/login", { data: { email: "e2e@example.com", onboarded: true } });
```

It upserts the user, runs the same admin-flag rule as a real sign-in, inserts a `sessions` row and sets the
`authjs.session-token` cookie (helper: `tests/e2e/auth-helpers.ts`).

How it is kept out of production:

1. The guard `isTestAuthEnabled()` (`src/lib/test-auth.ts`) requires `NODE_ENV !== "production"` **and**
   `E2E_AUTH === "1"`. The route evaluates it **once at module load**; when false every method returns 404
   (GET too, so the route isn't revealed by a 405).
2. Next inlines `NODE_ENV` at build time, so in a production build the guard is constant `false` whatever
   `E2E_AUTH` says.
3. Even when enabled, it only answers requests addressed to a loopback host (`localhost`, `127.0.0.1`, `[::1]`).
4. `tests/unit/test-auth-guard.test.ts` asserts the route 404s with `NODE_ENV=production E2E_AUTH=1`.

Never set `E2E_AUTH` anywhere but the Playwright web server.

## Migrations

`npm run db:generate -- --name <what>` then `npm run db:migrate`. drizzle-kit asks interactively when a
change looks like a rename; in non-TTY shells split it into a drop migration and a create migration.

## Screenshots

`MSYS_NO_PATHCONV=1 node scripts/snap.mjs /login .snaps 2500` (iPhone 15 viewport, against :3000).

## Avatars

- DiceBear v9 (`@dicebear/core` + `@dicebear/collection`, rendered locally, no HTTP). Curated styles, their
  licenses and the per-style option schema live in `src/lib/avatar/styles.ts`; `tests/unit/avatar-styles.test.ts`
  checks every curated option against the installed collection schema (run it after upgrading DiceBear).
- Stored config (`users.avatar_config`): `{ v: 1, style, seed, options }`, validated by `AvatarConfigSchema`
  (`src/lib/avatar/config.ts`). Rendering: `src/lib/avatar/render.ts`.
- `<Avatar>` (`components/ui/Avatar.tsx`) never imports the DiceBear styles (~430 KB gz): user avatars load from
  `GET /api/avatar/:userId?v=<config hash>` (immutable cache). `<ConfigAvatar>` renders a config locally
  (customizer, previews, server components). The customizer is `components/avatar/AvatarCustomizer.tsx`
  (showcase at `/dev/ui#avatars`).
- `/api/avatar/:userId` needs a session; `?format=png&size=16..1024` rasterizes with sharp. Uploads are read from
  `AVATAR_DIR` (default `./data/avatars` in dev, `/data/avatars` in production).
- `/credits` lists each style's license and attribution (public).

## Onboarding and profile

- `/onboarding` (`components/onboarding/*`) is a 6-step stepper (identity, avatar, basics, body, goals, connect). Each step is saved to
  the `users` row through the `saveSectionAction` / `saveAvatarConfigAction` server actions (`lib/profile/actions.ts`), so a refresh
  resumes at the first incomplete step (`lib/profile/progress.ts`). Only `finishOnboardingAction` sets `onboarded_at`
  (it can also redirect to `/setup`, since `(app)` pages need an onboarded user).
- Validation lives in `lib/profile/schema.ts` and is shared by onboarding, the Profile edit sheets and the actions. Storage is always
  cm / kg; ft/in and lb convert at the edge. DB logic is in `lib/profile/service.ts` (plain functions over a Drizzle handle, used by the
  integration tests).
- Username availability: `GET /api/me/username?u=…` (session required; your own username counts as available). The unique index is
  still the source of truth on save.
- Photo upload: the client crops a 512px JPEG (`components/profile/PhotoCropper.tsx`) and POSTs it to `POST /api/me/avatar`
  (multipart `file`, max 5 MB). The server sniffs the real type with sharp, re-encodes to a 512x512 WebP with metadata stripped, stores
  `${AVATAR_DIR}/${userId}-${hash}.webp`, deletes the previous file and sets `avatar_kind='upload'`. Switching back to a character
  deletes the photo. HEIC that sharp can't decode returns a friendly 422.
- `/profile` cards open edit sheets (`components/profile/EditSheets.tsx`) built from the same field components as onboarding
  (`components/profile/fields.tsx`). The Playwright web server uses `AVATAR_DIR=.next-e2e-<port>/avatars`.
- `ConnectStep` takes a `keySlot` prop (`OnboardingFlow`'s `connectKeySlot`); the onboarding page passes `<OnboardingKey>`, which creates the first API key when the final step mounts.

## API keys and health data

- Keys: `gk_` + base64url(32 bytes) (46 chars). `src/lib/apikey.ts`: only HMAC-SHA256(`API_KEY_PEPPER`) is stored in
  `api_keys.hash`, plus an 8-char `prefix_hint`. One active key per user (partial unique index). `authenticateApiKey()` rejects
  malformed keys without a DB hit, refuses revoked keys and deactivated users, and bumps `last_used_at` at most once a minute.
  Deactivation (`onUserDeactivated`) revokes keys. Never log a key; log `keyId` / `prefixHint`.
- UI: one-time reveal `components/apikey/KeyReveal.tsx`, used by onboarding (`OnboardingKey`) and Profile (`KeySection`:
  regenerate / revoke). Mutations: `src/lib/apikey-actions.ts`. The ingest URL shown is `${APP_URL}/api/ingest`.
- Metric fields are defined once in `src/lib/health/fields.ts` (name, column, unit, int/float, range, label, category);
  `daily_metrics` columns are generated from it. Ingest event summary types: `src/lib/ingest/types.ts`.
- `GET /api/me/sync-status` accepts a session or an API key (Bearer or `?key=`); a bad key gets a bare 401. Besides the last
  successful sync it returns `last_attempt` (`{ at, status, shape, error? }` of the newest ingest event of any status; `error` is the
  first validation issue as `path: message` with quoted payload strings redacted, or the error code; `src/lib/sync/attempt.ts`) and
  `server_time`. The proxy lets
  key-bearing requests to it through (`acceptsApiKey` in `route-access.ts`).

## Setup guide and Sync now (`/setup`, `/sync`)

- `/setup` (`components/setup/*`): hero with progress (installed = any recorded ingest attempt, Health = data arrived, automated =
  successful syncs on 2+ days this week), a live status strip (polls sync-status every 10 s; red banner when the last attempt
  failed), the URL and key card ("Show a new key" regenerates and reveals once; the key then also appears inline in the recipe),
  Option A (`SHORTCUT_ICLOUD_URL`) / Option B (the whole Huddle Sync recipe as a checklist with a device picker; per-device metric
  support lives in `src/lib/sync/recipe.ts`, checked against `fields.ts` by `tests/unit/sync-recipe.test.ts`), Health access,
  automation, backfill and troubleshooting. Step progress and the device pick are kept in localStorage.
- `/sync` (`components/sync/*`): the orb plus "Sync now". The tap opens
  `shortcuts://run-shortcut?name=<SHORTCUT_NAME>&input=text&text=force` (no x-callback: iOS would return to Safari, not the PWA).
  The flow is the pure reducer in `src/lib/sync/machine.ts`: a result counts only if `last_attempt.at` is after the tap in server
  time (clock offset measured from `server_time`). Once the page has been hidden and is visible again it polls every 3 s for 60 s
  (Synced / Error / "Didn't hear"); still visible 4 s after the tap means "Open this on your iPhone". The pending sync is kept in
  sessionStorage, so a PWA that iOS reloads on return picks it up.
- E2E hooks: `window.__huddleSync = { openUrl, pollMs, timeoutMs, stayedMs }` (set with `page.addInitScript`) captures the
  `shortcuts://` navigation and shortens the timers; see `tests/e2e/sync.spec.ts`.

## Ingest (`POST /api/ingest`)

- Payload reference, status codes and examples: `docs/ingest-api.md` (its metric table is checked against
  `fields.ts` by `tests/unit/ingest-docs.test.ts`).
- Pipeline: `src/lib/ingest/handler.ts` (IP limit -> key auth -> key limit -> body -> JSON -> `schema.ts` (zod shapes,
  numeric coercion, columns) -> `normalize.ts` (timezone, series pivot via `series.ts`, date window, hr hours, sleep
  segments) -> `upsert.ts` (one transaction, per-user advisory lock) -> `onDataIngested` in `src/lib/scores/hooks.ts`).
  Sleep sessions/nights are pure functions in `sleep-merge.ts`; timezone helpers in `src/lib/tz.ts`; limiter in
  `src/lib/ratelimit.ts` (in memory, single instance).
- Payload shapes: a Day, an array of Days, `{ days }`, and `{ series }` (the recommended Shortcut format: one grouped
  "Find Health Samples" per metric over a `window`, pivoted into days by `src/lib/ingest/series.ts`; sent-but-missing
  past dates become explicit nulls, today never does). Several values per day combine by `aggregation` in `fields.ts`.
- Every authenticated request writes an `ingest_events` row and one `info` log line (`module: "ingest"`); the scrubbed
  body is logged at `debug`. 401s log only ip/reason/method.
- The proxy matcher skips `/api/ingest` so Next doesn't buffer the body (up to 10 MB) before the route's 3 MB cap.
- Tests swap collaborators through `ingestDeps` (logger capture, failing hook/db) and call `resetIngestLimiters()`.

## Admin Data section (`/admin/data`)

What each friend's devices actually send. All of it is admin-only (the layout, every page and the lazy-load server actions call `requireAdmin()`). DB logic: `src/lib/admin/data.ts` (functions take `db`); UI: `src/app/admin/data/`.

- **Coverage grid**: users x metrics (columns from `src/lib/admin/coverage-columns.ts`: every metric in `fields.ts` grouped by category, plus HR hourly, Sleep, Sleep stages). Each cell is the % of the user's last 30 local dates (their own timezone, ending today) with a non-null value. Two SQL queries however many users. Tap a cell for the detail sheet, a name for the ingest log.
- **Unknown fields** (last 90 days, from `ingest_events.summary.unknownFields`) and **Sleep sources** (from `summary.sleepSources`, plus how many nights each source won in `sleep_nights`).
- **Ingest log** (`/admin/data/[userId]?status=all|ok|errors&page=n`): 25 per page, newest first. The list omits the per-day field inventory and the raw body; expanding a row loads the inventory (`getIngestEventDetailAction`) and "Show body" loads the body (`getIngestEventBodyAction`), pretty-printed and cut at 200 KB (bodies can be 3 MB; only that much leaves Postgres).

## Dev seed (`npm run db:seed`)

Fills the **dev** database with six demo friends and 90 days of data so the admin views, and later the scores and charts, have something real to show. Run `npm run db:up && npm run db:migrate` first.

- Refuses to run with `NODE_ENV=production` or when the `DATABASE_URL` database isn't named `huddle` or ending in `_test`; it prints which database it is seeding.
- Demo users (`*@demo.huddle.test`, matched by email so reruns update instead of duplicate): onboarded, DiceBear avatar (`randomConfig`, seeded), usernames, timezones (Asia/Kolkata, Europe/Berlin, America/New_York), goals, allowlisted, all in the group "Morning Crew" (plus the `ADMIN_EMAIL` user if they exist). Each run replaces the demo users' health data and ingest events and **rotates their API keys** (only the key prefix is printed).
- Data goes through the real pipeline: `handleIngest()` is called with constructed `Request`s, in 30-day chunks (backfill), then simulated morning syncs over the last days (stamped in the past, one user via `?key=`), a fresh sync, and a few failures (a 400 validation error, a 400 invalid JSON, a 429).
- Device profiles (`scripts/seed/generate.ts`): **Apple Watch** (everything incl. HRV, SpO2, resp rate, wrist temp, VO2 max; Core/Deep/REM/Awake from "Apple Watch", In Bed from "iPhone"), **Fitbit** (no HRV; Light/Deep/REM/Awake from "Google Health"), **Zepp** (only Asleep + Awake), **iPhone only** (steps, distance, flights, active kcal; In Bed only, no hourly HR). Formats: columnar (newline-joined text), rows (arrays), and a bare array of days. Arjun sends an unknown `cycling_km`, Maya `walking_steadiness`.
- Deterministic: every value is a function of (person, local date) through a seeded PRNG (weekend late nights, hard training days with high afternoon HR, sick / poor-recovery stretches), so reruns give the same numbers for the same dates.
- Tests: `tests/unit/seed-generate.test.ts` checks that every profile's payloads validate against `src/lib/ingest/schema.ts` (no DB).

## Scores (`src/lib/scores/`)

Huddle's own formulas, all pure and documented at the top of each file: `sleep.ts` (0-100), `recovery.ts` (0-100, bands green >= 67 / yellow / red <= 33), `strain.ts` (0-21, calibration fixtures listed in the header and asserted in `tests/unit/scores-strain.test.ts`). `baseline.ts` has the robust 30-day baselines (winsorized mean/SD with per-metric SD floors, >= 4 values) and the loader (one query per table).

- `compute.ts`: `computeDay(ctx, date)` from loaded inputs. Scores come only from the raw tables (never from stored scores), so recomputes are idempotent.
- `recompute.ts`: `recomputeUser(db, userId, from, to)` writes `daily_scores` in one transaction (per-user advisory lock). Dates with any input get a row (a null score's reason is in `components`, e.g. `recovery.reason = "calibrating"` with `calibrationDaysLeft`; recovery `limited` = an input with a baseline is missing today, `unsupported` = inputs never available, e.g. HRV on Fitbit, explained by a neutral note instead of the LIMITED chip); dates without input lose theirs. `components` = `{ v: SCORE_VERSION, sleep, recovery, strain }`; bump `SCORE_VERSION` when a formula changes and run the recompute.
- The ingest hook (`hooks.ts`) recomputes from the earliest affected date to 37 days after the latest (30-day baselines + 7-night sleep consistency), capped at tomorrow.
- `queries.ts`: `getOverview`, `getTrend` (`1w`/`1m`/`6m`), `getGroupBoard` (day or Mon-Sun week, >= 4 days, ties share a rank).
- `npm run scores:recompute [-- --user <id|email|username>] [--from D] [--to D] [--show N]`: dev/test databases only (same guard as the seed). `db:seed` runs a full recompute at the end.

## Personal dashboard (`/home`, `/recovery`, `/sleep`, `/strain`)

- Server pages; data via `getDataSpan` / `getOverview` / `getTrend` / `getRecentNights` (`src/lib/scores/queries.ts`), loaded by `src/lib/dashboard/load.ts`. `?date=YYYY-MM-DD` is clamped to [first data date, today in the user's timezone] (`resolveDashboardDate`); today's URL has no `?date`.
- Pure view helpers in `src/lib/dashboard/` (dates, formatting, null-score reasons and "limited data" sentences, trend series, sleep charts, the Home view model); all timezone formatting happens on the server. Unit tests: `tests/unit/dashboard-*.test.ts`.
- Home is one client component (`components/overview/Overview.tsx`): day changes are `router.push(…, { scroll: false })` in a transition (chevrons are fully prefetched `<Link>`s, the dial row swipes, the date opens a month calendar sheet). Search params don't change the segment's state key, so the page stays mounted and nothing flashes to the skeleton.
- Never synced (no successful ingest and no data) → Home shows the "Connect your iPhone" card and the detail screens redirect to Home.
- E2E: `tests/e2e/dashboard.spec.ts` seeds users through the real `POST /api/ingest` with the dev-seed generator, in a timezone where it's currently afternoon (so "today" always has a finished night).

## Community tab (`/groups`, `/groups/[id]`)

- Data: `src/lib/groups/queries.ts` (plain functions over a Drizzle handle, fixed query count however many members): `getMemberGroup` (membership check; admins get no exemption), `getMembersToday` / `listMemberGroups` (each member's scores and `hasData` for the group date, see below; `lastSyncAt` via `getSyncSummaries`), `getGroupRecoveryTrend` (daily mean recovery, 7 days), `getGroupFirstScoreDate`. Boards: `getGroupBoards` in `src/lib/scores/queries.ts` (all three metrics in two queries; week boards also return `insufficient` = members with 1-3 days). Pure helpers (URL state, date nav, averages) in `src/lib/groups/view.ts`; tests in `tests/unit/groups-view.test.ts`, `tests/integration/groups.test.ts`, `tests/e2e/groups.spec.ts`.
- **The group's "today"**: everything on the Community tab uses the *group date* = today in `groups.timezone` (`groupDateOf`), not each viewer's or member's local today (otherwise, late in the evening in Europe, members in Asia are already on tomorrow with no data and the group looks empty). For a group date D each member's row is their own data for `local_date = D` (same calendar-day label, whatever their clock says). The Info tab (scores, averages, the 7-day trend ending on D, "TODAY · SEP 29 · EUROPE/BERLIN" context line), the `/groups` card (mini dials, "N of M synced") and the board defaults (Day = D; Week = the Monday-Sunday week containing D) all use it, and date navigation is bounded by D (› is disabled on D; ‹ stops at the first data date). "Synced today" means *has data for D*: a `daily_metrics` or `daily_scores` row with `local_date = D` (`GroupMember.hasData`); the last-sync time shown next to each member (`lastSyncAt`) is informational only. `getMembersToday` / `listMemberGroups` take an injectable `now` for tests.
- Membership is checked in `groups/[id]/layout.tsx` (outside the page's loading boundary, so non-members and unknown ids get a real 404 status) and again in the page (`memberGroup`, React-`cache`d). The list's skeleton lives in `groups/(list)/` so it doesn't wrap `[id]`.
- URL state: `?tab=info|chat|strain|recovery|sleep&period=day|week&date=YYYY-MM-DD` (defaults omitted; the default date is the group date). Tab changes use `history.replaceState` (no server round trip); period/date changes use `router.replace(…, { scroll: false })` in a transition with optimistic controls, so the page stays mounted and values count from the previous board.
- UI: `src/components/groups/*` (`GroupScreen` shell with `TopTabs fill`, `InfoPanel` + member sheet, `Leaderboard` with `Podium`, rows and the pinned "YOUR RANK" bar, `ChatPlaceholder` = the chat slot T7.1 replaces).

## Retention, export and account deletion

- **Retention** (`src/lib/retention.ts`, `runRetention(db, now, opts?)`; the worker schedules it in a later task, it is not registered yet).
  Deletes, per user, `daily_metrics`, `hr_hourly`, `sleep_nights`, `sleep_segments` (by `wake_date`) and `daily_scores` rows whose local
  date is **on or before `today - 365`**, where *today* is the user's local date at `now` (`users.timezone`, UTC when missing/invalid).
  So `today - 365` is deleted and `today - 364` kept (tested at that boundary, and for Pacific/Kiritimati vs America/Los_Angeles at one
  UTC instant). One set-based `DELETE ... USING users` per table; the per-timezone cutoffs come from a small `VALUES` list with one row
  per distinct timezone, so there is no per-user loop. It also deletes `ingest_events` with `received_at` older than
  `INGEST_LOG_RETENTION_DAYS` (default 90) and orphaned avatar files: files in `AVATAR_DIR` named `<uuid>-<12 hex>.webp` (or its
  `.<pid>.tmp` leftover) that no `users.avatar_path` references and that are older than 1 hour. Any other file name is never touched.
  Returns per-table counts and logs them (`module: retention`).
- **Export** (`GET /api/me/export`, `src/lib/account/export.ts`): session auth only, 5 per hour per user (in-memory limiter, like ingest;
  a link tap over the limit is redirected to `/profile?export=limited`, other clients get 429). The body is one JSON document built
  incrementally as a `ReadableStream`: each section is read with a database cursor in batches (`ingest_events` 10 rows at a time because
  of the bodies, the rest 100 to 1000), so memory stays flat and a cancelled download stops querying. Shape: `exported_at`,
  `format_version` (1), `profile`, `api_keys` (id, prefix_hint, created/revoked/last_used; never a hash), `groups`, `daily_metrics`,
  `hr_hourly`, `sleep_nights`, `sleep_segments`, `daily_scores`, `ingest_events` (summary + body + errors), `messages`, `reactions`,
  `champion_awards` (own rows only). Column names are the database's snake_case names; dates are `YYYY-MM-DD`, timestamps ISO strings.
  Not included: Auth.js accounts/sessions/tokens, key hashes, the avatar image file. A failure mid-stream errors the response instead of
  ending a truncated file that looks complete.
- **Export on iOS**: the Profile row is a plain `<a href="/api/me/export">` (not `next/link`, so nothing prefetches it and burns the rate
  limit). A navigation to a `Content-Disposition: attachment` response is what makes Safari, including the standalone home-screen app,
  show its download sheet. Don't switch it to `fetch` + blob.
- **Delete account** (`deleteAccountAction` in `src/lib/account/actions.ts` -> `deleteAccount` in `delete.ts`): the Profile sheet lists
  the consequences and asks the user to type their username (case-insensitive, `@` optional). In one transaction it revokes the user's
  keys, removes their allowlist entry and deletes the `users` row. Every user-owned table references `users(id)` with `ON DELETE CASCADE`
  (`tests/integration/delete-account.test.ts` checks all foreign keys, and every table with a `user_id` column, so a new table can't be
  forgotten); the two `SET NULL` references are `messages.user_id` (their chat messages stay, with no author: the UI shows "Deleted
  user" for a `text` message without a user) and `allowed_emails.added_by`. After the commit the uploaded avatar file is removed (the
  retention orphan sweep would catch a leftover). Then `signOut` redirects to `/login?deleted=1`, which shows "Your account and data were
  deleted." The admin (`ADMIN_EMAIL` or `is_admin`) is refused; the Profile row is disabled for them. Logs carry the user id only.
- **Perf assertion**: the 366-day backfill test in `tests/integration/ingest.test.ts` fails above 10 s by default (so it doesn't flake under
  parallel load); set `PERF_STRICT=1` for the real 3 s budget on an idle machine.
