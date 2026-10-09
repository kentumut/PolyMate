# Working in parallel

Use short feature branches and small pull requests into `main`. `main` is the shared integration branch and the source of deployable commits. Kent's bootstrap is the first handoff; merge it before creating the application feature branches. Do not create five separate scaffolds.

## Five simultaneous workstreams

| Teammate | First branch | Owns | First handoff |
|---|---|---|---|
| Yildirim | `feat/yildirim-i1-calendar` | `apps/web/components/calendar/` | Weekly view, event selection, navigation; receives typed props. |
| Dogancem | `feat/dogancem-i1-calendar-service` | `packages/contracts/`, calendar services and event API routes | `CalendarClient`, schemas, fake adapter, then Google operations. |
| Kent | `chore/kent-i1-foundation`, then `chore/kent-i1-release` | Root tooling/lockfile, identity, CI, Compose/scripts, calendar page composition | This scaffold; later integrate everyone's exported components. |
| Bartek | `feat/bartek-i1-google-auth` | Database schema/repositories/migrations, OAuth routes/token provider | User persistence, encrypted connections, Google authorization. |
| Catalin | `feat/catalin-i1-study-flows` | `apps/web/components/study/`, connection/dialog workflows, acceptance fixtures | Create/edit/complete/delete dialogs and Google round-trip evidence. |

Names are ownership assignments, not GitHub usernames. Add collaborators privately using their actual accounts. Root dependency requests go to Kent; Bartek is the only migration generator. Agree new shared exports before consuming them. Everyone can edit their own package manifest, but Kent reconciles dependency versions and commits the shared lockfile.

## Each teammate starts here

After the bootstrap PR is merged:

```bash
git clone https://github.com/kentumut/viscon-26.git
cd viscon-26
git switch main
git pull --ff-only origin main
git switch -c feat/yildirim-i1-calendar # Substitute your branch from the table.
nvm install
nvm use
npm install --global pnpm@11.1.1
pnpm install --frozen-lockfile
pnpm dev
```

Use a separate clone per person, or a separate Git worktree per simultaneous local task. Multiple branches inside one shared working directory do not isolate files. For another local workstream:

```bash
git fetch origin
git worktree add ../polymate-calendar -b feat/yildirim-i1-calendar origin/main
```

The web app runs at http://127.0.0.1:3000/calendar with a fixed local identity. No database, Google key, LLM key, or worker is required to develop the shell or fixture-backed components. The production build always refuses development identity.

## Repeat every 30–60 minutes

1. Deliver one small handoff: contracts, a migration, an OAuth route, a view, or a form. Open a draft PR early so dependencies are visible.
2. Bring current `main` into your branch before requesting review. Merge published branches rather than rewriting their history:

   ```bash
   git fetch origin
   git merge origin/main
   pnpm install --frozen-lockfile
   pnpm check
   git push -u origin HEAD
   gh pr create --base main --fill
   ```

3. Pair reviews: Yildirim ↔ Catalin; Dogancem ↔ Bartek; Bartek reviews Kent's infrastructure. Kent handles root/configuration conflicts. The author and affected owner resolve conflicts together.
4. Merge independent PRs when both CI jobs, `checks` and `containers`, pass against current `main`. Use **squash merge** to retain one understandable commit per handoff. A stale branch must incorporate `main` and rerun CI before merging. Kent coordinates merges touching shared dependencies or contracts.
5. After each merge, everyone updates their own branch. At the iteration checkpoint, stop adding features and run Catalin's integrated acceptance journey together. Kent deploys the passing commit SHA.

```bash
# Kent: only after peer review, dependency checks, and green CI.
gh pr checks <number>
gh pr merge <number> --squash
git fetch origin
git switch main
git pull --ff-only origin main
```

Never force-push `main`, share a branch between unrelated tasks, or stage a teammate's unfinished files. Direct pushes to `main` are reserved for a coordinated emergency recovery; use PRs for normal work, including documentation and infrastructure.

## Merge order and checkpoints

| Checkpoint | Can proceed concurrently | Integrate in this order |
|---|---|---|
| First 20 minutes | Kent scaffold; Dogancem contracts; Bartek OAuth setup; Yildirim calendar skeleton; Catalin acceptance script | Kent bootstrap, then contracts and minimum data schema. |
| Next 30–60 minutes | View + forms use Dogancem's fake adapter; Bartek tokens + Dogancem service use agreed provider interface | Schema/contracts → token provider + service. View/forms may merge independently. |
| Every subsequent hour | Small PRs within the five ownership boundaries | Dependency PRs before consumers; then Kent's calendar page composition. |
| End of MVP iteration | All five fix integrated defects | Catalin verifies real Google create/move/complete/reload/delete and failure cases; Kent tags `v0.1-calendar`. |

Fixtures are development aids. Do not label the shell or fake adapter as the Google-connected MVP.

## GitHub settings

Configure a `main` branch rule after the bootstrap checks have appeared: require a PR, one peer approval, resolution of conversations, required `checks` and `containers` jobs, and up-to-date branches. Disable force pushes and deletion. Leave squash merge enabled. If the repository's GitHub plan cannot protect a private repository, follow these same rules manually; do not change visibility to work around it.

This change supplies CI and the review workflow; it does not silently enable server-side branch protection. The repository was unprotected when the scaffold was prepared. Kent should confirm the rule with the team so every collaborator has working access. The repository is currently private; make the separate submission visibility decision before Sunday's deadline.

## Current handoffs

See [Kent's handoff](docs/KENT_HANDOFF.md) for implemented infrastructure, exact exports, and remaining integration dependencies. [TEAM_SCHEDULE.md](TEAM_SCHEDULE.md) remains the five-person schedule for later iterations.
