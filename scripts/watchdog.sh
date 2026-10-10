#!/usr/bin/env bash
# Restarts PolyMate containers that Docker reports as unhealthy.
# `restart: unless-stopped` already covers crashes and reboots; this covers hangs,
# because Compose never restarts a container only for failing its healthcheck.
set -euo pipefail
cd "$(dirname "$0")/.."
project="${COMPOSE_PROJECT_NAME:-polymate}"
log() { printf '%s watchdog: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Deployments and rollbacks replace containers deliberately; leave them alone.
mkdir -p .release
if ! (exec 9>.release/deploy.lock; flock -n 9); then
  log 'deployment in progress; skipping'
  exit 0
fi

unhealthy="$(docker ps --filter "label=com.docker.compose.project=$project" --filter health=unhealthy --format '{{.Names}}')"
test -n "$unhealthy" || exit 0
status=0
for name in $unhealthy; do
  log "restarting unhealthy container $name"
  if docker restart --time 20 "$name" >/dev/null; then log "restarted $name"
  else log "failed to restart $name"; status=1; fi
done
exit "$status"
