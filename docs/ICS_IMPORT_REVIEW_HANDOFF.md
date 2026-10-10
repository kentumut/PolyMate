# Catalin iteration 3 — initial independent import-review slice

**Historical handoff:** the fixture-only slice below has now been extended with real persistence and planner integration. See [ICS_IMPORT_PERSISTENCE_HANDOFF.md](ICS_IMPORT_PERSISTENCE_HANDOFF.md) for current behavior, APIs, migration and verification. The fixture review remains available in development sample mode; the normal Assignments view uses real confirmation.

## Student workflow

Calendar → Assignments → **Import calendar (review prototype)** opens a file-to-review flow. Choose Moodle or myStudies, upload an `.ics` file (up to 1,000,000 bytes), then **Preview file**. Parsing is real and works without Google, Moodle credentials or a database connection. It uses the existing server authentication and assignment-scoped Origin/CSRF checks.

Every event starts unselected. Select only events that are assignments, review their title and Zurich deadline, and enter a positive whole-minute effort estimate. All-day events require an explicit deadline time. Dates from a source are planning targets, not verified official deadlines. Lectures are not automatically turned into assignments or planner commitments.

**Confirm selection — fixture only** exercises an in-memory confirmation adapter. It never calls the assignment-save, calendar-write or planning APIs. The result is visibly labelled as a fixture; nothing appears in saved assignments or Google. Replacing the file preserves fixture records in this mounted component so another export can illustrate unchanged/changed identities. Reload discards everything. Hiding/showing the panel preserves the current draft.

Fixture outcomes: success, failure, source conflict, slow confirmation, and a lost reply after a simulated commit. Failure/conflict preserve selections and edits. An uncertain reply freezes the original request and file until **Retry same fixture request** recovers its receipt. No fresh request ID or changed selection is used for that retry. Controls and an immediate in-flight guard prevent duplicate submissions.

## Files and interfaces

- `packages/core/calendar/import.ts` (`@polymate/core/calendar/import`): `parseCalendarImport(raw, source, now?)`, `ImportPreview`, `ImportEvent`, `ImportSource`, limits and errors. No remote fetch, persistence or mutation.
- `POST /api/assignments/import/preview?source=moodle|mystudies`: raw `text/calendar` body, server identity, exact Origin and assignment CSRF. Unknown/duplicate query fields are rejected. Bounded streaming read; private/no-store response. Raw file contents are not stored or logged.
- `apps/web/components/study/calendar-import-client.ts`: file checks, assignment-field preparation/validation, preview HTTP client, fixture confirmation adapter.
- `apps/web/components/study/calendar-import-panel.tsx`: file selection, source, preview, selection, edit, confirmation and retry UI.
- `apps/web/components/study/progress-form.ts`: field-level validation for the existing progress controls.

Preview event identity: original `uid` plus original `recurrenceId` (null for a standalone event). The opaque row `key` hashes `[source, uid, recurrenceId]`. A standalone event retains its key when its time changes; a moved recurring exception retains its original recurrence identity. Editable title/deadline/effort are separate from source data.

`ImportConfirmation` is the proposed UI integration payload:

```ts
{
  requestId: string;
  source: 'moodle' | 'mystudies';
  selections: Array<{ event: ImportEvent; input: AssignmentInput }>;
}
```

This is a fixture contract, not an authoritative persistence API. Before connecting a backend, agree the authenticated owner + source-collection/site namespace, durable preview identity, server revalidation, request replay semantics and original source metadata with Kent. Never accept browser-selected ownership or trust an edited preview as authoritative. Matching titles are not identity. The existing manual-assignment create endpoint is not suitable for durable cross-import deduplication.

## Parsing boundaries

- Non-recurring entries retain their dates without the Moodle subscription's 60-day cutoff.
- Recurrence expands only from the preview clock through the following 365 Zurich calendar days; the UI shows this window. At most 1,000 source VEVENTs, 100 recurrence rules and 500 preview rows.
- Floating times explicitly mean Zurich and produce a warning. All-day dates are converted using Zurich rather than the server's timezone. Impossible calendar fields are skipped rather than normalized silently.
- UTC and IANA timezones are supported. Custom/non-IANA timezone definitions are rejected with an actionable message; file-level VTIMEZONE components are not imported.
- Nonexistent DST wall-clock times are skipped with a warning. Additional `RDATE` occurrence lists are not supported and are explicitly warned/skipped instead of silently dropping dates.
- Exact duplicate VEVENTs are counted and ignored. Conflicting entries with the same raw UID/recurrence identity exclude that UID, with a warning rather than silently selecting a revision.
- Cancelled events, invalid IDs/dates and unsupported high-frequency recurrence are skipped with warnings. Source description/title text is inert; credential-bearing URLs are redacted. No source URL is fetched.
- Preview does not infer deletion from absence on reimport or modify historical progress.

## Existing progress controls

Done/Partly done/Missed/Stuck still use the existing progress APIs. Required remaining-effort/difficulty fields now have inline errors, accessible descriptions and focus on invalid input. Main action controls are at least 44 pixels high. Done explicitly distinguishes session completion, whole-assignment completion and Moodle submission.

An open report captures its original assignment version, session revision and ETag. Changes block saving with a stale-draft message; input remains intact. Refreshing references requires an explicit **I reviewed the changes — refresh this draft** action. Unknown-report retry continues to use the progress client's original UUID and payload and cannot be refreshed or edited. This does not change sealed chat-card replay semantics.

## Verification and integration remaining

Meaningful tests cover parser identity/recurrence/duplicates/Zurich dates, bounded authenticated preview, required assignment input, fixture deduplication/recovery/concurrency and progress validation. Synthetic fixture files:

- `tests/fixtures/import-moodle.ics`
- `tests/fixtures/import-mystudies.ics`

Run `pnpm check` with Node 24. Browser verification remains paused; this handoff does not claim browser or live import acceptance.

Local verification on 10 October 2026: `pnpm check` passed typecheck, lint, **337 tests across 42 files**, and the production build. The parser suite also passed with `TZ=America/New_York` to check host-timezone independence. `git diff --check` passed. The pre-existing generated `next-env.d.ts` dev-path change was restored after the production build regenerated it.

Remaining teammate-dependent work: migration/repository for provenance and durable reimport, real confirmation adapter, lecture busy-interval integration, and missed/partial adaptive replanning with undo. No new dependencies, migrations or OpenClaw tool definitions are required by this slice.
