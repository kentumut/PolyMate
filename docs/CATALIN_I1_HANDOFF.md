# Catalin iteration 1 — study workflow handoff

**Issue:** [#11: study-block flow and live acceptance](https://github.com/kentumut/viscon-26/issues/11)

**Integration branch:** `feat/catalin-i1-calendar-integration`, based on merged `main` at `276fbd9`. The original workflow was merged in PR #12.

**Status:** the workflow is merged through PR #16 and deployed at `8e9bdcc`. On 10 October 2026, Catalin confirmed that all listed live Google acceptance checks pass on the managed site. This is Catalin's manual acceptance confirmation; issue #11 is ready for closure and Kent's first-release sign-off process.

## Components available to Kent

| File | Purpose |
|---|---|
| `apps/web/components/study/calendar-study-workflow.tsx` | Integrated Add/select/dialog/mutation/refresh flow, with shared sample state and durable operation recovery. |
| `apps/web/components/study/study-block-dialog.tsx` | Create, edit/move, Mark done, confirmed Delete, and read-only personal-event details. |
| `apps/web/components/study/study-block-form.ts` | Component-local types, Zurich validation/conversion, duration-preserving moves, and completion/deletion targets. |
| `apps/web/components/study/study-calendar-client.ts` | Browser callback adapter for the documented mutation routes, with operation IDs, CSRF injection, and uncertain-operation tracking. |
| `apps/web/components/study/study-block-preview.tsx` | Labelled in-memory fixture harness with selectable outcomes and callback inspection. |
| `apps/web/app/dev/study-block/page.tsx` | Development-only preview at `/dev/study-block`. |
| `tests/study-block-form.test.ts` | Form/time/permission tests. |
| `tests/study-calendar-client.test.ts` | Mocked HTTP adapter tests. |
| `tests/study-calendar-integration.test.ts` | Callback → real route → calendar service tests with stubbed Google transport, including reload/reconciliation. |
| `tests/e2e/study-dialog.browser.mjs` | Separate browser acceptance runner; Playwright adoption into workspace/CI requires Kent's dependency coordination. |

The calendar page reuses Bartek's merged `GoogleConnection` at `apps/web/components/connections/google-connection.tsx`. Page composition now renders `CalendarStudyWorkflow` in place of the standalone panel; the workflow shares its read client with `CalendarPanel` and refreshes it after confirmed mutations.

## Decided mutation wire contract

Catalin owns this interface decision. The routes, request/response shapes, headers, and callback interfaces documented here are the contract the backend must implement; no agreement or approval from Dogancem is required. Paths/methods follow IMPLEMENTATION_PLAN.md. Live writes require the backend implementation and integration to be completed and verified.

| Callback | Route | JSON body |
|---|---|---|
| `onCreate(input)` | `POST /api/calendar/study-blocks` | `title`, `startAt`, `endAt`, `timezone`, `operationId` |
| `onUpdate(id, input, etag)` | `PATCH /api/calendar/study-blocks/:id` | Editable values plus `expectedEtag`, `operationId` |
| `onComplete(id, etag)` | `POST /api/calendar/study-blocks/:id/complete` | `expectedEtag`, `operationId` |
| `onDelete(id, etag)` | `DELETE /api/calendar/study-blocks/:id` | `expectedEtag`, `operationId` |

All writes use same-origin credentials, `Content-Type: application/json`, and `x-csrf-token`. Inputs never contain an owner/student ID. Event IDs are URL-encoded as a single path segment.

Expected result: `{ operationId, status: 'pending' | 'synced' | 'failed' | 'unknown', event?, error? }`. Error responses may use the documented `{ error: { code?, message, recoverable? }, requestId? }` envelope. Explicit input/auth/conflict rejections can be reported as failed; ambiguous transport errors, malformed confirmations, mismatched operation IDs, and unconfirmed server errors remain unknown.

### Server interfaces now implemented

- `/api/calendar/study-blocks` routes translate the flat request into the shared service input and retain identity, same-origin/CSRF, ownership, interval, overlap, and ETag checks. The existing `/api/calendar/events` contract remains available for the shared read/client interfaces.
- `GET /api/calendar/csrf` supplies the calendar-scoped token. The default adapter uses it; the OAuth cookie is not reused for calendar writes.
- `GET /api/calendar/operations` returns only the authenticated student's pending/unknown statuses. The workflow checks this before enabling mutation controls after reload.
- `POST /api/calendar/operations/:id/reconcile` requires identity, same-origin/CSRF, and an existing owner-scoped record. It replays that stored request through the service's read-back path; it does not issue another Google write for pending/unknown operations.
- Definitively failed attempts are terminal in the service. Retry uses a new attempt ID. Pending/unknown attempts retain the original ID and must be reconciled before any new write. This corrects the earlier client-only retry assumption without weakening uncertain-write protections.

## Parent integration responsibilities

The page mounts one workflow per authenticated student/sample mode, keeping the client above the dialog:

```ts
const client = createStudyCalendarClient(); // Uses the implemented HTTP/CSRF/recovery providers.
```

The workflow supplies all four mutation callbacks and `onReconcile` to the dialog, refreshes the visible week after confirmation, and exposes Check change in the dialog and parent banner. In development sample mode, a single `FakeCalendarClient` supplies both list and mutation operations; no Google or database calls are made by the workflow.

- Do not recreate the client on each React render. Use a stable parent instance and discard it when the authenticated student changes.
- Before opening a new mutation flow, inspect `client.getBlockingOperation()`. Show/reconcile any pending or unknown operation first. The client blocks a second write while that operation is unresolved.
- Feed the result of `client.reconcile(id)` into the dialog's `operationResult` prop for the same ID. New attempts after a confirmed failure allocate a fresh operation ID; reconciliation of pending/unknown work retains the original ID.
- Refresh events only after confirmed success. Keep the selected event snapshot while displaying deletion success, or close after confirmed deletion; avoid switching the open dialog into create mode when the deleted event disappears from the list.
- Student-reported session completion stays separate from assignment completion. Mark done/Delete refer to saved values, not unsaved form edits.

## Verification recorded on 9 October 2026

- `pnpm check`: passed typecheck, lint, **47 tests**, and production build after adapter implementation.
- The duplicate ID shared by the dialog heading and Title input was fixed. The heading now has a distinct ID, restoring accessible input labelling.
- A Chromium fixture run in an America/New_York browser timezone passed **12 of 14 scenarios**: create/validation/duplicate-click protection, edit/move and ETag forwarding, custom-end/range/DST validation, completion despite unsaved edits, deletion cancellation/focus/draft preservation, confirmed deletion, failed update/complete/delete, uncertain/thrown deletion, and pending completion reconciliation.
- The remaining personal-event and mobile/keyboard scenarios could not run because the preview server stopped (`ERR_CONNECTION_REFUSED`). Browser verification was then paused at the user's request. The complete browser suite has not passed; no screenshot or live Google evidence is claimed.
- The separate test server on port 3001 was stopped after verification was paused. Playwright was installed only in temporary test tooling; root dependency/lockfile changes are not required by this handoff.

## Integration verification on 10 October 2026

- `pnpm check`: passed typecheck, lint, **108 tests**, and production build.
- Integration tests exercise create → move → complete → list/reload → delete through the actual route handlers and calendar service with Google transport stubbed.
- Tests cover default CSRF acquisition/expiry, flat-body ownership protection, stale ETags, personal-event protection, retry after a definite conflict, recovered uncertain inserts without duplicate writes, and cross-owner operation isolation.
- Shared sample-client tests prove view reads and dialog writes use the same state without HTTP. Database recovery tests verify owner predicates and unresolved-status filtering.
- Browser verification remains paused, and no live Google acceptance is claimed for this integration.

## Manual checks

1. Run `pnpm dev` and open `http://127.0.0.1:3000/calendar?calendar=sample`.
2. Add a named 50-minute block in a free slot of the displayed week; close the success dialog and verify it appears.
3. Select it, move it, mark it done, and confirm deletion. Verify each change appears in the same view. Personal events open read-only; conflicts are rejected. Sample state resets on reload and is disabled in production.
4. Use `/calendar` without the sample parameter for real Google actions. Database/migrations and OAuth credentials/test account must be configured. Failed operation-recovery reads disable writes until Retry check succeeds; pending/unknown changes expose Check change.
5. Run the managed-site live acceptance table below and record actual results before closing issue #11.

## Live acceptance — confirmed by Catalin on 10 October 2026

Catalin confirmed in the project conversation that the following checks all pass on `https://07.hackathon.ethz.ch/calendar` with real Google Calendar. The results below record that user-reported manual verification.

| Scenario | Expected result | Actual result / evidence |
|---|---|---|
| Connect Google | OAuth returns to managed site; connected state shown. | Passed — Catalin's manual confirmation |
| View commitments | Existing Google events visible in Zurich time. | Passed — Catalin's manual confirmation |
| Create | Same study block appears in PolyMate and Google. | Passed — Catalin's manual confirmation |
| Move | New time confirmed in Google; previous time replaced. | Passed — Catalin's manual confirmation |
| Mark done and reload | Session completion persists after reload. | Passed — Catalin's manual confirmation |
| Confirm Delete | Block disappears from Google and reloaded PolyMate. | Passed — Catalin's manual confirmation |
| Overlap | Honest rejection; no conflicting Google write. | Passed — Catalin's manual confirmation |
| Disconnected Google | Reconnect feedback; no false success. | Passed — Catalin's manual confirmation |
| Personal-event protection | Personal events cannot be edited, completed, or deleted; Google events remain unchanged. | Passed — Catalin's manual confirmation |

Kent can proceed with the first calendar release based on Catalin's manual sign-off. The separate automated browser suite remains paused; its historical partial run is not the evidence for this live acceptance. Catalin's next iteration-2 implementation is manual assignment/deadline/effort entry, study preferences, and Generate Plan / Apply Plan controls.
