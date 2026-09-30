# Deploying `Huddle` on the homelab

Friends-only health leaderboard (Next.js + worker + Postgres), deployed at
`https://huddle.anishsaranga.com` -> `http://localhost:6060`. Same pattern as the
other services on `anish-homelab-z2-g3-mini`; see
`C:\SERVER_REPOS\SERVICES-RUNBOOK.md` for the Cloudflare Tunnel / Tailscale /
Docker-Desktop topology and reboot-recovery notes, and
`C:\SERVER_REPOS\alpha-chat\DEPLOY.md` for the reference this follows.

Unlike alpha-chat, Huddle has its **own subdomain**, so there is no `basePath`
and no path-based ingress rule: the app is served at `/`.

## 0. Route table

| Public route                       | Local target            | Backing service                                                          |
|------------------------------------|-------------------------|--------------------------------------------------------------------------|
| `huddle.anishsaranga.com` (whole host) | `http://localhost:6060` | `huddle-prod-web` (+ `huddle-prod-worker`, `huddle-prod-db`), compose project `huddle-prod` |

Line to add to the runbook's route table once live:

```
| `huddle.anishsaranga.com`         | `http://localhost:6060` | `huddle-prod-web` + `huddle-prod-worker` + `huddle-prod-db` (docker compose, `C:\SERVER_REPOS\Huddle`, `docker-compose.prod.yml`) — Postgres is internal only (no host port); avatars on the `huddle-prod-avatars` volume, data on `huddle-prod-pgdata` |
```

Containers (all `restart: unless-stopped` except the one-shot migrate):

| Container              | Role                                                                 |
|------------------------|----------------------------------------------------------------------|
| `huddle-prod-db`       | Postgres 16, no published port, volume `huddle-prod-pgdata`          |
| `huddle-prod-migrate`  | One-shot: applies Drizzle migrations, then exits 0                   |
| `huddle-prod-web`      | Next.js standalone server, `127.0.0.1:6060`, mem 768m / 1.5 CPU      |
| `huddle-prod-worker`   | Cron jobs (Postgres advisory lock), mem 256m / 0.5 CPU               |

The dev stack (`docker-compose.yml`, container `huddle-db`, port 5433) uses
different names and volumes, so both can run at the same time.

## 1. Prerequisites

Docker Desktop must be running. It is a **per-user GUI app, not a Windows
service**: after a reboot it only starts once someone logs in interactively. See
`SERVICES-RUNBOOK.md` ("Known failure mode" and "Reboot resilience") for why an
unattended reboot leaves every container down while the tunnel looks green.

```powershell
Get-Service com.docker.service   # Stopped == engine is down; start Docker Desktop and wait ~20-30s
docker ps                        # should succeed with no "failed to connect to the docker API" error
```

You also need port `6060` free on the host loopback:

```powershell
netstat -ano | findstr ":6060"   # should print nothing
```

## 2. Configure secrets

```powershell
cd C:\SERVER_REPOS\Huddle
Copy-Item .env.production.example .env.production
notepad .env.production
```

`.env.production` is gitignored. See `.env.production.example` for the full
variable list with comments; do not duplicate it here. Things that are easy to
get wrong:

- **`AUTH_URL` must be an ORIGIN ONLY**: `https://huddle.anishsaranga.com`, never
  with a path or a trailing slash. Auth.js derives its API base path from this
  URL's pathname, so a path silently breaks the whole auth API in a way that
  reads like a routing bug (the same lesson as alpha-chat's `NEXTAUTH_URL`).
  `APP_URL` is the same origin (it builds the ingest URL shown in Setup).
- **Generate secrets** (`AUTH_SECRET`, `API_KEY_PEPPER`):
  ```powershell
  openssl rand -base64 32
  ```
  and `POSTGRES_PASSWORD` with `openssl rand -hex 24` (it goes into a connection
  URL, so keep it URL-safe; there is deliberately no default).
- **`API_KEY_PEPPER` must never change casually.** Only HMAC(pepper) of each API
  key is stored, so rotating it invalidates **every** API key: all iPhone
  Shortcuts get 401 until each person regenerates their key. Back it up.
- **`POSTGRES_PASSWORD` is only read when the volume is first created.** Changing
  it later needs `ALTER USER huddle PASSWORD '...'` inside Postgres too.
- `ADMIN_EMAIL` is the only admin and is always allowed to sign in. Everyone else
  must be added to the allowlist in `/admin` first.
- Never set `E2E_AUTH` (test-only login bypass; it is compiled out of production
  builds anyway).

## 3. Google OAuth client

In the Google Cloud Console (APIs & Services > Credentials), edit the OAuth
client used by `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` and add these **Authorized
redirect URIs**:

```
https://huddle.anishsaranga.com/api/auth/callback/google
http://localhost:3000/api/auth/callback/google
```

The second one is for local development. The "Continue with Google" button only signs anyone in once
both env vars are set; without them `/login` shows a notice instead.

## 4. Build and start

```powershell
cd C:\SERVER_REPOS\Huddle
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps -a
```

Expected: `huddle-prod-db` healthy, `huddle-prod-migrate` `Exited (0)`,
`huddle-prod-web` healthy (about 20 s after start), `huddle-prod-worker` up. The
first build takes a few minutes (`npm ci` + `next build`); no database is needed
at build time.

`--env-file .env.production` is needed on every compose command (`up`, `down`,
`ps`, `logs`) because the compose file interpolates `POSTGRES_PASSWORD`.

## 5. Verify locally BEFORE touching the tunnel

```bash
curl http://127.0.0.1:6060/api/health
curl http://127.0.0.1:6060/api/auth/providers
```

- Health must be `{"ok":true,"db":true}`.
- **Check the `callbackUrl` in the providers response is exactly
  `https://huddle.anishsaranga.com/api/auth/callback/google`.** This is the
  highest-value check in this doc: a wrong `AUTH_URL` (a path, `http://`,
  `localhost`) still returns 200 everywhere locally and only shows up when a real
  user hits "Continue with Google" through the tunnel and Google rejects the
  redirect.

```bash
curl -s -o /dev/null -w "login       (want 200): %{http_code}\n" http://127.0.0.1:6060/login
curl -s -o /dev/null -w "test login  (want 404): %{http_code}\n" -X POST http://127.0.0.1:6060/api/test/login
docker logs huddle-prod-worker    # expect: "worker started, jobs scheduled"
```

Do not proceed to step 6 until all of these are correct.

## 6. Cloudflare Tunnel

**A bad edit here takes down `anishsaranga.com`, `/ashwin`, `/learn`,
`/alpha-chat` and `/bathroom-status` too**: it is one shared ingress file for
every route on the box. Back it up first:

```powershell
Copy-Item C:\ProgramData\Cloudflared\config.yml C:\ProgramData\Cloudflared\config.yml.bak
```

The **active** config is `C:\ProgramData\Cloudflared\config.yml` (tunnel id
`6f4e8093-1307-4f0d-a671-fb09dbe78e21`, run by the `Cloudflared` Windows
service). The copy under `C:\Users\anish\.cloudflared\` is stale; do not edit it.

**a) DNS.** Create the CNAME for the new hostname (once):

```powershell
cloudflared tunnel route dns 6f4e8093-1307-4f0d-a671-fb09dbe78e21 huddle.anishsaranga.com
```

**b) Ingress.** Add a whole-host rule **before** the catch-all `http_status:404`
(ingress matching is top to bottom). It can go anywhere above the catch-all; the
other rules are for `anishsaranga.com`, a different hostname, so they do not
overlap:

```yaml
  # huddle - friends health leaderboard (docker compose, port 6060)
  - hostname: huddle.anishsaranga.com
    service: http://localhost:6060

  - service: http_status:404
```

**c) Validate before restarting** (a syntax error would otherwise take the
service down on restart):

```powershell
cloudflared tunnel --config C:\ProgramData\Cloudflared\config.yml ingress validate
cloudflared tunnel --config C:\ProgramData\Cloudflared\config.yml ingress rule https://huddle.anishsaranga.com/api/health
# expect: Matched rule ... service: http://localhost:6060
cloudflared tunnel --config C:\ProgramData\Cloudflared\config.yml ingress rule https://anishsaranga.com/learn
# expect it still matches the /learn rule (4444)
```

**d) Restart** (needs an **elevated** shell):

```powershell
Restart-Service Cloudflared   # run as Administrator
```

**e) Public checks:**

```bash
curl -s -w "\n%{http_code}\n" https://huddle.anishsaranga.com/api/health
curl -s -o /dev/null -w "public login (want 200): %{http_code}\n" https://huddle.anishsaranga.com/login
curl -s https://huddle.anishsaranga.com/api/auth/providers
# and the neighbours must be unaffected:
curl -s -o /dev/null -w "public /ashwin : %{http_code}\n" https://anishsaranga.com/ashwin
curl -s -o /dev/null -w "public /learn  : %{http_code}\n" https://anishsaranga.com/learn
curl -s -o /dev/null -w "public /       : %{http_code}\n" https://anishsaranga.com/
```

DNS can take a minute to appear; if the hostname does not resolve yet, wait and
retry before suspecting the ingress.

Then add the route table line from section 0 to `SERVICES-RUNBOOK.md`.

## 7. iPhone checks

On the iPhone, in Safari:

1. Open `https://huddle.anishsaranga.com`, sign in with Google (the `ADMIN_EMAIL`
   account first). A friend that is not on the allowlist lands on `/denied`.
