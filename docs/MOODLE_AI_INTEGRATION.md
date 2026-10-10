# Moodle → AI tools → Google Calendar

Implemented on `codex/moodle-ai-integration`. Moodle is read-only; calendar writes use the existing owner-scoped CalendarService. No main AI/chat agent exists in this checkout yet. This module exposes tools and an authenticated dispatcher for that agent to register when it arrives.

## Connection

Set `MOODLE_SITE_URL` to the administrator-approved HTTPS Moodle base URL (default: `https://moodle-app2.let.ethz.ch`). Set the existing `TOKEN_ENCRYPTION_KEY` to a base64-encoded 32-byte key. Never give a Moodle token to the model, put it in source control, or store it in localStorage.

On `/calendar`, enter a personal web-service token in **Connect Moodle**. The server verifies it with `core_webservice_get_site_info` and stores an encrypted, HttpOnly, SameSite=Strict cookie, bound to the signed-in PolyMate owner, for eight hours. Disconnect clears that browser connection; revoke the token in Moodle to revoke it everywhere. Tokens are not persisted in the database, so an unattended/background agent will need a future encrypted per-owner credential repository.

The Moodle administrator must enable REST, authorize the student for the service and enable these functions:

- `core_webservice_get_site_info`
- `core_enrol_get_users_courses`
- `mod_assign_get_assignments`
- `mod_assign_get_submission_status`
- `mod_forum_get_forums_by_courses`
- `mod_forum_get_forum_discussions`

The last two are optional for connecting: missing access produces a visible announcement warning. Other missing functions reject the connection. ETH API/token availability has not been verified with a live student token. Shibboleth sign-in alone does not provide an API token; obtain an authorized token/service from the Moodle administrators if it is unavailable in the student account.

Connection endpoints:

- `POST /api/integrations/moodle/connection` with `{ "token": "<personal-token>" }`
- `GET /api/integrations/moodle/connection` returns status and expiry, never the token.
- `DELETE /api/integrations/moodle/connection` disconnects this browser.

Mutations require the authenticated student, an exact application Origin, and JSON content type for POST. Requests and private responses are not cached. The server uses a configured site, prohibits credential-bearing URLs, posts tokens in the body, refuses redirects, times out requests, and redacts upstream error messages.

## Main agent registration

Import `MOODLE_AGENT_TOOL_DEFINITIONS` from `@polymate/core/moodle/tools` into the agent's function-tool registry. Dispatch model-selected tool names and parsed arguments through `executeMoodleTool(originalRequest, name, args)` from `apps/web/lib/moodle.ts`. Use the original authenticated request; never let the model choose an owner, Moodle site or credentials. Treat assignment/announcement text as untrusted source data, never instructions. If the model needs to estimate effort, label the estimate and obtain or use the student's actual availability.

Alternatively dispatch via `POST /api/integrations/moodle/tools` with `{ "name": "<tool-name>", "arguments": {} }` from the application browser with its connection cookie and Origin.

1. `moodle_get_assignments_and_announcements`: no arguments. Returns enrolled courses, assignment descriptions and deadlines, announcement posts from `news` forums, source links, retrieval time and explicit warnings for missing/truncated data. Course imports are capped at 50; news forums at 100; discussion history at 1000 per forum. This does not read quizzes, arbitrary forum threads or attached documents.
2. `moodle_plan_assignment_timeline`: accepts selected assignment IDs, estimated effort and explicit availability. Reads Google Calendar busy time, prioritizes earliest deadlines, allocates blocks up to 50 minutes with ten-minute breaks, and reports unscheduled effort. Reads Moodle submission status and personal extensions; skips submitted work and does not schedule missing/past deadlines. Moodle assignment dates already reflect user/group overrides. All timestamps are ISO instants with explicit offsets; calendar rendering uses Europe/Zurich.
3. `moodle_schedule_assignment_timeline`: accepts the exact `planToken` returned by the planner, plus optional `allowPartial: true`. The authenticated encrypted token binds the exact plan to the owner and site and expires in 30 minutes or when the connection expires. Rechecks assignment status/dates before writing. The calendar service rechecks conflicts at write time. Stable operation IDs support retries with the same token; inspect individual operation results. Writes stop after the first failed/uncertain operation and are not atomic across all blocks. Already written blocks remain. Partial plans require `allowPartial: true` and never report full completion.

Example planning arguments (replace times with future availability within 42 days):

```json
{
  "work": [{ "assignmentId": 123, "estimatedMinutes": 150 }],
  "availability": [
    { "startAt": "2026-10-12T14:00:00+02:00", "endAt": "2026-10-12T18:00:00+02:00" }
  ]
}
```

The result contains `timeline` (blocks, source URLs, warnings and unscheduled work), `planToken` and its expiry. Scheduling arguments are `{ "planToken": "<returned-token>" }`. Connect Google Calendar before planning or scheduling. Successful blocks are ordinary PolyMate study blocks, visible on `/calendar` after refresh and editable through the existing calendar APIs.

## Verification and remaining integration

Automated tests cover REST mapping, permission/error redaction, owner-bound encrypted connection, origin/identity checks, forged/cross-owner plan tokens, deadline extensions, submitted work, conflicts, incomplete capacity, unknown writes and idempotent retries. Live ETH retrieval and Google writes require authorized student credentials and must be verified before calling this a live integration. Registering the tools with the future main agent and durable credentials for background execution remain separate work.

References: [Moodle REST client](https://docs.moodle.org/dev/Creating_a_web_service_client), [administrator web-service setup](https://docs.moodle.org/501/en/Setting_up_a_web_service), [Moodle assignment API source](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/mod/assign/externallib.php), [Moodle forum API source](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/mod/forum/externallib.php).
