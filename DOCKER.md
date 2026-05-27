# Kalki Bet — Dockerized development environment

End-to-end Docker setup for the Kalki Bet monorepo. After installing
Docker you can clone the repo, run one command, and have every service
(backend, bet, auctions, aviator, admin, postgres, redis, mailpit,
adminer) running locally with hot reload.

No Node.js, npm, Postgres, Redis, or Prisma CLI required on the host.
The only host-side dependencies are **Docker** and **Docker Compose v2**
(both bundled with Docker Desktop on Windows / macOS, available as
`docker.io` + `docker-compose-plugin` on Linux).

---

## TL;DR — fresh clone to running stack

```bash
git clone https://github.com/mahakaal02/bet.git
cd bet
cp .env.example .env
docker compose up -d --build
```

That's it. Open <http://localhost:8000> (the proxy) or any of the
direct ports listed below. The first run takes ~3-5 minutes to build
every image; subsequent `docker compose up` is seconds.

Convenience wrappers — `make` users and PowerShell users get the same
targets:

```bash
make -f Makefile.dev up         # Linux / macOS / WSL
./scripts/dev.sh up             # POSIX shells without make
.\scripts\dev.ps1 up            # Windows PowerShell
```

---

## Architecture

```
                                ┌──────────────────────┐
                                │     nginx :80        │
                                │  (host :8000)        │
                                │                      │
                                │  /          → bet     │
                                │  /api/      → backend │
                                │  /uploads/  → backend │
                                │  /admin/    → admin   │
                                │  /aviator/socket.io/      │
                                │  /notifications/socket.io/│
                                │  /ws → backend (WS)       │
                                └──────────┬───────────┘
                                           │
            ┌──────────────┬───────────────┼───────────────┬───────────────┐
            │              │               │               │               │
       ┌────▼────┐    ┌────▼────┐    ┌─────▼─────┐    ┌────▼─────┐   ┌─────▼─────┐
       │ backend │    │   bet   │    │  auctions │    │ aviator  │   │   admin   │
       │ NestJS  │    │ Next 15 │    │  Next 15  │    │  Next 15 │   │  Vite SPA │
       │ :4000   │    │  :3100  │    │   :3200   │    │   :3000  │   │   :5173   │
       └────┬────┘    └────┬────┘    └─────┬─────┘    └────┬─────┘   └─────┬─────┘
            │              │               │               │               │
            │   ┌──────────┴───────────────┴───────────────┴───────────────┘
            │   │ kalki-net (bridge network, internal DNS via service names)
            │   │
       ┌────▼───▼─────────┐  ┌──────────────┐  ┌──────────┐  ┌─────────────────┐
       │ postgres :5432   │  │ redis :6379  │  │ mailpit  │  │ backend-worker  │
       │   uniquebid + bet│  │ (AOF on)     │  │  :1025   │  │ (cron-only,     │
       │                  │  │              │  │  :8025   │  │  optional       │
       └──────────────────┘  └──────────────┘  └──────────┘  │  profile)       │
                                                              └─────────────────┘
       ┌──────────────────┐  ┌──────────────────┐
       │  adminer :8080   │  │ redis-commander  │
       │  (Postgres GUI)  │  │     :8081        │
       └──────────────────┘  └──────────────────┘
```

**Inter-service communication**: every service reaches every other
service by its docker-compose service name on the `kalki-net` bridge
network. The backend's `DATABASE_URL` is
`postgresql://kalki:kalki@postgres:5432/uniquebid` — never `localhost`.
The bet app's `REDIS_URL` is `redis://redis:6379`. The Next.js
rewrites for `/uploads/*` resolve to `http://backend:4000/uploads/*`.

**A note on the auctions / aviator apps**: the proxy does NOT path-
route these. Their Next.js i18n middleware rewrites every request to
`/{locale}/...`; once the locale prefix is added, the URL no longer
carries the app's path prefix and would fall through to `bet` on the
next request. In prod each app gets its own subdomain
(`kalki-auctions.cloud.podstack.ai`, `kalki-aviator.cloud.podstack.ai`).
Locally each app is reachable on its own host-mapped port: <http://localhost:3200>
for auctions, <http://localhost:3000> for aviator.

