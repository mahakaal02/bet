#!/usr/bin/env bash
# POSIX wrapper for the Dockerized dev environment.
#
# Usage from any directory:
#   ./scripts/dev.sh up          # boot the stack
#   ./scripts/dev.sh logs        # tail all services
#   ./scripts/dev.sh shell bet   # /bin/sh inside the bet container
#   ./scripts/dev.sh db-reset    # drop + re-migrate + re-seed both DBs
#
# This script is a thin shim around `docker compose` so users without
# `make` get the same UX. Every command maps 1:1 to a target in
# Makefile.dev.

set -euo pipefail

# Anchor to the repo root regardless of CWD.
REPO_ROOT="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )/.." &> /dev/null && pwd )"
cd "$REPO_ROOT"

COMPOSE=(docker compose -f docker-compose.yml)
COMPOSE_PROD=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

ensure_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example — review and edit if needed."
  fi
}

show_endpoints() {
  # shellcheck disable=SC1091
  [ -f .env ] && set -a && . ./.env && set +a
  cat <<EOF

Stack is up. Open:
  http://localhost:${PROXY_HTTP_PORT:-8000}     (proxy — bet at /, auctions at /auctions/, aviator at /aviator/, admin at /admin/)
  http://localhost:${BACKEND_PORT:-4000}        (backend API direct)
  http://localhost:${BET_PORT:-3100}            (bet direct)
  http://localhost:${AUCTIONS_PORT:-3200}       (auctions direct)
  http://localhost:${AVIATOR_PORT:-3000}        (aviator direct)
  http://localhost:${ADMIN_PORT:-5173}          (admin direct)
  http://localhost:${ADMINER_PORT:-8080}        (Adminer — Postgres GUI)
  http://localhost:${REDIS_COMMANDER_PORT:-8081} (redis-commander, admin/admin)
  http://localhost:${MAILPIT_HTTP_PORT:-8025}   (Mailpit — captured outbound mail)
EOF
}

cmd="${1:-help}"; shift || true

case "$cmd" in
  help|--help|-h)
    cat <<'USAGE'
Kalki — Dockerized development (POSIX wrapper)

Usage: ./scripts/dev.sh <command> [args]

  up              Start the dev stack (build images if missing)
  up-prod         Start with the production Dockerfiles
  worker          Start the stack INCLUDING the cron-only worker
  down            Stop containers (named volumes preserved)
  stop            Pause containers
  start           Resume previously stopped containers
  restart         Restart all services
  clean           DESTRUCTIVE: stop + drop every volume
  build           Build all dev images
  rebuild         Force-rebuild from scratch (no cache)
  pull            Pull base images
  ps              Show container status
  ports           Show port mappings
  logs            Tail logs for ALL services
  log <svc>       Tail logs for ONE service
  shell <svc>     Open /bin/sh in a service
  psql [db]       Open psql against the chosen DB (default uniquebid)
  redis-cli       Open redis-cli
  migrate         Apply Prisma migrations on backend + bet
  seed            Run prisma:seed on backend + bet
  db-reset        DESTRUCTIVE: drop + re-migrate + re-seed both DBs
  db-dump         Dump both DBs to ./backups/
  test            Run backend + bet test suites
  lint            Lint the backend
  env             Ensure .env exists (copies from .env.example)
USAGE
    ;;

  env)      ensure_env ;;
  up)       ensure_env; "${COMPOSE[@]}" up -d --build; show_endpoints ;;
  up-prod)  ensure_env; "${COMPOSE_PROD[@]}" up -d --build ;;
  worker)   ensure_env; "${COMPOSE[@]}" --profile worker up -d --build ;;
  down)     "${COMPOSE[@]}" down ;;
  stop)     "${COMPOSE[@]}" stop ;;
  start)    "${COMPOSE[@]}" start ;;
  restart)  "${COMPOSE[@]}" restart ;;

  clean)
    read -r -p "About to remove ALL named volumes. Type 'yes' to continue: " ans
    [ "$ans" = "yes" ] || { echo "Aborted."; exit 1; }
    "${COMPOSE[@]}" down -v
    echo "Stack stopped, all volumes removed."
    ;;

  build)    "${COMPOSE[@]}" build ;;
  rebuild)  "${COMPOSE[@]}" build --no-cache --pull ;;
  pull)     "${COMPOSE[@]}" pull ;;
  ps)       "${COMPOSE[@]}" ps ;;
  ports)    "${COMPOSE[@]}" ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}' ;;
  logs)     "${COMPOSE[@]}" logs -f --tail=200 ;;

  log)
    svc="${1:-}"; [ -n "$svc" ] || { echo "Usage: $0 log <service>"; exit 1; }
    "${COMPOSE[@]}" logs -f --tail=200 "$svc"
    ;;

  shell)
    svc="${1:-}"; [ -n "$svc" ] || { echo "Usage: $0 shell <service>"; exit 1; }
    "${COMPOSE[@]}" exec "$svc" sh
    ;;

  psql)
    db="${1:-uniquebid}"
    pg_user="${POSTGRES_USER:-kalki}"
    "${COMPOSE[@]}" exec postgres psql -U "$pg_user" -d "$db"
    ;;

  redis-cli) "${COMPOSE[@]}" exec redis redis-cli ;;

  migrate)
    "${COMPOSE[@]}" exec backend npx prisma migrate deploy
    "${COMPOSE[@]}" exec bet     npx prisma migrate deploy
    ;;

  seed)
    "${COMPOSE[@]}" exec backend npm run prisma:seed
    "${COMPOSE[@]}" exec bet     npm run prisma:seed
    ;;

  db-reset)
    read -r -p "About to DROP the uniquebid and bet databases. Type 'yes' to continue: " ans
    [ "$ans" = "yes" ] || { echo "Aborted."; exit 1; }
    "${COMPOSE[@]}" exec backend npx prisma migrate reset --force --skip-generate
    "${COMPOSE[@]}" exec bet     npx prisma migrate reset --force --skip-generate
    echo "Both databases reset, re-migrated, and re-seeded."
    ;;

  db-dump)
    mkdir -p backups
    ts=$(date -u +%Y%m%dT%H%M%SZ)
    pg_user="${POSTGRES_USER:-kalki}"
    for db in uniquebid bet; do
      out="backups/$db-$ts.sql.gz"
      echo "Dumping $db → $out"
      "${COMPOSE[@]}" exec -T postgres pg_dump -U "$pg_user" -d "$db" | gzip > "$out"
    done
    ;;

  test)
    "${COMPOSE[@]}" exec backend npm test
    "${COMPOSE[@]}" exec bet     npm test
    ;;

  lint) "${COMPOSE[@]}" exec backend npm run lint ;;

  *)
    echo "Unknown command: $cmd. Run '$0 help' for usage." >&2
    exit 1
    ;;
esac
