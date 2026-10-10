#!/usr/bin/env bash
# Prints a content tag for the OpenClaw gateway image of a commit. The tag only
# changes when the gateway's build inputs change, so deploys that touch only the
# web app leave the running gateway in place instead of recreating it.
set -euo pipefail
commit="${1:?Usage: scripts/openclaw-image-tag.sh <commit>}"
hash="$(git rev-parse \
  "$commit:integrations/openclaw-agent-plugin" \
  "$commit:scripts/openclaw-config.mjs" \
  "$commit:scripts/openclaw-container.mjs" \
  "$commit:.dockerignore" | sha256sum | cut -c1-16)"
printf 'gw-%s\n' "$hash"
