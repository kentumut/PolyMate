# Study-block dialog — first-release interface

This document defines the first-release study-block dialog: its fields, inputs, actions, validation, and operation feedback. It follows the shared calendar contracts in [TEAM_SCHEDULE.md](TEAM_SCHEDULE.md#4-shared-interfaces-that-enable-parallel-work).

**Implementation status:** `apps/web/components/study/study-block-dialog.tsx` implements creation, edit/move, Mark done, confirmed Delete, and read-only details. `CalendarStudyWorkflow` integrates these modes into `/calendar` with the real service and a development-only sample option. Live Google acceptance remains to be performed. See its [handoff README](../apps/web/components/study/README.md) for current props and adapter responsibilities.

## 1. Dialog modes

| Mode | What the student sees | Available actions |
|---|---|---|
| Create | Empty form with a suggested 50-minute duration. | Create, Cancel |
| Edit PolyMate block | Prefilled form and current completion status. | Save, Mark done, Delete, Cancel |
| View personal event | Read-only title, date, start/end time, and timezone. | Close |

- An already completed PolyMate block does not offer Mark done again.
- Personal events cannot be edited, completed, or deleted through this dialog.
- Delete requires confirmation before the deletion is submitted.

## 2. Editable fields

| Field | Rule |
|---|---|
| Title | Required; trim surrounding spaces and reject an empty result. |
| Date | Required; interpreted as the start date in Europe/Zurich. |
| Start time | Required; interpreted in Europe/Zurich. |
| End time | Required; the resulting end timestamp must be later than the start timestamp. Show the end date explicitly if the block crosses midnight. |
| Timezone | Display Europe/Zurich; fixed for the first release. |

For a new block, suggest an end time 50 minutes after the student chooses a start time. Once the student edits the end time, preserve their choice rather than replacing it automatically. The student chooses the slot; this dialog does not select an available time automatically.

For an existing block, prefill its actual start/end times. Moving the start preserves its current elapsed duration until the student explicitly edits the end date/time. Keep the loaded event ID and ETag with the draft; routine refreshes do not advance that ETag without student review.

Date/time inputs display local Zurich time. Callback inputs use ISO timestamps representing the actual instants, with Europe/Zurich supplied as the timezone. Do not interpret browser-local time as Zurich time or use a fixed UTC offset; Zurich's offset changes with daylight saving. A nonexistent or ambiguous local time requires correction or explicit resolution before submission.

## 3. Component inputs and callbacks

Reuse the shared `CalendarEvent` and `OperationResult` contracts defined in [TEAM_SCHEDULE.md](TEAM_SCHEDULE.md#4-shared-interfaces-that-enable-parallel-work). The interface below describes the dialog boundary; the concrete shared-type import path will be established with the app scaffold.

```ts
type StudyBlockInput = {
  title: string;
  startAt: string; // ISO timestamp representing an instant
  endAt: string;   // ISO timestamp representing an instant
  timezone: "Europe/Zurich";
};

type StudyBlockDialogProps = {
  open: boolean;
  selectedEvent: CalendarEvent | null;
  initialStartAt?: string; // ISO timestamp; used only for creation
  onClose: () => void;

  onCreate: (input: StudyBlockInput) => Promise<OperationResult>;
  onUpdate: (
    eventId: string,
    input: StudyBlockInput,
    expectedEtag: string,
  ) => Promise<OperationResult>;
  onComplete: (
    eventId: string,
    expectedEtag: string,
  ) => Promise<OperationResult>;
  onDelete: (
    eventId: string,
    expectedEtag: string,
  ) => Promise<OperationResult>;
};
```

### Input behavior

- `open` is controlled by the parent. `onClose` requests that the parent close the dialog.
- `selectedEvent: null` selects creation mode. If `initialStartAt` is supplied, prefill its Zurich date/time and suggest an end 50 minutes later. Otherwise, leave the date/start time for the student to choose.
- An existing event supplies its current fields, completion status, ID, and ETag. Only events with `source: "polymate"` and `editable: true` offer mutation actions; all other events show read-only details.
- Initialize the form when opening the dialog or selecting a different event. Routine parent refreshes must not silently replace unsaved edits.

### Callback responsibilities

- Create and update callbacks receive the full editable form values, with whitespace-trimmed title and converted ISO timestamps.
- Update, complete, and delete callbacks receive the selected event's `id` and `etag`. The expected ETag lets the service detect changes made since the event was loaded. If the service reports stale event data, refresh it and ask the student to review before submitting again.
- The callback adapter manages `operationId`: pending/unknown operations retain their original ID for read-back reconciliation. Definitively failed attempts are terminal in the service, so an explicit retry after a confirmed failure allocates a new attempt ID. It must not create a new operation ID merely because a response was uncertain.
- Callbacks return the shared `OperationResult`, including `operationId`, `status` (`pending`, `synced`, `failed`, or `unknown`), and optional `event` or `error`. A resolved promise alone does not mean Google confirmed success.
- The parent/adapter owns calendar refresh and operation reconciliation. Confirmed changes must be reflected in the week view, and uncertain changes must be reconciled before a repeat write.
- No callback input includes a student/owner ID. Authenticated server-side context determines ownership.

## 4. Validation

Validate the form before calling create or update. Show each field error beside its input, associate the message with the input for accessibility, and focus the first invalid field after a rejected submission. Preserve entered values so the student can correct them.

| Dialog check | Student-facing message |
|---|---|
| Title is empty after trimming. | Enter a title for your study block. |
| Date is missing or invalid. | Choose a valid date. |
| Start time is missing or invalid. | Choose a valid start time. |
| End time is missing or invalid. | Choose a valid end time. |
| End instant is equal to or before start instant. | End time must be after start time. |
| A Zurich local time does not exist because of a daylight-saving change. | This time does not exist in Europe/Zurich. Choose another time. |
| A Zurich local time is ambiguous and has not been resolved. | This time occurs twice in Europe/Zurich. Choose which occurrence you mean or select another time. |

Mark done and Delete use the saved event, not unsaved form changes. Explain that distinction if the form has been edited. Only editable PolyMate events can call update, complete, or delete; an already completed event cannot call complete again. Existing-event mutations require the loaded ID and ETag.

The authenticated calendar service remains responsible for ownership checks, fresh conflict checks, stale ETag detection, and valid Google access. Client-side validation does not replace these checks.

- **Conflict:** keep the form open and ask the student to choose another slot.
- **Stale event:** refresh current event data and ask the student to review it before submitting again; do not silently overwrite their draft.
- **Disconnected or revoked access:** preserve the draft and explain that Google must be reconnected before saving.
- **Other service failure:** show an actionable, sanitized message without exposing raw upstream errors or credentials.

## 5. Operation feedback

Treat the callback's result status as authoritative. Resolving a promise, updating local state, or reaching the end of a calendar block is not proof of a successful Google change or completed studying.

| State | Visible feedback | Dialog behavior |
|---|---|---|
| Idle | No operation message. | Allow available actions. |
| Pending | Creating…, Saving…, Marking done…, or Deleting…, matching the action. | Disable mutation buttons and freeze editable inputs while the operation is outstanding. Prevent duplicate submissions. |
| Synced | Created / Updated / Marked done / Deleted in Google Calendar, matching the action. | Show confirmed success and let the parent refresh the week view. Only now may the successful flow close. |
| Failed | The service's safe error message and a useful next step. | Keep the dialog and entered values. Allow correction or retry when the failure is known to be safe to retry. |
| Unknown | We could not confirm whether Google saved this change. Refresh the calendar before trying again. | Keep the draft and operation identity; block repeat writes until the adapter reconciles the outstanding operation. Display the visible label Uncertain. |

Enter Pending immediately when invoking a mutation. If the callback returns `pending`, remain pending until the parent/adapter obtains a terminal or uncertain result. Once the local request returns, the dialog may close while the parent retains the operation and offers Check change. Closing must not discard tracking or imply that the request was cancelled.

If a callback throws after submission and cannot establish that no write occurred, treat the outcome as Uncertain rather than offering a blind retry. The adapter retains the operation ID and reconciles it using the existing service before permitting another write. Fake callbacks must be clearly labelled as development fixtures; their results must not claim live Google synchronization.

Announce operation feedback through an accessible live region. Do not rely on color alone to distinguish the states.

## 6. Deletion confirmation

Delete first opens an in-dialog confirmation showing the saved event's title and Zurich date/time:

> Delete “Attempt questions 1–2” from Google Calendar?

Provide **Cancel** and **Delete** buttons. Cancel returns to the form without calling `onDelete`. Only explicit confirmation calls `onDelete` with the saved event ID and ETag. Apply the same pending, synced, failed, and uncertain rules as other mutations; remove the event from the confirmed calendar view only after Google confirms deletion.

## 7. Acceptance checklist

### Dialog checks with labelled fixtures

- [ ] Creation opens with empty fields or the supplied initial start time, and suggests a 50-minute duration.
- [ ] Changing the suggested end time preserves the student's choice.
- [ ] Existing PolyMate blocks open with their current values and completion status.
- [ ] Completed blocks do not offer Mark done again.
- [ ] Personal and other non-editable events show read-only details and cannot invoke mutation callbacks.
- [ ] Blank titles, missing/invalid dates or times, and non-positive durations are rejected before submission.
- [ ] Zurich time converts to the correct ISO instants regardless of the browser's timezone; unresolved daylight-saving times are rejected.
- [ ] Create/update callbacks receive trimmed titles and valid start/end instants.
- [ ] Existing-event mutations receive the saved event ID and ETag.
- [ ] Pending operations prevent duplicate submissions; a returned pending result does not appear as success.
- [ ] Failed operations preserve entered values and show a useful next step.
- [ ] Unknown or ambiguous thrown outcomes show Uncertain and block repeat writes until reconciliation.
- [ ] Only synced results produce confirmed success; fixture mode remains clearly labelled.
- [ ] Routine calendar refreshes do not silently replace unsaved edits.
- [ ] Deletion requires confirmation, and cancelling it does not call `onDelete`.
- [ ] Validation and operation messages are accessible by keyboard and assistive technology.

### Live release journey

Run these checks on the deployed managed address with a dedicated Google test account and PolyMate-owned test blocks. Fixture checks alone do not satisfy release acceptance.

- [ ] Connect Google and see existing personal commitments in Zurich time.
- [ ] Create a study block and verify the same title/time in Google Calendar.
- [ ] Move the block and verify its new time in Google Calendar.
- [ ] Mark the block done, reload, and verify the completion state persists.
- [ ] Confirm deletion and verify the block disappears from Google Calendar and the reloaded app.
- [ ] Attempt an overlap and verify a clear rejection with no conflicting Google event created.
- [ ] Test disconnected/revoked Google access and verify a reconnect message rather than false success.
- [ ] Attempt a personal-event mutation and verify it is rejected and the event is unchanged in Google.
- [ ] Record passed scenarios, failures, and evidence for Kent's release decision.
