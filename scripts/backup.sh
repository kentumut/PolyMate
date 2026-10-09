#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
backup_dir="${BACKUP_DIR:-backups}/$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}"
mkdir -p "$backup_dir"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl -Fc' > "$backup_dir/database.dump"
test -s "$backup_dir/database.dump"
if test -f .release/current; then cp .release/current "$backup_dir/release.txt"; else git rev-parse HEAD > "$backup_dir/release.txt"; fi
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select version()"' > "$backup_dir/database-version.txt"
printf '%s\n' 'Database snapshot only. Add private uploads when that feature ships. Encryption keys must be backed up separately.' > "$backup_dir/README.txt"
node scripts/backup-manifest.mjs write "$backup_dir"
touch "$backup_dir/.complete"
# Retain only completed snapshots created by this script; leave other files alone.
BACKUP_ROOT="${BACKUP_DIR:-backups}" node --input-type=module <<'NODE'
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
const root = process.env.BACKUP_ROOT;
const entries = await readdir(root, { withFileTypes: true });
const candidates = [];
for (const entry of entries) {
  if (entry.isDirectory() && /^\d{8}T\d{6}Z-\d+$/.test(entry.name)) {
    if ((await readdir(join(root, entry.name))).includes('.complete')) candidates.push(entry.name);
  }
}
for (const old of candidates.sort().reverse().slice(3)) await rm(join(root, old), { recursive: true });
NODE
echo "Backup created at $backup_dir. Copy it off the VM privately."
