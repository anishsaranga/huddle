# Huddle: private fitness-group PWA (design and implementation plan)

## Context
Huddle is a new, private, invite-only iOS PWA for a small friend group (roughly 5 to 20 people).
- **Look:** a dark, data-dense UI fully inspired by WHOOP. The WHOOP name, logo, and assets are not used anywhere.
- **Personal:** each person has Sleep, Recovery, and Strain dashboards.
- **Groups:** Info, Chat, Strain, Recovery, and Sleep tabs, plus weekly AI-written "champions" posts.

A PWA cannot read Apple Health, so each user's iPhone Shortcut pushes data to one ingest endpoint using a personal API key. Friends use mixed wearables (Zepp, Fitbit Air, possibly Apple Watch), and all of them write to Apple Health. Every metric is therefore optional, and all scores are Huddle's own formulas, computed on the server.

- **Repo:** `C:\SERVER_REPOS\Huddle`. It is empty and not yet a git repo. The remote is `https://github.com/anishsaranga/huddle.git`.
- **Decisions made:**
  - Next.js and Postgres, self-hosted with Docker and exposed through a **cloudflared** tunnel, matching your other projects in `C:\SERVER_REPOS`. Those get inspected at the deploy milestone.
  - The app is named Huddle.
  - Gemini writes the AI posts, with `GEMINI_API_KEY` and `GEMINI_MODEL` in `.env`.
  - Chat is text plus reactions, live over SSE.
  - Avatars use **DiceBear**, customizable, with photo upload as an alternative.
  - The Shortcut sends full-day snapshots over a self-healing window of at least 3 days and at most 14. Each snapshot has daily totals, hourly heart rate, and raw sleep segments. It is triggered by "App is opened" automations, with a 45-minute throttle.

## Research: what an iPhone Shortcut can export from Apple Health
- **How it works:** `Find Health Samples` filters by type and date, can group by hour or day, and exposes Value, Start, End, and Source. `Calculate Statistics` produces sum, average, min, and max. `Get Contents of URL` POSTs JSON. The user must allow "Shortcuts: read data" in Health.
- **Readable types we use:**
  - **Activity:** steps, walking+running distance, flights, active and resting energy, exercise minutes, stand minutes, time in daylight, mindful minutes.
  - **Heart:** heart rate (grouped by hour: min, avg, max), resting HR, walking HR average, HRV (SDNN), VO2 Max.
  - **Vitals:** SpO2, respiratory rate, sleeping wrist temperature.
  - **Body:** weight, body fat %.
  - **Sleep:** analysis segments (In Bed, Asleep, Awake, Core, Deep, REM) with start, end, and source.
- **Not readable:**
  - Workouts as sessions. We use exercise minutes and active energy instead.
  - Apple's iOS 26 Sleep Score and Vitals outputs.
  - **Anything while the phone is locked.** The shortcut only works while unlocked, which the app-open trigger and "Sync now" both satisfy.
- **Gotchas:**
  - Compute sleep duration as end minus start; the Duration field is unreliable.
  - Sleep crosses midnight, so query from 18:00 the previous day onward.
  - Date filters apply to dates, not times, so query broadly and filter on the server.
  - iPhone and wearable samples overlap. Sleep is deduped on the server. For steps and energy, group-by-day totals are expected to be deduped by HealthKit statistics. This gets verified on a real device in M5; if it's wrong, the guide adds a "Source is …" filter.

### What your friends' devices actually write to Apple Health
| Metric | Zepp / Amazfit | Fitbit Air (Google Health, iOS 16.4+) | Apple Watch |
|---|---|---|---|
| Steps, distance, active energy | ✅ | ✅ | ✅ |
| Heart rate samples, resting HR | ✅ | ✅ | ✅ |
| Sleep sessions | ✅ | ✅ | ✅ |
| Sleep stages (Deep, REM, Core/Light) | ⚠️ inconsistent; often just "Asleep" | ✅ (Light maps to Core) | ✅ |
| HRV | ❌ except Helio Strap, which writes only 3–4 readings a day | ❌ not written by Google | ✅ |
| SpO2 | ✅ | ✅ | ✅ |
| Respiratory rate | ❓ unclear | ✅ | ✅ |
| Workouts | written, but Shortcuts can't read them | written, but not readable | written, but not readable |
| Weight | ✅ via Zepp scale | — | — |

