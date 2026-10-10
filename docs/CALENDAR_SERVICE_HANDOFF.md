# Calendar service handoff — issue #8

Owner: Dogancem. Iteration: 1. Depends on Bartek's merged `getValidAccessToken(owner)`.

The shared `CalendarEvent` / `CalendarClient` contract, fake client, HTTP client and owner-bound Google Calendar service implement list/create/update/complete/delete on the primary calendar. Routes resolve identity on the server; mutations require the application origin and a matching CSRF token. Only events marked with PolyMate's private study-block kind and resolved owner can be changed. Personal commitments remain read-only.

## Consumers

Yildirim and Catalin import `@polymate/contracts/calendar`. `HttpCalendarClient` from `@polymate/contracts/http-client` supports the original `/api/calendar/events` contract. The integrated study workflow uses Catalin's flat `/api/calendar/study-blocks` contract, whose routes delegate to the same calendar service. Both sets of wire bodies are listed in `packages/contracts/README.md`. `CalendarStudyWorkflow` composes the view and dialog on `/calendar`; owner-scoped operation listing and reconciliation support recovery after reload. Live acceptance is still required.

## Write safety

Every action uses a UUID generated once for that intended action. The operation log stores the owner, complete intended request, expected ETag and outcome before sending Google a write. Reusing an ID for a different request is rejected. Creates derive a deterministic Google event ID from the operation ID. Update and completion store the operation ID in private extended properties so reconciliation confirms this specific write. Updates and deletion use `If-Match`; stale ETags fail even when values already match.

An uncertain network outcome remains `unknown` unless Google read-back proves it applied. A missing event or old values immediately after a timeout do not prove failure; the request may complete later. Retrying the exact operation performs reconciliation reads only. An operation left pending by a process crash also follows this rule. If read-back cannot confirm it, it stays unknown for review; automatic retry/recovery of unapplied uncertain operations is deliberately conservative.

PostgreSQL advisory locks serialize writes per owner across application instances. Log statements autocommit before Google is called and reuse the locked session. Contention returns an error before sending another mutation. Google offers no atomic availability-and-insert operation; external Google edits can still race with a create. Overlap checking includes opaque all-day events, expands recurrence, ignores transparent/declined events, and permits adjacent half-open intervals.

## Validation

`pnpm check` passes: typecheck, ESLint, 54 tests and a production Next.js build. Tests exercise the real route handlers against a stubbed Google transport and token provider, service ownership and ETags, changed operation payloads, concurrent availability checks, all-day commitments, lost replies, read-only reconciliation, pagination, malformed Google responses, and owner-scoped database queries/lock cleanup.

No connected dedicated Google account or local database is configured in this checkout. Live Google acceptance and container/database integration have not been run. Issue #8 must remain open until live evidence is recorded.

## Live acceptance remaining

1. Configure the existing OAuth/database deployment and connect a dedicated Google test account. Use its managed application identity; never supply an owner in request bodies.
2. Obtain `/api/calendar/csrf` and list a week through `/api/calendar/events?from=...&to=...`. Confirm existing personal commitments have `editable: false` and capture their ETags for protection checks.
3. Create a study block in a free slot using `{ operationId, block: { title, startAt, endAt } }`. Confirm its Google ID, private owner/kind/operation properties and `synced` response. Reload the week to prove read-back.
4. Move it with a new operation UUID and the returned ETag. Confirm the changed time directly in Google, then complete and delete it using fresh ETags and UUIDs. Replay each exact request to confirm no duplicate mutation.
5. Attempt personal-event update/complete/delete and a stale-ETag write. Expect rejected responses and unchanged personal events. Try a known busy interval, including an all-day opaque commitment; expect overlap rejection.
6. Record the tested commit, dedicated account identity without tokens, event IDs, timestamps and outcomes. Clean up only the dedicated PolyMate test blocks, and leave the issue open until this handoff is verified.

REST behavior was checked against Google's [events insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [ETag handling](https://developers.google.com/workspace/calendar/api/guides/version-resources), and [private extended properties](https://developers.google.com/workspace/calendar/api/guides/extended-properties) documentation.
