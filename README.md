# Huddle

A private, invite-only fitness group for friends. Everyone's Apple Health data (steps, heart rate, sleep and more) flows in from an iPhone Shortcut, and Huddle turns it into daily **Sleep**, **Recovery** and **Strain** scores in a dark, data-dense, WHOOP-inspired PWA. Groups get leaderboards, live chat and a weekly AI-written "champions" post.

Huddle is not affiliated with WHOOP and uses none of its name or assets. All scores come from Huddle's own formulas, and every metric is optional, so it works with whatever mix of wearables your friends have (Apple Watch, Fitbit, Zepp and others, as long as they write to Apple Health).

## Features

- **Personal dashboard**: Home, Sleep, Recovery and Strain screens with day navigation, trends (1 week, 1 month, 6 months) and "limited data" explanations instead of guessed numbers.
- **Groups**: Info, Chat, Strain, Recovery and Sleep tabs. Day and week leaderboards with a podium and a pinned "your rank" bar.
- **Live chat**: text messages and reactions over server-sent events.
- **Weekly champions**: a scheduled job crowns winners per category (recovery, sleep, strain, steps, most improved), writes the post with Gemini (template fallback without a key) and awards flair.
- **iPhone Shortcut sync**: one ingest endpoint, a guided `/setup` page and a "Sync now" screen. Sends full-day snapshots (daily totals, hourly heart rate, raw sleep segments).
- **Avatars**: customizable DiceBear characters or an uploaded photo.
- **Invite only**: Google sign-in with an admin-managed allowlist and an admin panel (users, groups, ingest log and data coverage).
- **Installable PWA**: home-screen icon, splash screens, offline shell, link-preview card.
- **Your data is yours**: JSON export and full account deletion from the profile, plus automatic retention.

## Architecture

```
iPhone Shortcut (Apple Health)
        |  POST /api/ingest  (personal gk_ key)
        v
+---------------------------+      +---------------------+
|  Next.js 16 web app       |<---->|  PostgreSQL 16      |
|  App Router, Auth.js v5,  |      |  Drizzle ORM        |
|  Tailwind, SSE chat       |      +----------^----------+
+---------------------------+                 |
                                +-------------+-------------+
                                |  Worker (node-cron)       |
                                |  weekly champions,        |
                                |  nightly retention        |
                                +---------------------------+
```

- **Web**: Next.js 16 (TypeScript, Tailwind), Auth.js with Google and database sessions.
- **Worker**: a separate Node process from the same codebase. It holds a Postgres advisory lock so only one instance runs jobs.
- **Ingest**: keys are stored only as an HMAC, payloads are validated with zod and written in one transaction, then scores are recomputed for the affected dates.
- **Production**: one Docker image runs the web app, the worker and the migrations, behind a Cloudflare Tunnel on the homelab.

## Local development

Requires Node 24 and Docker.

```sh
npm install
cp .env.example .env         # fill in AUTH_SECRET, API_KEY_PEPPER, ADMIN_EMAIL (Google credentials optional)
npm run db:up                # Postgres 16 on 127.0.0.1:5433
npm run db:migrate           # apply migrations to the dev database
npm run db:seed              # optional: six demo friends with 90 days of data
npm run dev                  # http://localhost:3000
npm run worker:dev           # optional: run the scheduled jobs
```

Without Google credentials the login page explains that sign-in is not configured. See [docs/dev.md](docs/dev.md) for the e2e login bypass and everything else.

## Tests

| Command | What |
| --- | --- |
| `npm test` | Vitest: pure unit tests plus integration tests against a real Postgres (`huddle_test`) |
| `npm run test:e2e` | Playwright (iPhone 15, Chromium) against its own dev server on port 3200 |
| `npm run lint` and `npm run typecheck` | ESLint and TypeScript |

To run suites in parallel (two worktrees or agents), give each its own database slot and port:

```sh
npm run db:test:create -- a
TEST_DATABASE_URL=postgres://huddle:huddle@localhost:5433/huddle_test_a npm test
TEST_DATABASE_URL=postgres://huddle:huddle@localhost:5433/huddle_test_a E2E_PORT=3210 npm run test:e2e
```

## Documentation

- [docs/dev.md](docs/dev.md): developer notes (auth, scores, dashboards, chat, worker, PWA, retention, production).
- [docs/ingest-api.md](docs/ingest-api.md): the ingest endpoint, payload shapes, limits and examples.
- [DEPLOY.md](DEPLOY.md): running the production stack behind a Cloudflare Tunnel, backups and rollback.
- [docs/specs/2026-09-28-huddle-design.md](docs/specs/2026-09-28-huddle-design.md): the original design and implementation plan.