**Host port mappings** (override via `.env`):

| Service           | Container | Host (default) | What                                |
|-------------------|-----------|----------------|-------------------------------------|
| proxy (nginx)     | 80        | 8000           | Single-origin entrypoint            |
| backend (NestJS)  | 4000      | 4000           | REST + Socket.IO API                |
| bet (Next.js)     | 3100      | 3100           | Prediction-market app               |
| auctions (Next.js)| 3200      | 3200           | Auctions hub / SSO landing          |
| aviator (Next.js) | 3000      | 3000           | Crash game                          |
| admin (Vite)      | 5173      | 5173           | Operator SPA                        |
| postgres          | 5432      | 5432           | uniquebid + bet databases           |
| redis             | 6379      | 6379           | Pub/sub, locks, rate limits         |
| adminer           | 8080      | 8080           | Postgres web UI                     |
| redis-commander   | 8081      | 8081           | Redis web UI (admin/admin)          |
| mailpit (UI)      | 8025      | 8025           | Captured outbound mail              |
| mailpit (SMTP)    | 1025      | 1025           | SMTP endpoint for the bet app       |

---

## Files at a glance

```
docker-compose.yml          # dev stack (default)
docker-compose.prod.yml     # overlay for prod Dockerfiles
.env.example                # every knob, copy to .env
Makefile.dev                # one-shot commands (up/down/logs/shell/db)
scripts/dev.ps1             # PowerShell wrapper
scripts/dev.sh              # POSIX wrapper
docker/
  nginx/nginx.conf          # reverse proxy config
  postgres/init/            # runs on first postgres bootstrap
  secrets/                  # gitignored; drop Firebase JSON here
backend/Dockerfile          # PROD image (used by `up-prod`)
backend/Dockerfile.dev      # DEV image (default)
backend/.dockerignore
bet/Dockerfile, Dockerfile.dev, .dockerignore
auctions/Dockerfile, Dockerfile.dev, .dockerignore
aviator/Dockerfile, Dockerfile.dev, .dockerignore
admin/Dockerfile, Dockerfile.dev, .dockerignore
```

---

## Daily commands

Pick the wrapper you like — all three call the same `docker compose`
commands under the hood.

| What                         | make                                     | PowerShell                            | POSIX                                 |
|------------------------------|------------------------------------------|---------------------------------------|---------------------------------------|
| Start everything             | `make -f Makefile.dev up`                | `.\scripts\dev.ps1 up`                | `./scripts/dev.sh up`                 |
| Stop (keep volumes)          | `make -f Makefile.dev down`              | `.\scripts\dev.ps1 down`              | `./scripts/dev.sh down`               |
| Tail all logs                | `make -f Makefile.dev logs`              | `.\scripts\dev.ps1 logs`              | `./scripts/dev.sh logs`               |
| Tail one service             | `make ... log svc=backend`               | `.\scripts\dev.ps1 log backend`       | `./scripts/dev.sh log backend`        |
| Shell into a service         | `make ... shell svc=bet`                 | `.\scripts\dev.ps1 shell bet`         | `./scripts/dev.sh shell bet`          |
| psql against a DB            | `make ... psql db=bet`                   | `.\scripts\dev.ps1 psql bet`          | `./scripts/dev.sh psql bet`           |
| Apply migrations             | `make ... migrate`                       | `.\scripts\dev.ps1 migrate`           | `./scripts/dev.sh migrate`            |
| Seed both DBs                | `make ... seed`                          | `.\scripts\dev.ps1 seed`              | `./scripts/dev.sh seed`               |
| Drop + re-seed both DBs      | `make ... db-reset`                      | `.\scripts\dev.ps1 db-reset`          | `./scripts/dev.sh db-reset`           |
| Rebuild images               | `make ... rebuild`                       | `.\scripts\dev.ps1 rebuild`           | `./scripts/dev.sh rebuild`            |
| Drop ALL volumes (data loss) | `make ... clean`                         | `.\scripts\dev.ps1 clean`             | `./scripts/dev.sh clean`              |
| Boot prod-image stack        | `make ... up-prod`                       | `.\scripts\dev.ps1 up-prod`           | `./scripts/dev.sh up-prod`            |
| Boot WITH cron worker        | `make ... worker`                        | `.\scripts\dev.ps1 worker`            | `./scripts/dev.sh worker`             |