**Consequences:**
- Recovery can't depend on HRV. Its core inputs are resting HR, sleep score, and respiratory rate, and HRV is a bonus input when present.
- Zepp and Google Health write to Apple Health late: Zepp only after its own app syncs, and Google Health roughly every 15 minutes. So each run sends a rolling 3-day window.

## Architecture
- **Framework:** Next.js 15 (App Router, TypeScript, Tailwind), Drizzle ORM with Postgres 16, and Auth.js v5 with Google and database sessions.
- **Containers:** Docker Compose runs `db`, `web`, and `worker`, plus `cloudflared` if that matches your other projects (checked at M8).
  - `worker` is a Node process using the same codebase with `node-cron`. It runs the nightly retention job, score recompute, and the weekly champions poster.
- **Logging (pino):**
  - `src/lib/log.ts` exports one shared pino logger with child loggers per module (`ingest`, `auth`, `worker`, `chat`, `ai`). Output is JSON to stdout in production and pretty-printed in dev (`pino-pretty`). `LOG_LEVEL` is set in env.
  - **Redaction is enforced in the logger config:**
    - `req.headers.authorization`, `req.headers.cookie`, and any `key`/`apiKey` field are redacted.
    - URLs for `/api/ingest` are logged as the path only, never the query string.
    - Session tokens and OAuth secrets are never logged.
  - cloudflared doesn't log request URLs by default, and this gets double-checked at deploy.
- **Live chat:** SSE route backed by Postgres `LISTEN/NOTIFY`, which is fine for a single node.
- **Rate limiting:** an in-memory sliding window keyed per API key and per client IP, 60 requests per hour each. The IP comes from the `CF-Connecting-IP` header behind the tunnel. It is documented as single-instance.
- **Uploaded photos:** stored on a Docker volume (`/data/avatars`), resized with `sharp`, and served through an authenticated route.
- **Environment variables:**
  - Auth: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
  - App: `ADMIN_EMAIL`, `API_KEY_PEPPER`, `APP_URL`
  - AI: `GEMINI_API_KEY`, `GEMINI_MODEL`
  - Shortcut: `SHORTCUT_NAME` (default "Huddle Sync"), `SHORTCUT_ICLOUD_URL` (optional)
  - Logging: `LOG_LEVEL` (default `info`), `INGEST_LOG_RETENTION_DAYS` (default 90)
  - A committed `.env.example` lists these.

### Proposed layout
```
src/app/(auth)/login, /denied, /install        src/app/onboarding/*
src/app/(app)/home, /sleep, /recovery, /strain, /groups, /groups/[id]/{info,chat,strain,recovery,sleep}, /profile, /sync, /setup
src/app/admin/*                                 src/app/api/{ingest, me/sync-status, me/export, groups/[id]/stream, avatar/[userId], ...}
src/db/schema.ts, drizzle/                      src/lib/{auth, apikey, ratelimit, tz}.ts
src/lib/ingest/{schema, upsert, sleep-merge}.ts src/lib/scores/{sleep, recovery, strain, baseline}.ts
src/lib/avatar/{dicebear.ts, styles.ts}         src/components/{Avatar, Dial, TrendBars, Hypnogram, Leaderboard, TabBar, ...}
src/lib/ai/{gemini, champions}.ts               src/worker/index.ts
tests/unit, tests/integration (real Postgres), tests/e2e (Playwright, iPhone viewport)
```

## Auth, allowlist, and admin
- The Auth.js `signIn` callback allows a login only if the email is in `allowed_emails` and the user is not deactivated. Otherwise it redirects to `/denied`, which says "Ask the admin to add you."
- If the email matches `ADMIN_EMAIL` (case-insensitive), that user is always allowed and has `is_admin=true` forced on every login.
- Login uses a full-page redirect flow with no popup, so it works inside an iOS standalone PWA.
- **Admin panel:**
  - Add or remove allowlisted emails.
  - Create, rename, or delete groups, and add or remove members. Users can be in several groups.
  - Deactivate or reactivate users. Deactivating kills their sessions and revokes their API keys.
  - A users table showing each user's last sync time and days covered.

## Data model (main tables)
- **Identity and groups**
  - `users`: profile, onboarding fields, `is_admin`, `deactivated_at`, `avatar_kind` (`dicebear|upload`), `avatar_config` (JSON: `{style, seed, options}`), `avatar_path`, `timezone`, `units`, goals, `max_hr`, `dob`, `sex`, `height_cm`, `weight_kg`.
  - `accounts`, `sessions`: Auth.js tables. `allowed_emails`.
  - `groups`: with a timezone. `group_members`.
