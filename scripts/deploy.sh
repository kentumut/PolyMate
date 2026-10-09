#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
requested_ref="${1:?Usage: scripts/deploy.sh <commit-or-tag>}"
test -f .env || { echo 'Create .env from .env.example privately first.' >&2; exit 1; }
test -z "$(git status --porcelain)" || { echo 'Deployment checkout must be clean.' >&2; exit 1; }
mkdir -p .release
exec 9>.release/deploy.lock
flock -n 9 || { echo 'Another deployment is active.' >&2; exit 1; }
requested_sha="$(git rev-parse --verify "${requested_ref}^{commit}")"
previous_sha="$(cat .release/current 2>/dev/null || true)"
if test -n "$previous_sha"; then
  git rev-parse --verify "${previous_sha}^{commit}" >/dev/null
  docker image inspect "polymate-web:$previous_sha" >/dev/null
fi
git switch --detach "$requested_sha"
export RELEASE_SHA="$requested_sha"
node --env-file=.env scripts/config-check.mjs
# Build before interrupting the existing release. Images are tagged by commit.
docker compose build web
docker compose --profile tools build tooling
docker compose up -d --wait db
scripts/backup.sh
docker compose --profile tools run --rm tooling node scripts/migrate.mjs
recover() {
  if test -z "$previous_sha"; then
    echo 'First deployment failed; no previous PolyMate image is recorded. Inspect privately before retrying.' >&2
    return 1
  fi
  echo 'Restoring the previously healthy application image; keeping the database.' >&2
  git switch --detach "$previous_sha"
  export RELEASE_SHA="$previous_sha"
  docker compose up -d --no-build --wait --wait-timeout 120 web
  EXPECTED_RELEASE_SHA="$previous_sha" SMOKE_MANAGED_IDENTITY=true node scripts/smoke.mjs
}
if test -n "$previous_sha" && test "$previous_sha" != "$requested_sha"; then
  printf '%s\n' "$previous_sha" > .release/previous
fi
if ! docker compose up -d --wait --wait-timeout 120 web; then
  recover
  exit 1
fi
if ! EXPECTED_RELEASE_SHA="$requested_sha" SMOKE_MANAGED_IDENTITY=true node scripts/smoke.mjs; then
  recover
  exit 1
fi
printf '%s\n' "$requested_sha" > .release/current
echo "Deployed $requested_sha. Verify the authenticated managed address before tagging an MVP."