Run `make -f Makefile.dev help` (or `.\scripts\dev.ps1 help`) for the
full target list.

---

## Hot reload

Every dev container bind-mounts its source directory into `/app`, so
saving a file on the host triggers an immediate reload inside the
container:

- **backend** runs `nest start --watch` and recompiles on every save.
- **bet / auctions / aviator** run `next dev` with HMR.
- **admin** runs `vite` — HMR over the same connection nginx proxies
  to.

`CHOKIDAR_USEPOLLING=true` and `WATCHPACK_POLLING=true` are set in
every dev image so file events propagate through Docker Desktop's
filesystem bridge on Windows / macOS (inotify alone is unreliable
across that boundary).

### When hot reload is NOT enough

Hot reload covers source code. The following changes require a
container restart or rebuild:

| Change                                  | Action                                   |
|-----------------------------------------|------------------------------------------|
| `.env` value                            | `docker compose restart <svc>`           |
| `package.json` / lockfile               | `make -f Makefile.dev rebuild` then `up` |
| `prisma/schema.prisma`                  | `make -f Makefile.dev migrate-create name=...` |
| Dockerfile.dev                          | `docker compose build <svc>`             |

---

## First boot — what happens

1. `docker compose up -d --build` builds every Dockerfile.dev (~3-5 min
   on a clean machine, ~30s on subsequent runs from the build cache).
2. Postgres boots → `docker/postgres/init/01-create-bet-db.sh` creates
   the second `bet` database.
3. Redis boots with AOF persistence on.
4. Backend container starts → entrypoint runs
   `prisma generate && prisma migrate deploy && nest start --watch`.
   `/health` becomes reachable within ~30s.
5. Bet container starts → entrypoint runs
   `prisma generate && prisma migrate deploy && next dev`.
6. Auctions, aviator, admin start.
7. Proxy comes up last and starts serving traffic on
   `localhost:${PROXY_HTTP_PORT:-8000}`.

The first request to a Next.js dev server takes a few seconds while it
JIT-compiles the requested route — this is `next dev` behavior, not a
Docker issue.

---

## Seed data

Both apps ship Prisma seeds. The dev backend entrypoint runs
`migrate deploy` but NOT `seed` (we don't want to clobber data on
every restart). Run seeding explicitly:

```bash
make -f Makefile.dev seed
```

After seeding you can log in with:

| App     | Email                  | Password         | Role        |
|---------|------------------------|------------------|-------------|
| All     | `admin@kalki.local`    | `password12345`  | super-admin |
| All     | `user1@kalki.local`    | `password12345`  | user        |

---

## Production-like local stack

The same compose file accepts a production overlay that swaps every
service to its hardened Dockerfile, drops the bind mounts, and runs
the prod commands (`next start`, `node dist/...`):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
# or
make -f Makefile.dev up-prod
```

Useful for catching "works in dev, breaks in prod" issues before they
hit the cluster. Hot reload is OFF in this mode.

---

## Worker mode

The backend supports two roles:

- `KALKI_ROLE=api` (default) — HTTP + WebSocket + cron.
- `KALKI_ROLE=worker` — no HTTP listener; only cron jobs run.

The dev compose ships a `backend-worker` service guarded by the
`worker` profile. Disabled by default; enable with:

```bash
make -f Makefile.dev worker
# or
docker compose --profile worker up -d --build
```

Splitting workers off matches the prod cluster topology so chatty
cron jobs (notification drains, outbox dispatch, recon, fraud sweep)
don't compete with API request latency.

---

## Troubleshooting

### "Port already in use" on Windows

Common culprits on a default Windows install:

- **:80** — IIS, IIS Express, Hyper-V virtual switches. The compose
  default avoids :80 entirely by exposing the proxy on :8000.
- **:5432** — a host-side Postgres install. Stop it
  (`Stop-Service postgresql-x64-16`) or change `POSTGRES_PORT=5433`
  in `.env`.
- **:3000** — `npx create-next-app` defaults; close that other dev
  server, or change `AVIATOR_PORT` in `.env`.

Every port in `.env` is configurable — change the value and run
`docker compose up -d` to rebind without rebuilding.

### Backend says `Can't reach database server at postgres:5432`