- **API keys:** `api_keys` stores `user_id`, `hash` (HMAC-SHA256 with the pepper, unique), `prefix_hint`, `created_at`, `revoked_at`, and `last_used_at`.
- **Health data**
  - `daily_metrics`: primary key `(user_id, local_date)`. Every metric is a nullable column, plus `updated_at`.
  - `hr_hourly`: `(user_id, local_date, hour)` with min, avg, and max.
  - `sleep_segments`: `(user_id, wake_date, stage, start_ts, end_ts, source)`.
  - `daily_scores`: `(user_id, local_date)` with sleep, recovery, strain, and component JSON.
  - `ingest_events`: the full audit trail of every sync. See Ingestion.
- **Group content:** `messages` (group, user or null for system, body, kind `text|champions`, payload JSON), `reactions`, and `champion_awards` (group, week, category, user) for avatar flair.

## Ingestion (the core feature)
- **Auth**
  - Keys are `gk_` plus 43 base64url characters (32 random bytes). Only the hash is stored. The key is shown once, with a copy button. It can be regenerated or revoked in Profile.
  - The key comes from `Authorization: Bearer`, or from `?key=` as a fallback. The docs warn that URLs get logged.
  - A bad or revoked key gets a bare `401` response.
  - Rate limit: 60 requests per hour per key and per IP. Over the limit returns `429` with `Retry-After`.
  - Body is capped at 3 MB. Oversize gets `413`. Optional `Content-Encoding: gzip` is supported, with the cap applied after decompression.
- **`POST /api/ingest`** accepts a single Day, an array of Days, or `{ days: Day[], sleep_segments?: Segment[] }`.
  - At most 366 days per request.
  - Every field is optional apart from `date`. Known fields are strictly type- and range-checked by zod.
  - Series fields accept JSON arrays **or** newline-joined strings. Shortcuts can build the strings without loops.
  - Any date later than today+1 in the user's timezone is rejected.
- **Upsert:**
  - `ON CONFLICT (user_id, local_date)` updates only the keys present in the payload. An absent key leaves the value untouched; an explicit `null` clears it.
  - If `hr_hourly` is present for a day, that day's rows are replaced.
  - Sleep segments are grouped into sessions (a gap of 90 minutes or more starts a new one), and each session is assigned to the local date of its end.
  - For each night, the source with stage detail wins, with the longest asleep total as a tiebreak.
  - After the upsert, scores are recomputed for the affected dates plus 30 days forward. The request returns `{ ok, days_written, last_sync_at }`.
- **Unknown fields are kept visible:** the schema validates the known fields and removes unknown keys from what gets saved to the metrics tables. The unknown keys are recorded, not rejected, so new data a Shortcut starts sending shows up in the logs and becomes candidates for future features.
- **Ingest logging.** Every authenticated request is fully logged: success, 400 validation errors, 413, and 429. Unauthenticated 401s log only the IP and reason, with no body.
  - **pino log line** at `info`, one per request:
    - `userId`, `username`, `auth` (`bearer|query`), `ip`, bytes, duration, and status
    - `days` count and date range
    - **per-day field inventory:** which known fields had values, which were explicitly null, and which were absent
    - `unknownFields`, and counts for `hr_hourly` and `sleep_segments`
    - sleep sources seen, and stages seen per source
    - rows inserted versus updated, and zod issues for any rejection
  - The **full JSON body** is logged at `debug` (turned on with `LOG_LEVEL=debug`), with only the key redacted.
  - **`ingest_events` table**, so the history can be queried later, not just grepped from stdout:
    - `id`, `user_id`, `received_at`, `status`, `auth_method`, `bytes`, and `duration_ms`
    - `summary` JSONB: the field inventory, unknown fields, sources, stages, and date range
    - `body` JSONB: the raw payload, key never included
    - `errors` JSONB
  - Raw bodies are kept `INGEST_LOG_RETENTION_DAYS` days (default 90) by the nightly job. They're included in the user's export and deleted with their account.
