# Catalin iteration 3 — persistent calendar imports

## Implemented student journey

Calendar → Assignments → **Import calendar**:

1. Select an existing import collection for reimport, or name a new collection and choose Moodle/myStudies.
2. Upload an `.ics` file and **Preview file**. The parsed preview is stored for 30 minutes, but no assignments, commitments or Google events are created at this step.
3. Select events. Each row identifies **new**, **changed**, or **unchanged** source content. Choose an assignment with reviewed deadline/effort, or a read-only commitment using the source times. Existing imported records retain their original type.
4. **Confirm selected imports** atomically creates/updates the selected records and saves a replayable receipt. Saved assignments appear in the existing Assignments panel and are usable by planning and progress tools.
5. Reload: the server returns the stored preview and saved receipt. Unsaved field edits/selections are component-local and are not restored. **Reload saved import state** can recover an exact uncertain confirmation without replacing it with a newer preview.
6. **Review another export** keeps the current collection selected. Reimporting into the same collection recognizes original event identities instead of duplicating assignments. Choosing a new collection deliberately creates a separate source namespace.

File exports are snapshots. Absence/cancellation in a later export does not automatically delete saved work or commitments. Import never moves/completes/deletes Google events. Source dates remain student-reviewed planning targets, not verified official deadlines.

## Persistence and reimport rules

Migration `0005_calendar_imports.sql` adds collections, source entries, durable previews and confirmation receipts. It relies on the existing assignments/progress schema; no applied migration is modified.

Identity is authenticated owner + collection + original UID + recurrence identity. The parser's opaque key is scoped within that collection. Filenames and matching titles are not deduplication keys. Owner/collection/assignment relationships are enforced with composite foreign keys.

Confirmation accepts only server preview references plus reviewed assignment input; original source event data is retrieved from the stored preview, never accepted from the browser. Strict contracts reject owner fields, substituted source objects, unknown fields and duplicate selections. At most 500 events are reviewed per request.

An import transaction uses the existing study-progress owner lock and locks collection/assignment rows. A changed collection revision or selected assignment version rejects the confirmation. The whole batch rolls back on any conflict/validation/storage failure, including writes already performed for earlier rows.

Reimport can update reviewed title, deadline and estimated effort. It preserves remaining effort, open/completed/cancelled status, assignment ID, linked event IDs, session revisions, reports and notes. Only actual assignment metadata changes increment its version, so old progress drafts and planning snapshots cannot silently overwrite it. Changing the estimated effort does not change student-reported remaining effort. Closed assignments are never reopened by import.

Successful confirmations increment the collection revision, invalidating previews from an earlier revision. Missing events and unselected rows remain untouched. A cancelled/skipped source entry is not deletion authorization. Automatic deletion/commitment-removal UI is not included.

## Retry and recovery

The UI uses the server-generated preview UUID as its stable confirmation UUID. The canonical request and result are committed in the same transaction as assignments/source entries. Identical requests replay the original result after preview expiry or process restart. A different payload with the same request ID conflicts; another request ID cannot confirm an already consumed preview.

A lost/invalid response freezes the original UI payload. **Retry same import** replays it; **Reload saved import state** queries that exact preview and only unfreezes it when its matching receipt exists. If no receipt is yet visible, the original request stays frozen. Definitive failures preserve editable field values; stale previews require a fresh upload/review. Duplicate UI submissions are immediately blocked.

## APIs and files

- `POST /api/assignments/import/preview?source=moodle|mystudies&name=…` — create a collection and durable preview from bounded raw `text/calendar`.
- Alternatively `&collectionId=<UUID>` previews a reimport into an existing owner-scoped collection. Name and collection ID cannot be supplied together.
- `GET /api/assignments/import` — collections, latest preview and its saved result. Optional `collectionId` or `previewId` selects an owner-scoped snapshot.
- `POST /api/assignments/import/confirm` — `{ requestId, previewId, selections: [{ key, kind: 'assignment', input } | { key, kind: 'commitment' }] }`, with strict JSON validation and a 512 KB body limit.
- `packages/contracts/src/imports.ts`: wire types, parsers and errors.
- `packages/db/src/imports.ts`: preview, atomic confirmation, receipt recovery and imported busy-interval queries.
- `apps/web/components/study/persistent-import-panel.tsx`: real review/confirm/reimport/recovery UI.
- `apps/web/components/study/calendar-import-client.ts`: real HTTP confirmation and explicitly separate fixture adapter.

All reads are private/no-store. Writes require server-resolved identity, exact application Origin, and assignment-scoped CSRF. Raw ICS content is parsed into sanitized source snapshots; raw files are not stored/logged. No remote Moodle access or model is required. Real imports require Postgres.

Development `calendar=sample` retains the labelled fixture adapter and stateless parser path (`fixture=true`, rejected in production). It never writes real imported assignments. Parser limits and supported formats remain documented in the initial review handoff.

## Timetable planning integration

Read-only commitments have positive source durations and are stored separately from assignments. `listImportedCommitments(ownerId, range)` supplies them to `executePlanning` alongside fresh Google busy intervals. They do not count as study effort or reduce remaining minutes.

Generate avoids their times; apply rechecks exact proposed slots against current commitments. Import confirmation and manual planning share the existing per-owner database planning lock, preventing an import from changing busy intervals during a generate/apply request. These records are not editable Google events and are not copied to Google. The existing Moodle-chat timeline planner is not yet a consumer of this import store; this slice integrates the manual-assignment planner only.

## Verification and deployment

Run Node 24 with:

```sh
pnpm check
pnpm test:planner
```

The planner gate now includes the `calendar-imports.db.mjs` suite. It runs the actual SQL/repository code against temporary PGlite and verifies restart persistence, receipt replay, reimport deduplication, stale progress/collection rejection, closed-work preservation, injected post-write rollback, source namespaces, owner isolation, foreign-assignment constraints and lecture planning. API/client tests cover CSRF, strict inputs, bounded reads, development-only fixtures, lost replies, malformed successes and duplicate submissions.

`pnpm test:containers` additionally checks all four new tables after the standard migration runner applies every migration twice against PostgreSQL 17. Do not equate PGlite or mocked HTTP tests with live Google/browser acceptance. Browser verification remains paused.

Local verification on 10 October 2026: `pnpm check` passed typecheck, lint, **346 tests across 43 files**, and the production build. `pnpm test:planner` passed its focused tests and all three real-SQL PGlite suites (planning, progress and imports). `git diff --check` passed. Docker's daemon was unavailable, so the PostgreSQL 17 container gate was not run locally; no browser or live acceptance is claimed.

Before running real imports on a deployment, apply migrations with `pnpm db:migrate` using the deployment's normal backup/tooling process. No new dependencies, secrets, worker or OpenClaw tools are needed. Adaptive missed/partial-work replanning remains separate work.