The backend `depends_on: postgres: condition: service_healthy`, so
this only happens if Postgres failed its healthcheck. Inspect:

```bash
docker compose logs postgres
```

Usually it's a stale data volume after a major Postgres version bump.
Drop it: `docker compose down -v && docker compose up -d` (loses
data — `db-dump` first if you care).

### Prisma says `Error: connect ENOENT /var/run/postgresql/.s.PGSQL.5432`

Means the backend is trying to connect via Unix socket because
`DATABASE_URL` is missing. Check that `.env` exists and contains a
non-empty `DATABASE_URL` — or just delete `.env` and re-copy from
`.env.example`.

### Next.js says `Module not found: Can't resolve '@/...'`

The bind mount shadowed the container's installed node_modules.
Confirm the named volume is in play:

```bash
docker volume ls | grep node_modules
```

There should be `bet-node-modules`, `auctions-node-modules`, etc.
If not, rebuild:

```bash
make -f Makefile.dev rebuild && make -f Makefile.dev up
```

### "ETXTBSY" / "EBUSY" when saving files on Windows

Docker Desktop's filesystem bridge occasionally locks files mid-write
during HMR. Easiest fix: stop the affected service, save, restart.
Permanent fix: move the repo into the WSL2 filesystem (`\\wsl$\Ubuntu\...`)
where Docker Desktop has native filesystem performance — file events
propagate without polling and saves are atomic.

### Hot reload doesn't fire

1. Verify polling is on: `docker compose exec bet env | grep POLLING`
   should show `WATCHPACK_POLLING=true` and `CHOKIDAR_USEPOLLING=true`.
2. Confirm the bind mount: `docker compose exec bet ls /app/app | head`
   should match your host's `bet/app/` listing.
3. On Windows, paths inside WSL2 are dramatically faster than NTFS
   bind mounts. If polling fires but reloads take >5s, this is why.

### Reset everything

When state gets weird, the nuclear option:

```bash
make -f Makefile.dev clean        # drops every volume — DB, redis, uploads
make -f Makefile.dev rebuild      # rebuild every image from scratch
make -f Makefile.dev up
make -f Makefile.dev seed
```

About 5 minutes end-to-end on a clean Docker cache.

### Backend hot reload is slow

`nest start --watch` recompiles the full project tree on every save —
the first few saves after boot are slow because TypeScript's
incremental cache is cold. After the third or fourth save it settles
to ~1-2s per reload.

---

## Database operations

### Open a SQL prompt

```bash
make -f Makefile.dev psql db=uniquebid    # backend DB
make -f Makefile.dev psql db=bet          # bet DB
```

Or use Adminer at <http://localhost:8080>:

- System: PostgreSQL
- Server: `postgres`
- Username: `kalki` (or whatever `POSTGRES_USER` is)
- Password: `kalki`
- Database: `uniquebid` or `bet`

### Apply pending migrations

The backend and bet entrypoints both run `prisma migrate deploy` on
boot, so this only matters if you've edited a schema while the stack
is already running:

```bash
make -f Makefile.dev migrate
```

### Create a new migration

```bash
make -f Makefile.dev migrate-create svc=backend name=add_user_phone
# or for the bet app
make -f Makefile.dev migrate-create svc=bet name=add_market_banner
```

This runs `prisma migrate dev --name <name>` inside the container,
which:
1. Updates `schema.prisma` if needed
2. Generates the SQL diff
3. Writes a new migration folder under `prisma/migrations/`
4. Applies it to the dev DB
5. Regenerates the Prisma client

### Reset both databases

```bash
make -f Makefile.dev db-reset
```

Prompts for confirmation. Runs `prisma migrate reset --force` for
both backend and bet — drops the schema, re-runs every migration,
re-runs the seed.

### Dump both databases

