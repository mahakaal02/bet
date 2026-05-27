#!/usr/bin/env bash
# Postgres init script — runs ONCE on first cluster bootstrap (when
# /var/lib/postgresql/data is empty). Subsequent container restarts
# skip this entirely because the cluster already exists.
#
# The backend (uniquebid) database is created automatically by the
# official postgres entrypoint from $POSTGRES_DB. The bet app needs a
# SECOND database on the same cluster so the schemas don't collide,
# created here.
#
# Idempotent: every CREATE is guarded by a SELECT-from-pg_database
# existence check so re-running this against an existing cluster
# (e.g. after manually re-mounting an init dir) is a no-op.
set -euo pipefail

create_db_if_missing() {
  local db="$1"
  local owner="${2:-$POSTGRES_USER}"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "postgres" <<-SQL
    SELECT 'CREATE DATABASE "$db" OWNER "$owner"'
    WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '$db')\gexec
SQL
}

# bet — prediction-market app's schema. Same superuser as the backend
# DB so dev tooling (Adminer, psql) only needs one credential pair.
create_db_if_missing "bet"

echo "[postgres-init] additional databases ensured: bet"