2. Share > **Add to Home Screen**, then open Huddle from the Home Screen icon and
   sign in there if it asks again.
3. Finish onboarding, open **Setup** and confirm the ingest URL reads
   `https://huddle.anishsaranga.com/api/ingest` and a key is shown.
4. Run the **Huddle Sync** Shortcut, then check `/sync` or `/setup`: the last
   attempt should be a success. From the host: `docker logs huddle-prod-web`.
5. Profile > Export data downloads a JSON file (the iOS download sheet).

## 8. Updating

```powershell
cd C:\SERVER_REPOS\Huddle
git pull
docker tag huddle-prod:latest huddle-prod:previous      # keep the old image for rollback
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Migrations run automatically: `huddle-prod-migrate` re-runs on every `up`, before
`web` and `worker` are recreated, and `web` will not start if it fails
(`docker logs huddle-prod-migrate`). Migrations are forward-only and
idempotent; see Rollback for schema-changing releases. Expect a few seconds of
downtime while `web` is recreated.

## 9. Backups

The data lives in two named volumes: `huddle-prod-pgdata` and
`huddle-prod-avatars`. **Do not run `docker compose down -v`** on the prod stack
unless you mean to delete both.

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
# Database (custom format; restore with pg_restore)
docker exec huddle-prod-db pg_dump -U huddle -Fc huddle > "huddle-$stamp.dump"
# Avatar photos
docker run --rm -v huddle-prod-avatars:/data -v ${PWD}:/backup alpine tar czf /backup/avatars-$stamp.tgz -C /data .
```

