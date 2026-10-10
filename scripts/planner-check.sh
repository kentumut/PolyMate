#!/usr/bin/env bash
# Iteration 2 planner gate: deterministic planner/API tests plus real-SQL
# migration, restart and progress checks. PGlite is installed into a temporary
# directory so it never becomes a root dependency or lockfile entry.
set -euo pipefail
cd "$(dirname "$0")/.."
PGLITE_VERSION="${PGLITE_VERSION:-0.5.8}"
pnpm exec vitest run tests/study-planner.test.ts tests/planning-api.test.ts tests/planning-repository.test.ts
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
npm install --prefix "$work" --ignore-scripts --no-audit --no-fund --silent "@electric-sql/pglite@$PGLITE_VERSION"
export PGLITE_MODULE="$work/node_modules/@electric-sql/pglite/dist/index.js"
export PGCRYPTO_MODULE="$work/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js"
for suite in study-planning study-progress; do
  pnpm exec tsx "tests/integration/$suite.db.mjs"
done
echo 'Planner, planning API, migration and SQL progress checks passed.'
