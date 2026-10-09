# Kent's implementation handoff

The iteration 0 / independent iteration 1 infrastructure is implemented. Deployment is prepared for the user to run after SSH access is established. The calendar page is explicitly a preview; the interactive Google-connected MVP still requires the four feature handoffs below.

| Kent assignment | Result | Remaining external dependency |
|---|---|---|
| Shared scaffold and app shell | Next.js/React/TypeScript/Tailwind pnpm workspace; local preview; production standalone image. | Bootstrap PR review/merge before teammates branch. |
| Identity boundary | Server-only normalized managed identity; fixed development identity forbidden in production; same-origin mutation helper. | VM proxy/firewall verification by the user. |
| Compose / health / database | Web on host 8080, private PostgreSQL volume/network, limits, rotated logs, restart policy, liveness and database readiness. | User establishes SSH and runs prepared deployment. |
| Migration and recovery tooling | Locked/checksummed ordered SQL runner, SHA releases, backup/restore, automatic image recovery attempt, six-hour backup timer. | Bartek supplies additive schema migrations; user enables timer on VM. |
| CI and parallel merges | Typecheck/lint/tests/build plus isolated container/identity/migration/restore checks, PR template, ownership and merge instructions. | Peer review; configure GitHub branch rule as described in CONTRIBUTING. |
| Calendar composition / first live release | Shared page location and app imports are ready. | Yildirim's view, Catalin's forms, Dogancem's CalendarClient, Bartek's OAuth/token provider. Integrate these before claiming CAL-07 or tagging an MVP. |

## Stable handoff points

- Yildirim: put the calendar component under `apps/web/components/calendar/` and export a prop-driven view. Dogancem owns the event/client types. Avoid editing the calendar page composition while Kent integrates it.
- Catalin: put study dialogs and connection UX under `apps/web/components/study/`. Export create/update/complete/delete callbacks that consume Dogancem's contract. The placeholder currently has no working actions.
- Dogancem: create `packages/contracts/package.json` and schemas before consumers import them. Kent will add its manifest to Docker dependency-copy steps and reconcile the root lockfile. Use `resolveOwner` on every student API route and `assertSameOrigin` on browser writes; bind every operation to the resolved owner. Add the agreed CSRF protection rather than accepting user IDs from clients.
- Bartek: `@polymate/db` exports the pooled PostgreSQL connection and readiness helper. Add schema/repositories beneath this package and ordered `0001_name.sql` migrations in `packages/db/migrations/`. Do not run Drizzle and the provided runner independently against the same migrations: use Drizzle to generate SQL and this runner to apply it, or agree one replacement before rollout. The runner wraps each migration in a transaction; do not include nested transactions or non-transactional SQL.
- Bartek + Dogancem: `@polymate/core/identity` exports `resolveOwner(headers, env?) → { userId, externalId, displayName }`. The owner UUID is deterministic from the normalized proxy identity so the shell needs no user table. Persist that UUID as the user's primary key, or jointly update the resolver/repositories before storing real user data. Never introduce a second owner-ID mapping silently. Display names have no authorization role.

`GET /api/identity` returns only the opaque owner UUID and display name with `no-store`. `GET /api/health/live` reports the release SHA; `GET /api/health/ready` returns 503 when PostgreSQL is unavailable. Neither health route exposes credentials or student data. Configuration only requires enabled integrations.

## Kent's next integration sequence

1. Merge the scaffold after Bartek's review and green CI; everyone branches from the new `main`.
2. Merge Dogancem's shared contracts and Bartek's minimum user/OAuth schema. Coordinate dependencies and lockfile changes in one small PR.
3. Merge OAuth/token provider and Google calendar service; independently merge the view and dialogs once contracts are stable.
4. Replace the preview composition with real connection/query/mutation state. Run Catalin's create/move/complete/reload/delete journey against Google, including overlap, revoked connection, and rejected personal-event edits.
5. Deploy the reviewed SHA, verify managed identity/isolation, then tag `v0.1-calendar`. No LLM or worker dependency is added to this release.

## Later Kent work stays behind its feature gates

Iteration 2 worker/planner profile and CI checks need the planner and action tables. Iteration 3 recovery and worker restart tests need retry/reconciliation handlers. Iteration 4 queue/bot/provider/heartbeat wiring needs those worker modules. Iteration 5 private files and budget limits need upload and model services. The deployment/recovery base is ready to extend; these feature-dependent integrations are not completed or enabled by this scaffold. The five-person schedule in TEAM_SCHEDULE.md remains authoritative.
