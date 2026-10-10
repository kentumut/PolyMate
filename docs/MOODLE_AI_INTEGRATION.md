# Moodle calendar subscriptions and study planning

The primary Moodle connection is a read-only iCalendar subscription. Students do not need a Moodle web-service token. Calendar export must be enabled by their Moodle administrator.

## Connect

On Moodle, open Calendar → Export calendar. Choose events related to your courses and “Recent and next 60 days”, then “Get calendar URL”. Paste that private URL into the Moodle calendar subscription card on `/calendar`. PolyMate fetches and validates the feed before saving the connection. The preview works without Google Calendar or an AI provider.

Set `MOODLE_SITE_URL` to the administrator-approved HTTPS Moodle base URL (default `https://moodle-app2.let.ethz.ch`) and `TOKEN_ENCRYPTION_KEY` to a base64-encoded 32-byte key. Only that site's `/calendar/export_execute.php` endpoint is accepted, including installations under a subdirectory. Credentials in the query are encrypted on the server, never returned to the browser or model, and upstream error messages are sanitized. Redirects and arbitrary feed URLs are rejected. Keep the subscription link private; use Moodle's calendar-access reset/revocation controls if it is exposed.

Production persists per-owner connections in Postgres. Run `pnpm db:migrate`, including migration `0003_moodle_calendar_subscriptions.sql`. Local development without `DATABASE_URL` uses the ignored `.local/moodle-subscriptions.json` under the web app working directory. Keep the encryption key stable across restarts; changing it requires reconnection. Disconnect deletes the stored URL and cached preview for that owner. It does not revoke the source link in Moodle or remove previously created Google study blocks.

## Feed meaning and refresh

The feed supplies event titles, descriptions, course categories and dates. Moodle exports several kinds of events; a calendar entry is not necessarily an assignment or a submission deadline. PolyMate labels these as calendar dates and asks which entries still require work. Announcements, submission status, personal extensions and complete assignment requirements are unavailable. Open Moodle to confirm requirements and actual deadlines.

Read requests reuse the last successful snapshot for five minutes; expired snapshots refresh on access. The Refresh button forces retrieval. There is no independent periodic polling worker: registered OpenClaw jobs can read the stored owner connection, and the app refreshes on demand. Preview timestamps identify the last successful read. A failed refresh reports an error; an already displayed preview is labeled stale. Planning and scheduling always force a fresh feed, and reconnecting invalidates older sealed drafts.

The parser supports UTC, explicit timezones, floating times interpreted in Europe/Zurich, date-only entries, ordinary recurrence rules, exclusions and changed occurrences. It preserves IDs for non-recurring events when their dates change. Expansion covers seven days back and sixty days ahead, with limits of 1 MB, 1,000 source events, 100 recurrence rules and 500 expanded events. Dense hourly/minutely/secondly recurrences and rules with BYHOUR/BYMINUTE/BYSECOND are skipped with warnings. The export's own filters determine what data is available; PolyMate cannot retrieve omitted dates. All-day dates do not supply an exact deadline time and are excluded as timed planning targets.

## API and agent tools

- `POST /api/integrations/moodle/connection` with `{ "subscriptionUrl": "<private-calendar-url>" }`: validates and saves the subscription, returns a sanitized snapshot.
- `GET /api/integrations/moodle/connection`: connection status, mode, event count and last successful sync time; no subscription credentials.
- `DELETE /api/integrations/moodle/connection`: deletes that owner's connection.
- `GET /api/integrations/moodle/calendar`: reads the cached or refreshed snapshot.
- `POST /api/integrations/moodle/calendar`: forces refresh.

All routes resolve student identity on the server. Mutations require the exact application Origin; JSON bodies are size-limited. Private responses use `Cache-Control: no-store`.

The main OpenClaw agent exposes `moodle_get_calendar_events` with no arguments. It returns sanitized events, retrieval time and limitations. The existing planner contract uses `assignmentId` internally as the selected event ID; this naming does not certify entries as assignments. `moodle_plan_assignment_timeline` accepts those IDs, estimated minutes in multiples of ten, and explicit future availability within 42 days. It avoids Google and Moodle event intervals, allocates blocks up to fifty minutes with ten-minute breaks and reports unscheduled work. It requires Google Calendar access.

```json
{
  "work": [{ "assignmentId": 123, "estimatedMinutes": 150 }],
  "availability": [
    { "startAt": "2026-10-12T14:00:00+02:00", "endAt": "2026-10-12T18:00:00+02:00" }
  ]
}
```

The returned sealed `planToken` binds the exact draft to its owner, site and connection, for thirty minutes. Only `moodle_schedule_assignment_timeline` can dispatch that draft, after explicit user consent in chat. It refreshes the feed and rejects removed entries, incompatible dates or newly conflicting Moodle events. Google Calendar rechecks its own conflicts at write time. Writes stop on the first failed or uncertain result. Retry with the same token/operation IDs; partial plans require a separate explicit choice. Study blocks are ordinary PolyMate Google events; connecting a subscription does not automatically copy Moodle events to Google.

## Compatibility and verification

The earlier REST adapter remains available for callers of the token connection API and `moodle_get_assignments_and_announcements`; it is not exposed by the primary subscription UI or canonical agent tool list. Its eight-hour browser cookie, administrator-enabled REST functions and richer assignment/status/announcement mapping remain covered by tests. A stored calendar subscription takes precedence over that legacy cookie.

Fixture tests cover URL restrictions, credential redaction, UTC/all-day/DST dates, recurring events and overrides, changed/cancelled dates, owner isolation, encrypted local persistence, forced refresh, changed connections, Moodle busy intervals and exact-draft retries. The checkout has not been verified with a live ETH subscription or a connected Google account. See [AI agent setup](AI_AGENT_HANDOFF.md) for the OpenClaw deployment limits.

References: [Moodle calendar export/subscriptions](https://docs.moodle.org/502/en/Using_Calendar), [Moodle export implementation](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/calendar/export_execute.php), [node-ical](https://github.com/jens-maus/node-ical).
