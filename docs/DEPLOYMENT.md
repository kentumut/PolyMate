# Team 07 deployment and recovery

Target: `https://07.hackathon.ethz.ch`; SSH: `viscon@07-direct.viscon-hackathon.ch`. This is a prepared runbook. The user will establish SSH trust/access; no VM deployment has been performed by this change.

## One-time VM setup

1. Establish SSH access privately and verify the host fingerprint with the organizer. Keep the portal's authenticated team/staff mode enabled. Confirm that its proxy strips/replaces identity headers, that direct public requests cannot reach the app, and that only the managed proxy can reach host port 8080. `MANAGED_PROXY_ONLY=true` records this verified boundary; it does not configure a firewall. Do not modify VIScon Admin rules.
2. Inspect Docker, Compose, Node 24, disk, RAM, existing port bindings, and the organizer template. Do not stop an unidentified process:

   ```bash
   node --version
   docker version
   docker compose version
   df -h
   free -h
   docker ps --format 'table {{.Names}}\t{{.Ports}}'
   ss -ltnp
   ```

3. Clone to the path used by the supplied backup service. For a private repository, configure your own GitHub SSH key or read-only deploy key; do not embed tokens in clone URLs:

   ```bash
   git clone git@github.com:kentumut/viscon-26.git ~/polymate
   cd ~/polymate
   npm install --global pnpm@11.1.1
   cp .env.example .env
   chmod 600 .env
   openssl rand -hex 32
   ```

   Put the generated database password in `.env` using a private editor. Leave `GOOGLE_ENABLED=false` for this infrastructure preview. Once Bartek's OAuth routes land, provide the Google client ID/secret, stable token-encryption key and OAuth-state secret in the formats that his implementation requires, set the exact callback `https://07.hackathon.ethz.ch/api/integrations/google/callback`, and enable Google. Add each test student's account to the Google OAuth test-user list as needed. Never put working credentials in GitHub, browser bundles, screenshots, or PR text.

4. Validate without printing secrets. Avoid bare `docker compose config`, which expands credentials:

   ```bash
   node --env-file=.env scripts/config-check.mjs
   docker compose config --quiet
   ```

5. Before taking over port 8080, build and test on a loopback-only temporary port:

   ```bash
   export RELEASE_SHA="$(git rev-parse HEAD)"
   docker compose build web
   docker compose --profile tools build tooling
   docker compose up -d --wait db
   docker compose --profile tools run --rm tooling node scripts/migrate.mjs
   WEB_BIND_ADDRESS=127.0.0.1 WEB_PORT=18080 docker compose up -d --wait web
   SMOKE_ORIGIN=http://127.0.0.1:18080 EXPECTED_RELEASE_SHA="$RELEASE_SHA" SMOKE_MANAGED_IDENTITY=true node scripts/smoke.mjs
   ```

   This verifies the foundation, not Google OAuth or network isolation. Inspect the template's Compose services in `~/template`; stop only the service/project confirmed to own port 8080 at the agreed handover. Do not delete its volumes/configuration. Then run the deployment command below, which restores the expected host binding `0.0.0.0:8080` unless explicitly overridden. Keep the app port private to the managed proxy.

## Deploy a reviewed commit

On the clean VM checkout:

```bash
cd ~/polymate
git fetch origin --tags
scripts/deploy.sh origin/main
```

The script resolves an exact SHA, locks deployments with `flock`, checks production configuration, builds SHA-tagged images, starts/checks the database, takes a private backup, applies ordered migrations, starts web detached, and checks readiness, release SHA, and rejection of requests missing proxy identity. It records the healthy SHA in `.release/current` and retains `.release/previous`. Build/migration failure leaves the existing web process running. A readiness/smoke failure attempts to restore the recorded previous web image. A first deployment has no previous PolyMate image to restore; inspect and retry or restore the organizer template manually.

Migrations must be additive and compatible with the previous release. The deployment script does not make a destructive migration safe. Keep `.env` and encryption keys stable; code rollback does not undo configuration changes. Do not prune current/previous images, or use volume deletion for recovery. `restart: unless-stopped` and detached Compose keep services running after SSH disconnects.

Browser checks at the managed HTTPS address are separate gates: organizer login, correct displayed identity, a second student's isolation, and actual Google round trips once those features are merged. Inspect `docker compose ps`, `docker compose logs --tail=100 web`, and the liveness/ready routes privately. Readiness currently checks PostgreSQL; it does not claim Google is connected.

## Manual rollback

```bash
scripts/rollback.sh
# Or supply an exact retained SHA whose web image is available:
scripts/rollback.sh <previous-sha>
```

Rollback uses retained images and the existing database. It runs the same readiness/release/identity smoke checks. Record the reason for rollback; reconcile uncertain calendar operations before retrying them when recovery records have been implemented.

## Backups and restore verification

```bash
scripts/backup.sh
scripts/restore-check.sh backups/<snapshot>/database.dump
```

Each private snapshot contains a PostgreSQL custom-format dump, running release/version metadata, and SHA-256 checksums. The three newest completed snapshots are retained. Incomplete snapshots and unrelated files are not pruned. Copy the newest backup off the VM privately before cutoff. The restore check verifies checksums, restores into a random temporary database, reports table count, and removes only that temporary database. It never replaces the live database. Token-encryption keys must be copied separately to a private team location.

For a persistent six-hour schedule on the VM (adjust the unit paths if the clone directory differs):

```bash
sudo install -m 644 ops/polymate-backup.service ops/polymate-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now polymate-backup.timer
systemctl list-timers polymate-backup.timer
```

The `viscon` user must already be able to use Docker and Node. Test `sudo systemctl start polymate-backup.service` and inspect its status. The first snapshot is also taken before every migration. This foundation has no file uploads; add their archive/checksums and isolated file-restore verification when that feature ships.

## CI and local container verification

With Node 24, pnpm, and a running Docker daemon:

```bash
pnpm install --frozen-lockfile
pnpm check
# These builds do not require runtime credentials:
docker build --target web -t polymate-web:ci .
docker build --target tooling -t polymate-tooling:ci .
pnpm test:containers
```

`test:containers` uses a unique test Compose project and loopback port 18080, verifies production identity and health, tests repeated/changed/failing migrations, and tests backup/restore. It deletes only that test project's containers and database volume. The same checks run in GitHub CI. Test backups are private temporary files under `/tmp`, not repository artifacts.

## Later release gates

Keep `web` and `db` as the first release. Add a worker profile only with Dogancem's planner and Bartek's durable action schema; then add queue initialization, single-poller replacement, heartbeat readiness, and worker-restart acceptance. Add private uploads and model-budget enforcement with their domain features. Their absence must not delay the Google calendar MVP or be presented as implemented functionality.

Sunday: freeze at 10:00 Zurich, deploy the known-good commit by 11:00, export backups/source and complete submission by 11:30. VM access ends at noon. Link the repository on the portal and resolve its currently private visibility before submission. Do not tag `v0.1-calendar` until Catalin's real Google acceptance journey passes.
