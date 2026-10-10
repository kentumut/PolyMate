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
compose=(docker compose)
gateway_enabled="$(node --env-file=.env -e 'process.stdout.write(process.env.OPENCLAW_ENABLED || "false")')"
if test "$gateway_enabled" = true; then
  compose+=(-f compose.yaml -f compose.openclaw.yaml)
fi
# The gateway image is tagged by its build inputs, not the commit, so an
# unchanged gateway keeps running. Releases from before content tags used the SHA.
export OPENCLAW_IMAGE_TAG="$(scripts/openclaw-image-tag.sh "$requested_sha")"
previous_openclaw_tag=''
if test -n "$previous_sha" && test "$gateway_enabled" = true; then
  for tag in "$(scripts/openclaw-image-tag.sh "$previous_sha" 2>/dev/null || true)" "$previous_sha"; do
    if docker image inspect "polymate-openclaw:$tag" >/dev/null 2>&1; then
      previous_openclaw_tag="$tag"
      break
    fi
  done
fi
# Build before interrupting the existing release. Web and tooling images are tagged by commit;
# one build call lets Compose build them in parallel.
images=(web tooling)
if test "$gateway_enabled" = true; then images+=(openclaw); fi
"${compose[@]}" --profile tools build "${images[@]}"
"${compose[@]}" up -d --wait db
scripts/backup.sh
"${compose[@]}" --profile tools run --rm tooling node scripts/migrate.mjs
recover() {
  if test -z "$previous_sha"; then
    echo 'First deployment failed; no previous PolyMate image is recorded. Inspect privately before retrying.' >&2
    return 1
  fi
  echo 'Restoring the previously healthy application image; keeping the database.' >&2
  git switch --detach "$previous_sha"
  export RELEASE_SHA="$previous_sha"
  if test "$gateway_enabled" = true && test -n "$previous_openclaw_tag"; then
    export OPENCLAW_IMAGE_TAG="$previous_openclaw_tag"
    "${compose[@]}" up -d --no-build --wait --wait-timeout 180 web openclaw
  else
    # The first gateway-enabled release has no previous gateway image. Restore
    # the previous web image independently; leave gateway state intact.
    docker compose up -d --no-build --wait --wait-timeout 120 web
  fi
  EXPECTED_RELEASE_SHA="$previous_sha" SMOKE_MANAGED_IDENTITY=true node scripts/smoke.mjs
}
if test -n "$previous_sha" && test "$previous_sha" != "$requested_sha"; then
  printf '%s\n' "$previous_sha" > .release/previous
fi
services=(web)
if test "$gateway_enabled" = true; then services+=(openclaw); fi
if ! "${compose[@]}" up -d --wait --wait-timeout 180 "${services[@]}"; then
  recover
  exit 1
fi
if ! EXPECTED_RELEASE_SHA="$requested_sha" SMOKE_MANAGED_IDENTITY=true node scripts/smoke.mjs; then
  recover
  exit 1
fi
printf '%s\n' "$requested_sha" > .release/current
echo "Deployed $requested_sha. Verify the authenticated managed address before tagging an MVP."
