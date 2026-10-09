# Calendar contracts — Dogancem

Shared, dependency-free calendar types and validators. Consumers import these instead of inventing their own event shapes (TEAM_SCHEDULE.md §4).

| Export | Contents |
|---|---|
| `@polymate/contracts/calendar` | `CalendarEvent`, `CalendarClient`, `OperationResult`, request bodies, and the validators used by both forms and API routes (`parseStudyBlockInput`, `validateStudyInterval`, `proposeStudyBlock`, …). |
| `@polymate/contracts/time` | Europe/Zurich helpers: `weekRange`, `shiftWeek`, `zonedParts`, `zonedTimeToInstant`, `zonedDateKey`. |
| `@polymate/contracts/http-client` | `HttpCalendarClient`, the real browser client for `/api/calendar`. |

A labelled in-memory `FakeCalendarClient` for local development lives in `@polymate/core/calendar/fake`. It is never release evidence.

## Rules the contract encodes

- Transport uses ISO instants; display and week boundaries use Europe/Zurich (Monday–Sunday).
- Personal Google events are `source: 'google-personal'`, `editable: false`. Only `source: 'polymate'` study blocks can be changed.
- Every mutation carries a client-generated `operationId` (UUID). Retrying with the same ID is safe; creates use a Google event ID derived from it.
- Update, complete and delete send the `etag` last seen; a stale etag returns `conflict` instead of overwriting.
- `status: 'synced'` only after Google confirmed the write. `unknown` means retry with the same `operationId` to reconcile.

## HTTP routes

| Route | Body | Result |
|---|---|---|
| `GET /api/calendar/events?from&to` | — | `{ range, events }` |
| `GET /api/calendar/csrf` | — | `{ csrfToken }`, sent back as `x-csrf-token` on writes |
| `POST /api/calendar/events` | `{ operationId, block }` | `OperationResult` |
| `PATCH /api/calendar/events/:id` | `{ operationId, expectedEtag, changes }` | `OperationResult` |
| `POST /api/calendar/events/:id/complete` | `{ operationId, expectedEtag }` | `OperationResult` |
| `DELETE /api/calendar/events/:id` | `{ operationId, expectedEtag }` | `OperationResult` |
