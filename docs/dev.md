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
- Adding a friend before the admin UI exists:
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