```bash
make -f Makefile.dev db-dump
# → backups/uniquebid-20260527T210000Z.sql.gz
# → backups/bet-20260527T210000Z.sql.gz
```

The `backups/` directory is gitignored.

---

## Environment variables

`.env.example` is the canonical list. Every key has an inline comment
explaining what it does and what blank means. Copy `.env.example` to
`.env` and adjust — the compose file reads `.env` automatically.

Service-specific `.env` files (`backend/.env`, `bet/.env`, …) are
ignored at the compose level — every value flows in through compose's
`environment:` blocks, fed from the root `.env`. Centralising avoids
the "five-files-out-of-sync" problem.

**Secrets that MUST be rotated for production**:

- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `NEXTAUTH_SECRET`
- `INTERNAL_API_SECRET`
- `KYC_DOCUMENT_KEY` (defaults to `JWT_SECRET` if unset)

**Third-party integrations** (all optional; blank = mock mode):

- Razorpay: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- NOWPayments: `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`
- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Firebase Cloud Messaging: drop the service-account JSON at
  `docker/secrets/firebase.json` and set
  `FIREBASE_CREDENTIALS_PATH=/run/secrets/firebase.json` in `.env`
- Sentry: `SENTRY_DSN`

---

## Rebuilding from scratch

```bash
make -f Makefile.dev clean         # drop containers + volumes
docker builder prune -af           # purge buildx cache (optional, frees disk)
make -f Makefile.dev rebuild       # rebuild every image with --no-cache --pull
make -f Makefile.dev up
make -f Makefile.dev seed
```

Total: ~5 minutes on a warm internet connection, ~10 on cold.

---

## CI / GitHub Actions

The existing root `Makefile` (not `Makefile.dev`) and
`.github/workflows/build-and-push.yml` build + push the **production**
images to Docker Hub. Nothing in this dev setup interferes with that
pipeline:

- Prod CI uses each service's `Dockerfile` (not `Dockerfile.dev`).
- The dev compose files are not referenced by any workflow.

You can run the prod build locally any time with `make build-backend`,
`make build-bet`, etc. — see the existing `Makefile` header for the
full target list.

---

## Why these design choices

**Two Dockerfiles per service (`Dockerfile` + `Dockerfile.dev`)**: the
prod image is a multi-stage build that hardcodes the build at image
creation time. Hot reload needs the opposite — source bind-mounted at
runtime, devDependencies installed, watch mode running. Trying to do
both in one Dockerfile makes both worse.

**Named volumes for `node_modules`**: bind-mounting the host's
`./bet` over `/app` would also overwrite `/app/node_modules`. On
Windows, host `node_modules` are Linux-incompatible (different
binaries). The named volume preserves what `npm ci` produced inside
the container.

**Single Postgres with two databases**: matches the prod cluster
(both apps share one cluster) and means one fewer credential pair to
remember in Adminer.

**Single root `.env`**: each individual service still has its own
`.env.example` for documentation, but the active `.env` lives at the
repo root and feeds every container through compose's `environment:`
blocks. Avoids drift between five copies of the same key.

**Polling-based file watching**: Docker Desktop's filesystem bridge
on Windows / macOS doesn't propagate inotify events reliably. Polling
adds ~50ms overhead per file scan but is rock-solid.

**Nginx in dev too**: production runs behind nginx-ingress, so dev
should too. Catches relative-URL bugs early and lets the WebView
clients use one origin instead of remembering five ports.

**Mailpit instead of a real SMTP**: password-reset and email-
verification flows exercise the same code path as prod without
needing a Mailtrap / SendGrid account. View captured mail at
<http://localhost:8025>.

---

## What's NOT in scope

- **TLS termination**: dev runs HTTP only. Prod uses Let's Encrypt
  via nginx-ingress on the cluster — out of scope for local dev.
- **Multi-host orchestration**: this is a single-host stack. The
  prod cluster uses Helm; see `helm/` and `clusters/`.
- **Android app**: lives in `app/`, builds via Gradle, runs on a
  device or emulator. Not Docker-driven — see [README.md](README.md).
- **iOS app**: lives in `ios/`, builds via Xcode. Not Docker-driven.
