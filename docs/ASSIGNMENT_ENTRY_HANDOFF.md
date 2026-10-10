# Catalin iteration 2 — manual assignment entry

## Delivered increment

Branch: `feat/catalin-i2-assignment-entry`, based on `main` at `8e9bdcc`.

Students can add an assignment title, a complete deadline in Europe/Zurich, and an estimated number of study minutes. The calendar sidebar lists saved assignments with deadline, estimated/remaining effort, and status. This workflow is independent of Google connection status and does not schedule study blocks automatically.

The implementation includes the form, list, authenticated API, repositories, and an additive migration. Existing calendar actions use their existing services. Course selection, study preferences, and Generate Plan / Apply Plan are subsequent increments.

## Files and interfaces

| Area | Files |
|---|---|
| Shared contract | `packages/contracts/src/assignments.ts`, exported as `@polymate/contracts/assignments` |
| Persistence | `packages/db/src/assignments.ts`, exported as `@polymate/db/assignments` |
| Migration | `packages/db/migrations/0002_assignments.sql` |
| API | `apps/web/app/api/assignments/route.ts`, `apps/web/app/api/assignments/csrf/route.ts` |
| Validation / client | `apps/web/components/study/assignment-form.ts`, `assignment-client.ts` |
| UI | `apps/web/components/study/assignment-dialog.tsx`, `assignments-panel.tsx` |
| Page composition | `AssignmentsPanel` in the `/calendar` sidebar, keyed by authenticated owner and sample mode |

Input:

```ts
type AssignmentInput = {
  title: string;
  dueAt: string; // ISO instant; form inputs display Europe/Zurich
  estimatedMinutes: number; // positive whole minutes
};
```

`AssignmentDialog` receives `open`, `onClose`, `onCreateAssignment(input): Promise<Assignment>`, optional `initialInput`, and `fixtureMode`.

A saved assignment contains `id`, `title`, `dueAt`, `estimatedMinutes`, `remainingMinutes`, `status`, and `version`. Creation initializes remaining minutes to the estimate, status to `open`, and version to `1`. Session completion and assignment completion remain separate; the calendar's Mark done does not update these assignment records.

## API and storage

| Route | Request | Response |
|---|---|---|
| `GET /api/assignments` | Current authenticated session | `{ assignments: Assignment[] }`, sorted by deadline and ID |
| `GET /api/assignments/csrf` | Current authenticated session | `{ csrfToken }` and an HttpOnly assignment-scoped cookie |
| `POST /api/assignments` | JSON assignment input plus UUID `clientRequestId`; same-origin credentials and `x-csrf-token` | `{ assignment }`; 201 for creation, 200 for replay |

- Identity comes only from the existing server-side resolver. Caller-selected owner, status, progress, or version fields are rejected.
- The repository creates the managed user row when necessary, without requiring OAuth or calling Google.
- Unique `(owner_id, client_request_id)` handles concurrent/repeated saves. The original normalized input is retained for comparison; reusing the same ID with changed details returns 409.
- Replay returns the existing assignment and does not reset progress/version. No update/delete API is added in this increment.
- List and replay queries filter by the resolved owner. Private owner/request metadata is omitted from public assignment objects.
- Failed input/session checks preserve the form. An ambiguous network or post-save server response remains unconfirmed; retries keep the same request ID and values. The current-page client blocks a different save until that outstanding save is confirmed. Closing the dialog retains this retry state in the parent.
- Normal assignment records survive page and database restarts. Sample records are explicitly temporary. Client-side pending drafts are not a replacement for durable database records.
- The migration only adds the assignments table/index; it does not recreate Google events or change existing calendar/token tables.

## Manual testing without database or Google

1. Restart `pnpm dev` after installing the updated workspace manifests with `pnpm install --frozen-lockfile`.
2. Open **http://127.0.0.1:3000/calendar?calendar=sample**.
3. Click **Add assignment** in the sidebar.
4. Submit an empty form: errors appear and focus moves to the first invalid field.
5. Enter `Algorithms sheet 4`, a future deadline date/time, and `150` minutes. Save; confirm the list shows the assignment, `150 min remaining`, and Open.
6. Try zero, negative, fractional, or empty effort; a missing deadline time; and 29 March 2026 at 02:30 / 25 October 2026 at 02:30. Submission is rejected with useful messages.
7. Select **Failed save** in the sample outcome control, open the form, and submit valid values. Values remain after the error. Cancel, select Success, and try another assignment.
8. Select **Uncertain reply — retry confirms**. Save valid values; repeat saving through Retry save. Exactly one sample assignment should be confirmed. Closing an unconfirmed dialog leaves a Retry save banner and blocks Add assignment until confirmation.
9. Select **Slow save** and check that duplicate submission and cancellation are disabled while saving.
10. Reload: sample assignments reset, as labelled. The existing study-block sample workflow can still create/move/complete/delete blocks independently.

## Persistent local/managed testing

Use the existing PostgreSQL setup. For local development, the database can run through `docker compose -f compose.yaml -f compose.dev.yaml up -d db` with a privately supplied `POSTGRES_PASSWORD`. Set `DATABASE_URL` in the environment to the local database for both migrations and the web process; do not paste working credentials into Git or issue comments.

Apply additive migrations:

```bash
pnpm db:migrate
```

For local web development, use the development identity and localhost origin. `DATABASE_URL` must already be configured in the environment:

```bash
AUTH_MODE=development APP_ORIGIN=http://127.0.0.1:3000 GOOGLE_ENABLED=false pnpm dev
```

1. Open **http://127.0.0.1:3000/calendar** without the sample parameter.
2. Add a valid assignment. Verify it appears and survives a browser reload.
3. Confirm assignment entry works while Google is disconnected/disabled. Calendar integration may show a connection error; it does not disable assignment entry.
4. Verify a second managed student sees only their own assignments.
5. Run the existing calendar journey after Google is connected to check for regressions.

The existing deployment runner applies `0002_assignments.sql` before starting the new web image. Production keeps managed-proxy identity and does not enable sample mode.

## Verification recorded

- `pnpm check`: typecheck, lint, **141 tests**, and production build passed.
- Tests cover Zurich summer/winter/DST conversion, impossible dates, minute/title validation, initial assignment state, missing/invalid identity and CSRF, client-owner/progress rejection, list isolation, and sanitized errors.
- API/client tests with a stubbed repository cover create → fresh client/list reload and a lost post-commit reply retried without another record.
- Repository tests cover SQL owner predicates, atomic request deduplication, changed-payload conflicts, and preservation of later progress on replay.
- Actual migration and repository SQL were exercised using temporary PGlite tooling (embedded PostgreSQL 18.3). Both migrations applied; concurrent saves returned one record; different owners remained isolated; SQL constraints rejected invalid state; close/reopen preserved records and duplicate-safe replay. The project still targets PostgreSQL 17.
- Docker's local daemon was unavailable, so PostgreSQL 17 container checks were not run locally. The existing CI container job applies the new migration and exercises migration/backup/restore behavior.
- No root dependency or shared lockfile changes. Temporary database-check tooling is outside the repo.
- Browser verification remains paused; manual browser/managed-site acceptance of this new assignment increment has not been reported as passing.

## Next implementation

Study preferences, then Generate Plan / Apply Plan. The planner can consume the saved assignment IDs, deadlines, estimated/remaining minutes, status, and version. Course/source associations and assignment-linked study-block storage can be introduced through subsequent additive migrations.