- **Admin "Data coverage" view:**
  - A grid of users against fields, showing how often each user sends each field over the last 30 days (for example, "Priya: HRV 0%, sleep stages 100%, SpO2 80%").
  - A list of every unknown field seen, with counts.
  - A per-user ingest log with an expandable raw body.
  - This shows exactly what each device and Shortcut provides and what's missing.
- **`GET /api/me/sync-status`:** accepts a session cookie or API key. Returns `last_sync_at`, `days_covered`, `first_date`, `last_date`, and `last_payload_dates`.

## Scores (Huddle's own formulas, pure functions with golden-fixture tests)
- **Sleep (0–100):** a weighted mix of four parts:
  - duration versus the sleep goal: 50%
  - efficiency (asleep ÷ in bed): 15%
  - restorative share (deep + REM): 20%
  - consistency (versus the 7-day mean): 15%
  - If a part is missing, the weights are rescaled across the parts that exist.
- **Recovery (0–100%):** z-scores against the personal 30-day baseline, which needs at least 4 days.
  - Inputs and weights: RHR (−, 45%), sleep score (40%), respiratory rate (−, 15%).
  - If HRV is present, it takes 30% and the base weights shrink proportionally.
  - A logistic function maps the result to 0–100. A missing input shows a "limited data" badge.
  - Bands: green at 67 and above, yellow from 34 to 66, red at 33 and below.
- **Strain (0–21, logarithmic):**
  - Hourly load = minutes × intensity², where intensity = (hourly avg HR − RHR) ÷ (max HR − RHR). Hourly max HR adds a bonus for hard efforts.
  - Active kcal and exercise minutes are added in.
  - Strain = 21 × (1 − e^(−load/k)), with k calibrated so a moderate day of about 45 exercise minutes lands near 10.
  - Max HR is the user's value, or 208 − 0.7 × age.
- **Leaderboards** only rank members with data. Weekly boards run Monday to Sunday on each user's local dates and need at least 4 days.

## Shortcut, "Sync now", and setup guide
- **Huddle Sync:** what each run sends, and why.
  - **Full-day snapshots, not deltas.** For each day in the window, the shortcut re-reads that whole day from Health and sends the complete values: the day's step total, the 24 hourly HR buckets, and all of that night's sleep segments.
    - The server overwrites the stored day, so re-sending the same day is harmless.
    - Today's partial numbers get replaced by fuller ones on later runs, and a day is final once it's more than 2 days old.
    - Nothing ever needs to be added up across pushes.
  - **Self-healing window.** The shortcut keeps one small file, `Huddle/state.json`, holding `last_success_date` and `last_run_at`.
    - If the last run was under 45 minutes ago, it exits immediately (the throttle).
    - Otherwise the window runs from the earlier of (today − 2) and (`last_success_date` − 1) through today, capped at 14 days.
    - Normally that's 3 days. If a phone went untouched for 5 days, the next run automatically sends 6 days, so there are no gaps.
    - After a 2xx response, it writes the new `last_success_date`.
    - The 2-day overlap also picks up late Zepp and Google Health writes.
  - **Payload size:** the real compression is done on the phone, by aggregating.
    - About 1,400 raw HR samples a day become 24 hourly buckets.
    - Steps and energy become one number per day, using Group By Day and statistics.
    - Only sleep is sent raw, at about 30–60 segments a night, because stage timing is needed.
    - A day is about 3–5 KB, so a normal 3-day run is about 15 KB and a 14-day catch-up about 70 KB.
  - **Gzip is not used in the daily shortcut.** At about 15 KB it saves almost nothing and adds a slow, fragile Make Archive step.
    - The server still accepts `Content-Encoding: gzip`, capped at 3 MB decompressed to block zip bombs.
    - M5 tests whether the shortcut's Make Archive can produce raw gzip. If it can, **Backfill** may use it.
    - **Backfill** sends 365 days in 30-day chunks of about 150 KB each regardless, so it works without compression.
- It is triggered by "App is opened" automations (Instagram, WhatsApp, and so on) with "Run Immediately", plus the Sync now button.
- **Huddle Backfill** is a one-time push of up to 365 days, in chunks.
- **Distribution:** the admin builds each shortcut once and publishes an iCloud link. Its Import Questions ask for the server URL and the API key.
- **`/setup` page:**
  - The user's own ingest URL and key, with copy buttons. The full key appears only right after it's created or regenerated.
  - The install link, and a manual step-by-step build guide naming each action and field.
  - How to set up the automation, and a warning that `?key=` URLs get logged.
