#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
rollback_sha="${1:-$(cat .release/previous 2>/dev/null || true)}"
test -n "$rollback_sha" || { echo 'No previous release recorded. Supply a retained commit SHA.' >&2; exit 1; }
test -z "$(git status --porcelain)" || { echo 'Deployment checkout must be clean.' >&2; exit 1; }
mkdir -p .release
exec 9>.release/deploy.lock
flock -n 9 || { echo 'Another deployment is active.' >&2; exit 1; }
git rev-parse --verify "${rollback_sha}^{commit}" >/dev/null
docker image inspect "polymate-web:$rollback_sha" >/dev/null
git switch --detach "$rollback_sha"
export RELEASE_SHA="$rollback_sha"
docker compose up -d --no-build --wait --wait-timeout 120 web
EXPECTED_RELEASE_SHA="$rollback_sha" SMOKE_MANAGED_IDENTITY=true node scripts/smoke.mjs
printf '%s\n' "$rollback_sha" > .release/current
echo 'Rollback passed readiness. Database and named volumes were preserved.'
