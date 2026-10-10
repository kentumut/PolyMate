#!/usr/bin/env bash
# Builds a commit's release images from a throwaway worktree while CI is still
# running, so the later scripts/deploy.sh build is a cache hit. It never touches
# the live checkout, running containers, the database, or release records.
# Run from the deployment checkout root.
set -euo pipefail
test -f compose.yaml || { echo 'Run from the deployment checkout root.' >&2; exit 1; }
test -f .env || { echo 'Create .env from .env.example privately first.' >&2; exit 1; }
requested_sha="$(git rev-parse --verify "${1:?Usage: scripts/prebuild.sh <commit>}^{commit}")"
worktree="$(mktemp -d "${TMPDIR:-/tmp}/polymate-prebuild.XXXXXX")"
cleanup() {
  git worktree remove --force "$worktree" >/dev/null 2>&1 || rm -rf "$worktree"
  git worktree prune
}
trap cleanup EXIT
git worktree add --detach --quiet "$worktree" "$requested_sha"
export RELEASE_SHA="$requested_sha"
export OPENCLAW_IMAGE_TAG="$("$worktree/scripts/openclaw-image-tag.sh" "$requested_sha")"
compose=(docker compose --env-file "$PWD/.env" -f "$worktree/compose.yaml")
gateway_enabled="$(node --env-file=.env -e 'process.stdout.write(process.env.OPENCLAW_ENABLED || "false")')"
images=(web tooling)
if test "$gateway_enabled" = true; then
  compose+=(-f "$worktree/compose.openclaw.yaml")
  images+=(openclaw)
fi
"${compose[@]}" --profile tools build "${images[@]}"
echo "Prebuilt release images for $requested_sha."