- **Sync now:**
  - Opens `shortcuts://x-callback-url/run-shortcut?name=Huddle%20Sync&x-success=…`.
  - When the app becomes visible again, it polls `/api/me/sync-status` every 3 s for up to 60 s.
  - It then shows **Synced ✓ (N days)**, **No new data**, or **Didn't hear from your Shortcut** with a link to /setup.
- **First-run check:** if the user has never pushed data, Home shows a setup card instead of dials.

## UI: fully WHOOP-inspired
- **Visual language**
  - Near-black background (`#0A0B0D`) with a subtle top gradient, cards `#15171B`, and hairline dividers.
  - Small ALL-CAPS labels with wide letter-spacing, and huge condensed numerals (Barlow Condensed plus Inter, self-hosted).
  - Colors carry meaning: recovery green `#2BD67B`, yellow `#F4C53D`, and red `#FF5A5F`; strain blue `#3D9BFF`; sleep periwinkle `#8C9BFF`.
  - Charts are hand-rolled SVG: ring dials, trend bars, hypnograms, and HR-by-hour bars.
- **Home ("Overview")**
  - A date switcher at the top (‹ TODAY ›).
  - A row of three ring dials: Recovery %, Strain 0–21, Sleep %.
  - A "Key stats" list showing each metric against its 30-day baseline with ▲/▼ arrows: resting HR, HRV if present, respiratory rate, sleep hours, steps, and calories.
  - The last sync time with a Sync button.
- **Detail screens:**
  - **Recovery:** a big dial plus a list of contributors, each with its value, baseline, and delta.
  - **Sleep:** a hypnogram, time in each stage, hours versus need, efficiency, and consistency.
  - **Strain:** HR by hour, and active calories and exercise minutes.
  - Each has 1W, 1M, and 6M trend toggles.
- **Community tab:** a list of groups. Inside a group, a header with the group name and avatars, then swipeable top tabs: **Info · Chat · Strain · Recovery · Sleep**.
  - **Leaderboard rows:** rank, avatar with a colored ring, name, and value. Your own row is pinned. There's a Day/Week toggle.
  - **Chat:** bubbles with reactions. Champions posts appear as big highlighted cards with podium avatars.
- **Bottom tab bar:** Home · Community · Sync · Profile.

## iOS PWA compatibility (a requirement, not polish)
- **Install and metadata**
  - Manifest: `display: standalone`, dark theme and background colors, and 180, 192, 512, and maskable icons.
  - `apple-touch-icon`, `apple-mobile-web-app-capable`, status bar `black-translucent`, and `viewport-fit=cover`.
  - Generated `apple-touch-startup-image` splash screens for current iPhone sizes.
- **Layout and touch**
  - `env(safe-area-inset-*)` on the header and tab bar, and `100dvh` layouts.
  - Inner scroll containers with `overscroll-behavior: contain`, so there's no rubber-band on the app chrome.
  - Inputs use 16px fonts or larger to prevent zoom, `-webkit-tap-highlight-color: transparent`, and nothing depends on hover.
- **Install prompt:** standalone mode is detected with `navigator.standalone` or the display-mode media query. In plain Safari, an `/install` page shows "Add to Home Screen" steps.
- **Behaviour in standalone mode**
  - OAuth uses full redirects only, with no popups, and gets tested in standalone mode on a device in M1.
  - SSE reconnects on `visibilitychange`, because iOS kills background connections.
  - Clipboard copy has a fallback, and `shortcuts://` links fire from a user tap.
- **Service worker:** app-shell cache plus an offline page. No web push in v1.

## Avatars (DiceBear)
- The `@dicebear/core` and `@dicebear/collection` npm packages render the SVG locally. The output is the same as the DiceBear HTTP API, but with no external calls, so it works offline and friends' configs never leave the server.
- **Customizer**
  - Pick a style from a curated set of about 6 (for example adventurer, avataaars, lorelei, notionists, open-peeps, micah).
  - Then there are per-feature option pickers generated from each style's option schema: hair, eyes, brows, mouth, facial hair, glasses, accessories, skin, hair color, clothing color, and background.
  - Each picker option is a live thumbnail tile.
  - Randomize, and "shuffle this feature".
