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

## Calendar overlay (Yildirim)

The week view now shows the planner's state alongside Google events. Each item answers one question: is this block in Google yet?

- **Proposed blocks** from the current preview have a dashed amber outline and a `Proposed` tag. They share lanes with real events, so overlaps with existing commitments stay visible. They are notes, not buttons, so they never open the study-block dialog. A banner above the grid says how many fall in the visible week and that they reach Google only after the plan is applied.
- **After apply**, Google-confirmed blocks drop out of the overlay, and the real solid-green study block takes their place after the calendar reload. A block whose apply is uncertain shows `Checking`. A failed block shows `Not added` in red. An expired preview that was never applied is hidden, because it can no longer be applied.
- **Assignment labels**: a study block linked to an assignment shows `↳ <assignment>` when its own title differs, and its accessible label always names the assignment.
- **Unscheduled work**: a collapsible strip lists open effort that no block covers. While a preview is current, this is the planner's shortfall with its reasons. Without one, it mirrors the planner's own rule: remaining effort minus linked, undeleted sessions that have no report for their current revision. Assignments past their deadline are left out.

Files: `apps/web/components/calendar/plan-overlay.ts` (pure derivations, tested in `tests/calendar-plan-overlay.test.ts`), with `week-view.tsx` / `week-layout.ts` (layout generalised to any timed item). `CalendarPanel` passes the new `proposed`, `assignmentLabels` and `unscheduled` props through to `WeekView`. `PlanningPanel` publishes its loaded or returned `PlanningState` into the study workspace (`planning`, `planningChanged`), and `CalendarStudyWorkflow` derives the overlay from that plus the progress state. The calendar keeps no planning state of its own, and the existing selection and edit contract is unchanged.

Sample mode has no planner, because planning needs Postgres. In development, review the overlay at **http://127.0.0.1:3000/dev/calendar-plan**, a labelled fixture that covers every block state, the banners, assignment labels, and the phone day view.

## OpenClaw and remaining scope

OpenClaw continues to run the model/tool loop and the existing Moodle tools. This manual flow works without an LLM or Moodle connection; Google and Postgres are required. It does not add another agent runtime or deploy a worker.

The manual planner service is **not yet exposed as an OpenClaw tool**. Chat continues to plan from Moodle entries using its existing timeline contract. The two paths share interval subtraction and Google writes, but still have distinct planning inputs and draft storage. Follow-up work should expose the general planning service through validated tools and agree how Moodle entries enter the assignment/progress model.

Further release work: live Google acceptance, and decisions about durable background jobs and subsequent automated-change consent. The current implementation performs only explicitly approved foreground writes. No background calendar writes or reminder delivery are enabled.

## Verification and release gate

Apply all migrations with `pnpm db:migrate` before deploying this branch. Migration 0004 depends on the existing assignment and progress migrations; no existing migration is changed.

Run `pnpm check`. Focused tests cover deterministic slots, deadline/capacity shortfalls, all-day/DST dates, cross-assignment breaks, preserving linked effort, authenticated approval, stale previews, and exact-operation retries.

Run `pnpm test:planner` for the planner gate. CI runs it as the separate `planner` job on every PR and main push. It runs the planner, planning-API and repository tests, then installs pinned PGlite into a temporary directory (it is not a root dependency) and runs the `study-planning` and `study-progress` SQL integration suites.

`pnpm test:containers` (CI job `containers`) applies every migration to real PostgreSQL 17 twice and asserts that the 0004 planner tables exist. It also runs the identity/health smoke and backup restore.

Release verification on 10 October 2026, on branch `chore/kent-i2-release`, used Node 24.21.0:

- `pnpm check` passed typecheck, lint, 298 tests and the production build.
- `pnpm test:planner` passed.
- `pnpm test:containers` passed against the locally built web/tooling images and PostgreSQL 17.

That check applies every migration to an isolated database and verifies transactions, owner constraints, preview persistence across restart, repair after confirmed writes, and progress deductions. It does not verify Google connectivity or production PostgreSQL concurrency.

Before calling iteration 2 complete, verify on the managed deployment: save a manual deadline → confirm availability → generate without calendar changes → inspect exact times → apply → verify the same blocks in Google → reload/restart → generate again without duplicating linked effort. Also exercise disconnected Google, a newly added conflict, changed remaining effort, insufficient capacity, and an uncertain write/retry. Manual calendar editing must still work throughout.

## Release and worker profile (Kent)

`v0.2-planner` deploys through the existing pipeline: once CI passes on main, `Deploy VM` runs `scripts/deploy.sh`. That script takes a backup, applies migration 0004 with the tooling image, and replaces the web container (restoring the previous image if health fails). No new secrets are required. The planner runs in the web process, and the OpenClaw gateway remains opt-in through `OPENCLAW_ENABLED=true` and `compose.openclaw.yaml`.

No separate worker container ships in v0.2. The iteration 2 planner performs only foreground writes that the student explicitly approves. Generate/apply are serialized by a database advisory lock, and retries reuse persisted operation IDs. This leaves no background job for a worker to run. Add a `worker` Compose profile when iteration 3/4 introduces durable jobs (automatic rescheduling, reminders, retry/reconciliation sweeps); it should reuse the tooling image's dependencies and the same `DATABASE_URL`.

Tag `v0.2-planner` on the deployed main SHA only after Catalin records the live acceptance journey above.
