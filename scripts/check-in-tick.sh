#!/usr/bin/env bash
# Asks the web app to open the check-in chats that are due, for every student.
# The app also does this whenever a student loads their chats; this timer covers
# students whose app is closed, which a push channel such as Telegram depends on.
set -euo pipefail
cd "$(dirname "$0")/.."
setting() { test -f .env && sed -n "s/^$1=//p" .env | tail -n 1 || true; }
secret="${CHECK_IN_TICK_SECRET:-$(setting CHECK_IN_TICK_SECRET)}"
test -n "$secret" || { echo 'CHECK_IN_TICK_SECRET is not set; check-in timer skipped.' >&2; exit 0; }
port="${WEB_PORT:-$(setting WEB_PORT)}"
# The secret is passed on stdin so it never appears in the process list.
printf 'Authorization: Bearer %s\n' "$secret" | curl -fsS --max-time 60 -X POST -H @- "http://127.0.0.1:${port:-8080}/api/internal/check-ins/tick"
echo
