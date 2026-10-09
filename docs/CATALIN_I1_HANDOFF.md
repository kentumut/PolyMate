# Catalin iteration 1 — study workflow handoff

**Issue:** [#11: study-block flow and live acceptance](https://github.com/kentumut/viscon-26/issues/11)

**Branch:** `feat/catalin-i1-study-workflow`, based on merged `main` at `ff428c4`.

**Status:** dialog and browser mutation adapter implemented locally. The API contract is decided by Catalin. Backend implementation, integration, and live Google acceptance are pending; issue #11 is not ready to close. This document records a handoff, not a deployed release or a passing live demo.

## Components available to Kent

| File | Purpose |
|---|---|
| `apps/web/components/study/study-block-dialog.tsx` | Create, edit/move, Mark done, confirmed Delete, and read-only personal-event details. |
| `apps/web/components/study/study-block-form.ts` | Component-local types, Zurich validation/conversion, duration-preserving moves, and completion/deletion targets. |
| `apps/web/components/study/study-calendar-client.ts` | Browser callback adapter for the documented mutation routes, with operation IDs, CSRF injection, and uncertain-operation tracking. |
| `apps/web/components/study/study-block-preview.tsx` | Labelled in-memory fixture harness with selectable outcomes and callback inspection. |
| `apps/web/app/dev/study-block/page.tsx` | Development-only preview at `/dev/study-block`. |
| `tests/study-block-form.test.ts` | Form/time/permission tests. |
| `tests/study-calendar-client.test.ts` | Mocked HTTP adapter tests. |
| `tests/e2e/study-dialog.browser.mjs` | Separate browser acceptance runner; Playwright adoption into workspace/CI requires Kent's dependency coordination. |

Use Bartek's merged `GoogleConnection` at `apps/web/components/connections/google-connection.tsx`. Its current location and wiring are part of merged main; there is no need to duplicate it. Kent owns production calendar-page composition.

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

### Required server handoffs

- Calendar mutation routes and shared event/operation types implementing the decided contract. Replace the local structural types with matching shared imports when available.
- Calendar-specific CSRF provider/endpoint. The adapter accepts `getCsrfToken`; it does not invent a token route or assume Bartek's OAuth CSRF cookie covers calendar writes (that cookie is scoped to `/api/integrations/google`).
- Server-side read/reconciliation for an operation ID. Inject it as `reconcileOperation`. No undocumented operation-status endpoint or automatic repeated write is assumed.
- Durable operation recovery/ownership/conflict checks in the service. The browser's map is in-memory; after a page reload, unresolved operation records must be recovered from the server before allowing new writes.

## Parent integration responsibilities

Create one client per student calendar session and keep it above the dialog, so closing/reopening does not discard unresolved operations:

```ts
const client = createStudyCalendarClient({
  getCsrfToken: getCalendarCsrfToken,
  reconcileOperation: reconcileCalendarOperation,
});
```

The two provider functions above are required integration interfaces whose implementations are still pending, not existing exports or decisions awaiting approval. Pass `client.onCreate`, `client.onUpdate`, `client.onComplete`, and `client.onDelete` to the dialog, wrapping confirmed results to refresh the week view.

- Do not recreate the client on each React render. Use a stable parent instance and discard it when the authenticated student changes.
- Before opening a new mutation flow, inspect `client.getBlockingOperation()`. Show/reconcile any pending or unknown operation first. The client blocks a second write while that operation is unresolved.
- Feed the result of `client.reconcile(id)` into the dialog's `operationResult` prop for the same ID. Known failed requests may be explicitly retried; unchanged failed callback submissions reuse their operation ID, while corrected form values allocate a new one.
- Refresh events only after confirmed success. Keep the selected event snapshot while displaying deletion success, or close after confirmed deletion; avoid switching the open dialog into create mode when the deleted event disappears from the list.
- Student-reported session completion stays separate from assignment completion. Mark done/Delete refer to saved values, not unsaved form edits.

## Verification recorded on 9 October 2026

- `pnpm check`: passed typecheck, lint, **47 tests**, and production build after adapter implementation.
- The duplicate ID shared by the dialog heading and Title input was fixed. The heading now has a distinct ID, restoring accessible input labelling.
- A Chromium fixture run in an America/New_York browser timezone passed **12 of 14 scenarios**: create/validation/duplicate-click protection, edit/move and ETag forwarding, custom-end/range/DST validation, completion despite unsaved edits, deletion cancellation/focus/draft preservation, confirmed deletion, failed update/complete/delete, uncertain/thrown deletion, and pending completion reconciliation.
- The remaining personal-event and mobile/keyboard scenarios could not run because the preview server stopped (`ERR_CONNECTION_REFUSED`). Browser verification was then paused at the user's request. The complete browser suite has not passed; no screenshot or live Google evidence is claimed.
- The separate test server on port 3001 was stopped after verification was paused. Playwright was installed only in temporary test tooling; root dependency/lockfile changes are not required by this handoff.

## Live acceptance still required

On the managed site with a designated real Google account, record each result and evidence:

| Scenario | Expected result | Actual result / evidence |
|---|---|---|
| Connect Google | OAuth returns to managed site; connected state shown. | Not run |
| View commitments | Existing Google events visible in Zurich time. | Not run |
| Create | Same study block appears in PolyMate and Google. | Not run |
| Move | New time confirmed in Google; previous time replaced. | Not run |
| Mark done and reload | Session completion persists after reload. | Not run |
| Confirm Delete | Block disappears from Google and reloaded PolyMate. | Not run |
| Overlap | Honest rejection; no conflicting Google write. | Not run |
| Disconnected/revoked Google | Reconnect feedback; no false success. | Not run |
| Forbidden personal-event edit | Mutation rejected; Google event unchanged. | Not run |

After integration, finish browser verification, run this live journey, record demo evidence, and link the reviewed PR plus remaining blockers in issue #11. The fixture run and mocked adapter tests do not meet the live release gate.
