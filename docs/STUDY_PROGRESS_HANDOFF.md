# Catalin — session progress and missed-session recovery

Branch: `feat/catalin-progress-recovery`, originally based on `08303e4` and updated with `main` at `c39aae9` (OpenClaw/Moodle integration and sidebar navigation).

## Student-facing behavior

The calendar and assignments now share a study workspace within the existing Calendar / Chat / Settings layout. Students can select an assignment when creating a PolyMate block, or link an existing owned block. A linked block offers **Done**, **Partly done**, **Missed it**, and **Stuck**. Chat-driven calendar reloads also refresh linked progress data.

- **Done:** saves the student's session report and attempts Google session completion. The whole assignment is completed only if the student explicitly checks that it is finished.
- **Partly done:** requires a positive remaining-effort estimate for the entire assignment. Elapsed calendar time is never automatically subtracted. Revised estimates may be larger than the original estimate.
- **Missed it:** preserves remaining work and offers a button to focus the existing date/time fields. Saving a new time moves the same block using its current ETag and calendar operation protections.
- **Stuck:** requires the question/topic that caused difficulty. Notes and optional revised effort estimates are saved for later agent/tutoring context.
- Assignment cards show current remaining effort, status, latest report, and last difficulty. Block details show report history with timestamps and session revision.
- Progress reports and Google write outcomes are separate: a saved report can coexist with failed or uncertain Google completion. The UI does not claim a confirmed calendar change until Google confirms it.
- Missing replies are represented by absence of a report. A calendar block ending does not create progress automatically. Assignment completion is not Moodle submission.

## Data and migration

Apply `packages/db/migrations/0003_study_progress.sql` with the existing additive migration runner:

```bash
pnpm db:migrate
```

The migration adds assignment/block links, creation-link intents, progress history, calendar-effect deduplication, and an owner-scoped activity feed. Composite foreign keys keep assignment/block/report ownership consistent. No existing Google events or assignments are recreated.

Reports use a UUID `clientRequestId` and optimistic assignment/session versions. Database transactions serialize progress per student. Replaying the same request returns the original receipt without applying remaining effort twice; changed payloads for an existing ID are rejected. A stale assignment/session version requires refresh and review.

Creation links are reserved before a Google write, and confirmed calendar outcomes finalize the link. Uncertain creates retain their durable intent; later calendar reconciliation or progress-state recovery completes missing local effects. Moves increment `sessionRevision`, preserving old reports without treating them as reports for the new time. Delete keeps assignment effort and historical reports while marking the link deleted. Confirmed calendar effects are deduplicated, and stale read-backs do not overwrite newer metadata.

Done reports commit before attempting Google completion. If the process stops between those steps, the state response returns the pending completion request. A retry recovers the same report and calendar operation rather than reducing effort twice or creating another block. Existing uncertain Google operations use the calendar service's read-only reconciliation behavior.

## HTTP interfaces

| Route | Purpose |
|---|---|
| `GET /api/study-progress` | Current student's assignments, links, reports, and pending Done completions |
| `GET /api/study-progress/csrf` | Progress-scoped CSRF token and HttpOnly cookie |
| `POST /api/study-progress/links` | Link an existing owned block to an owned assignment |
| `POST /api/study-progress/reports` | Record/replay a versioned student report; return `{ receipt }` |
| `POST /api/study-progress/reschedule` | Move the same linked block through the existing calendar service |
| `GET /api/study-progress/activity?after=0` | Up to 100 owner-scoped activity events and `nextCursor` |

All writes require authenticated server-resolved identity, same-origin requests, and `x-csrf-token` from the progress cookie. Progress APIs never accept student/owner IDs in request bodies. Personal events are rejected. Activity cursors are validated; private notes stay scoped to the authenticated owner.

Link input:

```ts
{ eventId, assignmentId, expectedAssignmentVersion, expectedEtag }
```

Progress input:

```ts
{
  clientRequestId, eventId, assignmentId,
  action: 'done' | 'partly_done' | 'missed' | 'stuck',
  expectedAssignmentVersion, expectedSessionRevision, expectedEtag,
  remainingMinutes?, assignmentFinished?, note?
}
```

Reschedule input:

```ts
{ eventId, operationId, expectedEtag, expectedSessionRevision, startAt, endAt }
```

Creating a study block accepts optional `assignmentId` plus `expectedAssignmentVersion` in the existing flat `/api/calendar/study-blocks` request. The shared calendar service still owns interval validation, fresh availability checks, ownership and ETags.

## Agent handoff for Dogancem

