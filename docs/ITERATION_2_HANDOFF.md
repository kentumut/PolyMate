# Iteration 2: manual assignment planning

The first implementation slice connects saved manual assignments to a deterministic seven-day planner, a reviewable preview, and explicitly approved Google study blocks. It is implemented on `codex/iteration-2-planner`; iteration 2 is not yet live-accepted.

## Student journey

On Calendar, expand **Assignments**, save a deadline and effort estimate, and choose study days, Zurich hours, and daily/seven-day capacity. The suggested defaults are weekdays 09:00–18:00, 180 minutes/day and 900 minutes over seven days. **Generate Plan** confirms and saves those preferences and creates a preview without writing to Google. **Apply Plan to Google Calendar** approves the stored times. A shortfall requires the separate **Add only the blocks that fit** choice.

The planner orders work by deadline, then remaining effort, and spreads larger assignments across permitted days when possible. It avoids busy Google commitments, preserves existing blocks, leaves ten-minute gaps between study blocks, and allocates up to fifty minutes per block. Google transparent/declined commitments do not block planning. Blocks need at least ten minutes; smaller effort remainders are reported rather than silently rounded up.

Existing linked sessions reserve their current duration against remaining effort. Sessions with a progress report for their current revision are excluded from that deduction, because the assignment's remaining effort already reflects the student's report. Unreported past sessions remain reserved: report missed/partial work before replanning it. Existing unlinked v0.1 blocks keep their Google IDs, times and completion; they count as busy study capacity, and can be linked through the existing progress flow.

## Implementation

- `packages/core/scheduling/planner.ts`: pure planning and exact-preview availability validation, with an explicit clock and supplied operation IDs.
- `packages/core/scheduling/allocator.ts`: free-interval subtraction shared with the existing Moodle planner.
- `apps/web/lib/planning.ts`: owner-bound generation/apply service, suitable for future agent-tool adapters.
- `POST /api/assignments/plan`: either `{ action: "generate", preferences }` or `{ action: "apply", planId, allowPartial }`. Identity, exact Origin, assignment CSRF, strict fields and a 16 KB body limit are required. Callers cannot submit their own blocks or owner.
- `GET /api/assignments/plan`: saved preferences, latest preview and authoritative operation outcomes. Responses are private and uncached.
- Migration `0004_study_planning.sql`: saved preferences, durable server-generated previews and operation/assignment links. Shared progress intents are committed with the draft; confirmed operations populate the existing progress links.

Generate/apply requests serialize per owner with a database advisory lock. Every new Google write uses the existing calendar service, which takes its calendar lock and refreshes conflicts before dispatch. Previews expire after thirty minutes. Changed assignments, existing linked events, new conflicts/capacity, and superseded unapproved previews invalidate new writes.

Approval and operation IDs persist before dispatch. A retry uses the same operation IDs; failed/uncertain operations stop the sequence. Expired or stale partially dispatched plans can check already attempted blocks without sending unattempted blocks. Confirmations survive the web process stopping before preview bookkeeping, because reads recover them from the calendar operation log. Progress bookkeeping repairs itself from confirmed operations and saved assignment intents.

## OpenClaw and remaining scope

OpenClaw continues to run the model/tool loop and the existing Moodle tools. This manual flow works without an LLM or Moodle connection; Google and Postgres are required. It does not add another agent runtime or deploy a worker.

The manual planner service is **not yet exposed as an OpenClaw tool**. Chat continues to plan from Moodle entries using its existing timeline contract. The two paths share interval subtraction and Google writes, but still have distinct planning inputs and draft storage. Follow-up work should expose the general planning service through validated tools and agree how Moodle entries enter the assignment/progress model.

Further release work: calendar overlay/assignment labels for previews, live Google acceptance, and decisions about durable background jobs and subsequent automated-change consent. The current implementation performs only explicitly approved foreground writes. No background calendar writes or reminder delivery are enabled.

## Verification and release gate

Apply all migrations with `pnpm db:migrate` before deploying this branch. Migration 0004 depends on the existing assignment and progress migrations; no existing migration is changed.

Run `pnpm check`. Focused tests cover deterministic slots, deadline/capacity shortfalls, all-day/DST dates, cross-assignment breaks, preserving linked effort, authenticated approval, stale previews, and exact-operation retries.

Local verification on 10 October 2026 passed typecheck, lint, 260 tests and the production build. The host used Node 22.17.0 and emitted the repository's Node 24 engine warning; rerun the normal Node 24 CI before merge. The optional SQL/restart check below also passed. Docker was unavailable locally, so production PostgreSQL/container verification remains a release check.

Optional SQL/restart verification uses a separately installed PGlite, following the existing progress integration-test convention:

```sh
PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js \
PGCRYPTO_MODULE=/absolute/path/to/pglite/dist/contrib/pgcrypto.js \
pnpm exec tsx tests/integration/study-planning.db.mjs
```

That check applies every migration to an isolated database and verifies transactions, owner constraints, preview persistence across restart, repair after confirmed writes, and progress deductions. It does not verify Google connectivity or production PostgreSQL concurrency.

Before calling iteration 2 complete, verify on the managed deployment: save a manual deadline → confirm availability → generate without calendar changes → inspect exact times → apply → verify the same blocks in Google → reload/restart → generate again without duplicating linked effort. Also exercise disconnected Google, a newly added conflict, changed remaining effort, insufficient capacity, and an uncertain write/retry. Manual calendar editing must still work throughout.