Restore the database into a running stack:

```powershell
docker cp huddle-2026xxxx.dump huddle-prod-db:/tmp/restore.dump
docker exec huddle-prod-db pg_restore -U huddle -d huddle --clean --if-exists /tmp/restore.dump
```

Keep a copy of `.env.production` (especially `API_KEY_PEPPER` and
`AUTH_SECRET`) somewhere safe, separately from the repo.

## 10. Rollback

Code/image only (no schema change in the release being rolled back):

```powershell
git checkout <previous-commit>
docker tag huddle-prod:previous huddle-prod:latest
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-build
```

If the bad release included a migration, restore the pre-update `pg_dump` (section
9) as well; migrations do not have down scripts. Take a dump before every update
that adds a file under `drizzle/`.

Take the public site down (revert the ingress edit) without touching data:

```powershell
Copy-Item C:\ProgramData\Cloudflared\config.yml.bak C:\ProgramData\Cloudflared\config.yml -Force
Restart-Service Cloudflared   # elevated
docker compose -f docker-compose.prod.yml --env-file .env.production down   # no -v: keeps the data
```

## 11. Logs

Everything logs JSON lines to stdout (pino); Docker rotates them (10 MB x 5 files
per container).

```powershell
docker logs -f huddle-prod-web
docker logs -f huddle-prod-worker
docker logs huddle-prod-migrate
docker compose -f docker-compose.prod.yml --env-file .env.production ps -a
```

Raise verbosity with `LOG_LEVEL=debug` in `.env.production`, then `up -d` again.

## 12. Reboot resilience

`web`, `worker` and `db` are `restart: unless-stopped`, so they come back once
Docker Desktop's engine is back (see the runbook for the auto-login fix).
`migrate` is one-shot; after a plain engine restart `web` simply restarts against
the already-migrated database. Nothing Huddle-specific to add.

## 13. Security notes

- **Loopback bind.** `web` publishes `127.0.0.1:6060` only. Rate limiting trusts
  the `CF-Connecting-IP` header for the client IP, which is only safe if nothing
  but the tunnel (a local process) can reach the port. Never change this to
  `6060:6060` or `0.0.0.0`: anyone on the LAN could forge that header and dodge
  the per-IP limits.
- **Postgres has no host port.** It is reachable only from the compose network;
  use `docker exec -it huddle-prod-db psql -U huddle` for a shell.
- **`?key=` URLs.** The Shortcut can pass its API key as a `?key=` query
  parameter. The app logs only the path for `/api/ingest` and redacts key/token
  fields, and `cloudflared` does not log request URLs by default. Keep it that
  way: do not enable access logging (a reverse proxy in front, `--loglevel debug`
  on cloudflared, Cloudflare Logpush) without scrubbing query strings. Prefer the
  `Authorization: Bearer` header where the Shortcut allows it.
- **Container hardening.** The app runs as the non-root `nextjs` user with memory,
  CPU and PID limits, so a runaway process is restarted instead of starving the
  other services on this box.
- **Secrets** live only in `.env.production` (gitignored, never baked into the
  image: `.dockerignore` excludes `.env*`).
