#!/usr/bin/env bash
# Isolated integration test; never points at the production Compose project or data.
set -euo pipefail
cd "$(dirname "$0")/.."
export COMPOSE_PROJECT_NAME="polymate-test-$$"
export RELEASE_SHA="${RELEASE_SHA:-ci}"
export POSTGRES_USER=polymate POSTGRES_DB=polymate
export POSTGRES_PASSWORD=container-test-only-123456789012345678
export AUTH_MODE=managed-proxy MANAGED_PROXY_ONLY=true
export APP_ORIGIN=https://07.hackathon.ethz.ch GOOGLE_ENABLED=false
export WEB_BIND_ADDRESS=127.0.0.1 WEB_PORT="${TEST_WEB_PORT:-18080}"
export SMOKE_ORIGIN="http://127.0.0.1:$WEB_PORT"
cleanup() { docker compose down --volumes --remove-orphans >/dev/null; }
trap cleanup EXIT
docker compose config --quiet
# Shared CI runner IPs hit anonymous registry rate limits; retry the base-image pull with backoff.
for attempt in 1 2 3 4 5; do
  docker compose pull --quiet db && break
  [ "$attempt" -eq 5 ] && exit 1
  sleep $((attempt * 10))
done
docker compose up -d --no-build --wait --wait-timeout 120 db web
docker compose --profile tools run --rm tooling node scripts/migrate.mjs
docker compose --profile tools run --rm tooling node scripts/migrate.mjs
for attempt in 1 2; do
  docker compose --profile tools run --rm -e MIGRATIONS_DIR=/app/tests/fixtures/migrations/valid tooling node scripts/migrate.mjs
done
if docker compose --profile tools run --rm -e MIGRATIONS_DIR=/app/tests/fixtures/migrations/changed tooling node scripts/migrate.mjs; then
  echo 'Changed applied migration was incorrectly accepted.' >&2
  exit 1
fi
if docker compose --profile tools run --rm -e MIGRATIONS_DIR=/app/tests/fixtures/migrations/invalid tooling node scripts/migrate.mjs; then
  echo 'Invalid migration was incorrectly accepted.' >&2
  exit 1
fi
docker compose --profile tools run --rm tooling node --input-type=module -e '
import pg from "pg";
const client = new pg.Client({connectionString: process.env.DATABASE_URL});
await client.connect();
try {
  const count = await client.query("select count(*)::int as count from polymate_migration_probe");
  const failed = await client.query("select to_regclass($1) as name", ["polymate_failed_migration_probe"]);
  if (count.rows[0].count !== 1 || failed.rows[0].name !== null) throw new Error("Migration repeatability or rollback failed.");
} finally { await client.end(); }
'
EXPECTED_RELEASE_SHA="$RELEASE_SHA" SMOKE_MANAGED_IDENTITY=true node scripts/smoke.mjs
node --input-type=module <<'NODE'
const base = process.env.SMOKE_ORIGIN;
const response = await fetch(`${base}/api/identity`, {
  headers: { 'X-User-Id': 'test-student@ethz.ch', 'X-User-Name': 'Test%20Student' },
});
if (!response.ok) throw new Error('Trusted-proxy identity was not resolved.');
const owner = await response.json();
if (owner.displayName !== 'Test Student' || !owner.userId || owner.externalId) {
  throw new Error('Unexpected identity response.');
}
const page = await fetch(`${base}/calendar`, { headers: { 'X-User-Id': 'test-student@ethz.ch' } });
if (!page.ok || !(await page.text()).includes('aria-label="Weekly calendar"')) throw new Error('Calendar shell failed.');
NODE
BACKUP_DIR="/tmp/$COMPOSE_PROJECT_NAME-backups" scripts/backup.sh
snapshot="$(find "/tmp/$COMPOSE_PROJECT_NAME-backups" -name database.dump -print -quit)"
scripts/restore-check.sh "$snapshot"
echo 'Container identity, health, migration repeatability, backup, and isolated restore checks passed.'