- **Storage:** saved as `{style, seed, options}`. `<Avatar>` renders it client-side, and `/api/avatar/[userId]` serves a cached SVG or PNG.
- A credits page follows each style's license from DiceBear's license table (some styles need attribution).
- **Upload** is the alternative: a circle crop with pinch-zoom.
- **Champion flair:** the week's champions get a category-colored ring and badge on their avatar.

## Retention and account
- A nightly worker job deletes daily data older than 365 days per user, using the user's timezone. It also deletes `ingest_events` older than `INGEST_LOG_RETENTION_DAYS`.
- `GET /api/me/export` downloads all of the user's data as JSON.
- **Delete account** asks the user to type their username. It then deletes the user and their data. Chat messages become "Deleted user", and the email is removed from the allowlist.

## Milestones (each ends with tests passing and the app checked at iPhone size in the browser pane)
0. **Spec and scaffold:**
   - Write this design to `docs/specs/2026-09-28-huddle-design.md`.
   - `git init`, add the remote, create the Next.js app, theme tokens, the iOS PWA shell (meta, safe areas, tab bar), Drizzle, Docker Compose, `.env.example`, Vitest, and Playwright.
1. **Auth and admin:** Google login, the allowlist, ADMIN_EMAIL enforcement, `/denied`, and the admin panel.
2. **Onboarding, profile, and avatars:** the stepper, the DiceBear customizer and upload, username checks, timezone detection, and Profile.
3. **API keys and ingest:** keys, `/api/ingest`, `/api/me/sync-status`, rate limits, and body cap. Also pino ingest logging, the `ingest_events` table, unknown-field capture, the admin Data coverage view, and integration tests. (The pino base logger lands in M0.)
4. **Scores and personal UI:** the score engine with fixtures (Zepp-like, Fitbit-like, Apple-Watch-like, iPhone-only), the Home overview, and the detail screens.
5. **Shortcut flow:** the /setup guide, Sync now with polling, and the first-run card. The shortcuts get built with you on your iPhone, and dedup gets checked on real devices.
6. **Groups:** the Community tab, Info, and the Strain, Recovery, and Sleep leaderboards (day and week).
7. **Chat and champions:** SSE chat with reactions, the worker, Gemini posts with the template fallback, and champion flair.
8. **Retention, export, deletion, and deploy:**
   - The nightly job, JSON export, account deletion, service worker, splash screens, and icons.
   - Inspect the sibling folders in `C:\SERVER_REPOS` for your cloudflared setup and mirror it: tunnel config, compose service, and hostname.

## Execution rules (from you)
- **All coding happens in subagents.** I orchestrate, review diffs, run tests, and check the app in the browser pane. Model per task:
  - **haiku:** trivial work such as config, env files, simple pages, and copy.
  - **sonnet:** medium work such as the admin panel, onboarding, the avatar customizer, groups UI, chat UI, export and delete, and the PWA shell.
  - **opus:** complex work such as the ingest pipeline and merge semantics, the score engine, sleep merging, the WHOOP-style dashboard visuals, SSE, and the champions job.
- **Tasks:** each milestone is split into small tasks, and **each task gets its own commit** once its tests pass. **No Co-Authored-By or any other attribution trailer** in any commit or PR.
- **Memory:** at the start of execution, save two feedback memories: "no co-author trailers" and "code via tiered subagents, one commit per task".
- **Remote:** `origin = https://github.com/anishsaranga/huddle.git`. I'll ask before the first push.

## Verification
- **Unit tests (Vitest):** zod schemas, merge and null semantics, sleep-session merging and source choice, and each score formula with golden fixtures per device profile.
- **Integration tests (real Postgres via Docker Compose):** Bearer and `?key=` auth, revoked key gets 401, the 61st request gets 429, oversize body gets 413, date+2 gets 400, sending the same payload twice leaves one row, a partial payload keeps the other fields, and an explicit null clears a value.
  - **Logging checks:** an `ingest_events` row is written with the right field inventory and unknown fields. Captured pino output contains the user, fields, and body, and never contains the API key, the `Authorization` header, or a query string.
- **E2E tests (Playwright, iPhone 15 viewport):** a test-only auth bypass that runs only when `NODE_ENV=test` and `E2E_AUTH=1`. Covers onboarding, key reveal, admin actions, leaderboards after seeding, and chat across two sessions.
- **Manual checks:** the browser pane at mobile size for WHOOP-style fidelity, and a real iPhone for standalone install, OAuth, the shortcut, and Sync now.
