# Study-block dialog handoff

See [Catalin's iteration-1 handoff](../../../../docs/CATALIN_I1_HANDOFF.md) for the decided HTTP contract, recorded verification, integration dependencies, and live acceptance checklist.

`StudyBlockDialog` from `./study-block-dialog` implements **create, edit/move, Mark done, and confirmed Delete**, with read-only details for personal/non-editable events. Pass `selectedEvent={null}` to create, or the loaded event to edit. It uses native modal-dialog focus handling and existing React/Tailwind dependencies.

The parent must be a Client Component to supply callback functions. Kent owns its integration into the calendar page. Example:

```tsx
<StudyBlockDialog
  open={open}
  selectedEvent={selectedEvent} // null for creation
  initialStartAt={selectedSlotStart}
  onClose={() => setOpen(false)}
  onCreate={createStudyBlock}
  onUpdate={updateStudyBlock}
  onComplete={completeStudyBlock}
  onDelete={deleteStudyBlock}
  operationResult={latestOperationResult}
  fixtureMode={false}
/>
```

- `onCreate` receives a trimmed title, ISO start/end instants, and `Europe/Zurich`. The adapter allocates and retains the operation ID and enforces server-side permissions/conflicts.
- `onUpdate(eventId, input, expectedEtag)` receives the full editable values and the ID/ETag snapshotted when the event was opened. Same-event refreshes do not overwrite a draft or silently advance its expected ETag. Switching event IDs or closing/reopening resets the form.
- `StudyBlockDialogEvent` and `StudyBlockOperationResult` are component-local boundaries matching the planned shared shapes. Replace them with Dogancem's shared imports when contracts are published. Existing-event mutations require `source: 'polymate'`, `editable: true`, a nonempty ETag, and the relevant callback; without `onUpdate`, the form fields are read-only. The service must also enforce ownership.
- `onComplete(eventId, expectedEtag)` uses only the saved event identity/version. Unsaved title/time edits are not validated or sent by Mark done; a visible note explains that they will not be saved. Pending/failed/uncertain completion is not treated as confirmed. Confirmed completion shows Done and hides Mark done; already completed events cannot invoke it. Session completion does not imply assignment completion.
- `onDelete(eventId, expectedEtag)` is called only from explicit confirmation. The confirmation shows the saved title and full Zurich date/time range, independent of unsaved edits. Cancel/Escape before submission returns to the draft without a callback and restores focus to Delete. Completed PolyMate blocks may also be deleted; personal events may not.
- Deletion uses the same pending/failed/unknown/synced rules. Pending blocks duplicate actions; failures keep the saved block and allow retry or cancellation; unknown outcomes require reconciliation. Only confirmed deletion removes the record from the calendar. Retain the selected event snapshot while showing deletion success, or close the dialog after confirmed deletion; do not switch it into create mode when refreshing the list.
- Editing preserves the saved duration when moving the start, until the student explicitly edits the end date/time. A saved 75-minute block is not reset to 50 minutes. Completion is shown and remains unchanged by edits.
- Pass `operationResult` updates for the same operation ID to resolve a returned pending/unknown result. Keep operation tracking above the dialog so closing it does not lose recovery state. A thrown callback blocks retries in this dialog; reconcile in the adapter before opening a fresh form.
- A successful result keeps a visible confirmation until Close. The parent refreshes the calendar after confirmed writes.
- Pass `fixtureMode` for fake callbacks; confirmations explicitly say no Google event was saved. Fake mode does not satisfy live acceptance.
- Ambiguous DST times currently ask for another time rather than offering an occurrence picker. Start/end dates are explicit to support blocks crossing midnight.
- Connection controls are also owned under this folder per Kent's handoff. Live calendar acceptance follows Kent's page composition and Google-service integration.

## Manual preview

Run `pnpm dev` and open **http://127.0.0.1:3000/dev/study-block**. The separate development route is a fixture harness for Catalin's workflow; Kent still owns production calendar composition. The route returns not found outside development.

Choose create, edit/move, or personal-event mode and a fake submission outcome, then click **Open study-block dialog**. Every callback waits 1.2 seconds so duplicate-click prevention can be inspected. The page displays callback count, the last request (including mutation ID/ETag), and the saved fixture block. Confirmed updates/completion change the in-memory block and its ETag; confirmed deletion removes it; failed/uncertain results leave it unchanged. Data does not survive reload. **Reset saved fixture** restores the original open block so completion/deletion scenarios can be repeated.

Manual scenarios:

1. Submit an empty title: an error appears, focus moves to the invalid input, and the callback count stays unchanged.
2. Set a date/start time: the end defaults to 50 minutes later. Edit the end time, then change the start: the custom end is preserved.
3. Set end equal to or before start: submission is rejected. Try a next-day end to check an overnight block.
4. Submit a valid title with **Success**: controls disable while pending, one callback runs, and the dialog confirms a fixture block with no Google write. Close and inspect the trimmed title and ISO timestamps.
5. Choose **Failed**: entered values remain, the simulated conflict appears, and another attempt is allowed.
6. Choose **Uncertain** or **Thrown error**: the dialog shows Uncertain and disables repeat submission. Close/reopen to reset this fake scenario; a real adapter must reconcile first.
7. Choose **Pending, then confirmed**: the returned pending result remains pending until the fixture supplies confirmation after another 2.5 seconds.
8. Use 29 March 2026 at 02:30 or 25 October 2026 at 02:30: nonexistent/ambiguous Zurich times are rejected.
9. Use Tab/Shift+Tab to check modal focus containment, Escape to cancel when idle, and verify focus returns to the opener. Escape and Cancel are blocked while pending.
10. Select **Edit/move**: the saved title, 09:00–10:15 Zurich range, and completion status appear. Move the start to 11:00: the suggested end becomes 12:15. Change the title and Save; the callback request must be `update`, with `eventId`, `expectedEtag`, and new ISO instants.
11. Close/reopen edit mode after success: saved values and the updated ETag are used. Repeat with Failed/Uncertain: requested changes must not replace the saved record.
12. Select **View a read-only personal event**: details are disabled, only Close is available, and the callback count does not increase.
13. In edit mode, click **Mark done** with Success selected: all mutations disable during Marking done, the callback request is `complete` with only event ID/ETag, and confirmation changes completion to Done. Close/reopen: Mark done is no longer offered.
14. Reset the fixture and try Failed, Uncertain, and Pending outcomes for Mark done. Completion stays Open until a confirmed result; a pending/uncertain action cannot be repeated. Failed completion preserves the draft and offers an actionable error.
15. Reset the fixture, edit the title (or make the time range invalid), and click Mark done: a note explains that unsaved edits will not be saved. Completion can still succeed, and the saved title/times remain unchanged.
16. In edit mode, change the title and click Delete: confirmation shows the saved title/time, not the draft. Cancel (or Escape) returns to the unchanged draft; callback count does not increase and focus returns to Delete.
17. Confirm Delete with Success: one `delete` request sends only the saved event ID/ETag; all actions disable while Deleting. Confirmation removes the saved fixture, shows success, and leaves only Close. Reopening edit mode is disabled until Reset saved fixture.
18. Reset the fixture and test Failed, Uncertain, Thrown error, and Pending deletion. The saved record remains until confirmation; unknown outcomes block repeat writes. A failed deletion can be cancelled or explicitly retried from the confirmation.
19. Mark a fixture done, close/reopen, and delete it: completed study blocks still offer Delete. Create mode and personal-event mode offer no deletion action.

Run `pnpm check` for the repository checks. The focused tests in `tests/study-block-form.test.ts` cover date validation, Zurich offsets/DST, overnight blocks, callback input conversion, saved-event prefilling, duration-preserving moves, and completion/deletion target/version/permission checks. The manual scenarios above are not automated browser tests or evidence of live Google acceptance.

## Browser callback adapter

`createStudyCalendarClient` from `./study-calendar-client` maps the dialog's four mutation callbacks to the decided `/api/calendar/study-blocks` contract. Instantiate it once in the parent, supply `getCsrfToken`, and inject a server-side `reconcileOperation` when available. The backend must implement this contract and provide the CSRF/reconciliation interfaces. The adapter is tested with mocked HTTP, not wired into the production calendar yet.

The client preserves IDs on retries of unchanged failed requests, blocks concurrent/unresolved writes, and treats ambiguous replies as unknown. `getBlockingOperation()` exposes outstanding work across dialog openings. `reconcile(id)` reads through the injected provider; `retryFailed(id)` explicitly repeats a known failed intent with its original ID. Recovery across page reloads belongs to the persistent server operation ledger and parent integration.

## Browser runner

With `pnpm dev` running and Playwright available, run:

```bash
node tests/e2e/study-dialog.browser.mjs
```

`PLAYWRIGHT_MODULE` may point to a separately installed Playwright `index.mjs` until Kent adds the workspace dependency. `PLAYWRIGHT_BROWSERS_PATH` selects that installation's browsers, `STUDY_PREVIEW_ORIGIN` overrides localhost:3000, and `STUDY_SCREENSHOT_DIR` optionally selects an existing screenshot directory. The runner uses fixtures and exits nonzero on failed scenarios. Browser verification is currently paused; see the handoff for actual results.
