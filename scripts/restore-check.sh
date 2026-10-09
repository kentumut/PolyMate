#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
dump_path="${1:?Usage: scripts/restore-check.sh backups/snapshot/database.dump}"
test -s "$dump_path"
node scripts/backup-manifest.mjs verify "$(dirname "$dump_path")"
restore_db="polymate_restore_$(date +%s)_${RANDOM}"
cleanup() { docker compose exec -T -e RESTORE_DB="$restore_db" db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$RESTORE_DB"' >/dev/null; }
trap cleanup EXIT
docker compose exec -T -e RESTORE_DB="$restore_db" db sh -c 'createdb -U "$POSTGRES_USER" "$RESTORE_DB"'
docker compose exec -T -e RESTORE_DB="$restore_db" db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$RESTORE_DB" --no-owner --no-acl --exit-on-error' < "$dump_path"
docker compose exec -T -e RESTORE_DB="$restore_db" db sh -c 'psql -U "$POSTGRES_USER" -d "$RESTORE_DB" -v ON_ERROR_STOP=1 -c "select count(*) as restored_tables from information_schema.tables where table_schema = '\''public'\''"'
echo 'Restore check passed in a temporary database; production data was not overwritten.'