Interactive OpenClaw progress tools are now registered in the canonical contracts and plugin manifest. See [AI agent handoff](AI_AGENT_HANDOFF.md#interactive-local-progress) for confirmation-card semantics and deployment allowlists. `polymate_get_study_progress` reads local state; `polymate_link_study_session` and `polymate_report_study_progress` prepare sealed changes. Only the authenticated browser's `confirm_progress` action saves them. Whole-assignment completion requires a separate explicit checkbox. No new migration is needed: original report requests/receipts and pending Google completions use the existing durable store.

Linked agent moves now call the progress-aware rescheduling helper, and calendar reads synchronize linked revisions. Background progress tools/check-ins remain follow-up work.

The rescheduling helper returns the unchanged Google operation outcome plus `progressSync`. A secondary metadata failure sets `progressSync: 'pending'` instead of throwing away a confirmed move; existing calendar-ledger recovery retries the effect on the next state read. Agent report authorization is issued only by a session-specific progress read (`eventId`) after direct Google retrieval and metadata synchronization. General reads remain cached history; failed refreshes return no new-report token. Historical/pending report retries preserve their original IDs and versions.

Shared contracts are exported from `@polymate/contracts/study-progress`. Domain behavior is in `StudyProgressService` from `@polymate/core/progress`.

For an authenticated web tool turn, reuse `studyProgressServiceFor(owner)` and `rescheduleStudySessionFor(owner, args)` from `apps/web/lib/study-progress.ts`. The `owner` must be resolved by the backend, never selected by the model. Background execution must supply its own server-authenticated context.

Useful actions:

```ts
const progress = studyProgressServiceFor(authenticatedOwner);
await progress.state();
await progress.link(validatedLinkArguments);
await progress.record(validatedProgressArguments);
await rescheduleStudySessionFor(authenticatedOwner, validatedRescheduleArguments);
```

Tools can read difficulty notes and assignment remaining work from `state()`. For partial completion, use the student's remaining-effort estimate; do not halve the assignment just because the message says “half” without knowing what it refers to. Preserve the same report UUID on retries. A report's `calendarOperation` can be pending/failed/unknown even when its database progress is saved.

The activity feed emits `block_linked`, `progress_recorded`, `block_rescheduled`, `block_completed`, and `block_deleted`. Dogancem's OpenClaw automation should persist its consumer cursor and deduplicate by activity ID. A move/delete/completion must invalidate old session check-ins; a report for the current session revision can suppress a follow-up. This increment emits durable events but does not itself register, cancel, or deliver OpenClaw/Telegram jobs.

If an agent mutates blocks directly through CalendarService rather than the HTTP routes, call `observeStudyCalendarChange(ownerId, kind, eventId, result)` after a confirmed write. The protected progress rescheduling helper already does this. HTTP calendar routes also observe outcomes, and state recovery repairs missed effects from the durable calendar ledger.

## Manual testing

1. Run `pnpm dev` and open **http://127.0.0.1:3000/calendar?calendar=sample**.
2. Add an assignment with 150 minutes of estimated effort.
3. Create a block in a free slot and select that assignment in the dialog. Close after confirmed creation.
4. Reopen the block, select **Partly done**, enter `100` remaining minutes, and save. The assignment card updates without marking the session Done.
5. Close/reopen and select **Stuck**. Record `Question 2: induction proof`; inspect history and the assignment's difficulty note.
6. Record **Missed it**. Remaining effort stays 100. Choose **Move this session**, set a different date/time above, and Save. The same block moves; the old report remains in history and the new session revision has no report yet.
7. Try a conflicting time. The move is rejected; the assignment link and remaining effort stay intact.
8. Select **Done** without checking whole-assignment completion. Google/sample session completion is confirmed, but assignment effort remains unchanged unless explicitly reported.
9. To finish the assignment, submit Done with the whole-assignment checkbox checked. Remaining effort becomes zero and status becomes Completed; Moodle submission remains separate.
10. Open a personal commitment: no linking/progress mutation controls appear. Delete a linked study block: its historical reports and assignment remain.

Sample calendar, assignment, and progress clients share one in-memory workspace and reset on reload. For persistent/live checks, apply migrations and use `/calendar` without sample mode, then repeat the journey and verify history/links after reload. Connecting Google is necessary to verify ownership/current event state and complete/move blocks.

## Verification

- `pnpm check` passes typecheck, lint, **239 tests**, and production build after integrating the latest main.
- New tests cover explicit progress semantics, concurrent report deduplication, larger revised estimates, session revisions, stale versions/ETags, personal-event protection, authenticated API/CSRF, original-request retries, and restored pending completion.
- `tests/integration/study-progress.db.mjs` executes real repository SQL and all three migrations against a temporary PGlite database (embedded PostgreSQL 18). It passed link creation, duplicate-safe reports, transactional rollback, student isolation, missed/moved session revisions, activity deduplication, close/reopen persistence, crashed-Done recovery, explicit assignment completion, deletion/history preservation, and stale-read protection. Deployment targets PostgreSQL 17.
- To rerun this optional SQL check, install PGlite separately, set `PGLITE_MODULE` to its `dist/index.js` and `PGCRYPTO_MODULE` to `dist/contrib/pgcrypto.js`, then run `node --import tsx tests/integration/study-progress.db.mjs`. It uses and deletes only its own temporary database. No root dependency/lockfile change is required.
- Browser verification remains paused at the user's request. No new live Google or managed-site acceptance is claimed. The existing OpenClaw/Moodle integration is preserved. Registering progress tools and check-in jobs with that runtime, Telegram delivery, automatic replanning, and notification policy remain follow-up integration work. Moodle-created blocks can be linked to local assignments through the UI; automatic Moodle-to-local assignment association is not added here.

The feature is prepared for a focused progress/recovery PR. Live acceptance and deployment of this increment remain pending.
