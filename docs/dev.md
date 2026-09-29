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
| `npm test` | Vitest: `unit` project (pure) + `integration` project (real Postgres `huddle_test`; migrated in global setup, all tables truncated before each test). Override the DB with `TEST_DATABASE_URL`; its name must end in `_test`. |
| `npm run test:e2e` | Playwright (iPhone 15, Chromium). Starts its **own** `next dev` on **:3200** with `E2E_AUTH=1`, `DATABASE_URL=huddle_test`, empty Google creds and `NEXT_DIST_DIR=.next-e2e` (so it can run next to the :3000 dev server; Next 16 locks each dist dir). Reuses a running :3200 server locally. |

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
  (`components/profile/fields.tsx`). The Playwright web server uses `AVATAR_DIR=.next-e2e/avatars`.
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
- `GET /api/me/sync-status` accepts a session or an API key (Bearer or `?key=`); a bad key gets a bare 401. The proxy lets
  key-bearing requests to it through (`acceptsApiKey` in `route-access.ts`).

## Ingest (`POST /api/ingest`)

- Payload reference, status codes and examples: `docs/ingest-api.md` (its metric table is checked against
  `fields.ts` by `tests/unit/ingest-docs.test.ts`).
- Pipeline: `src/lib/ingest/handler.ts` (IP limit -> key auth -> key limit -> body -> JSON -> `schema.ts` (zod shapes,
  numeric coercion, columns) -> `normalize.ts` (timezone, date window, hr hours, sleep segments) -> `upsert.ts` (one
  transaction, per-user advisory lock) -> `onDataIngested` in `src/lib/scores/hooks.ts`). Sleep sessions/nights are pure
  functions in `sleep-merge.ts`; timezone helpers in `src/lib/tz.ts`; limiter in `src/lib/ratelimit.ts` (in memory,
  single instance).
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
