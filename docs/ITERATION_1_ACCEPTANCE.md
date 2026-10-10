# Iteration 1 — complete

**Date:** 10 October 2026 (Europe/Zurich).  
**Environment:** live VIScon team 07 deployment at https://07.hackathon.ethz.ch.  
**Final tested deployment:** `c39aae9da6132e68863329b5d8b9f45464a37ace`.  
**Session:** Kent and Codex, using Kent's selected Google test account.

The Google-connected scheduling MVP is working. Kent requested that iteration 1 be recorded as complete after the following live checks.

| Check | Result |
|---|---|
| Managed sign-in and Google connect | Passed. Managed identity recognized; Google OAuth returned to PolyMate. |
| Read Google events | Passed. Google events appeared in the Zurich calendar view. |
| Create study block | Passed. A temporary PolyMate block appeared in both PolyMate and Google Calendar. |
| Move study block | Passed. Moving the block from 16:00–16:50 to 17:00–17:50 was confirmed directly in Google. |
| Mark done and reload | Passed. Completion remained Done after reloading PolyMate. |
| Confirm deletion | Passed. The temporary block disappeared from both calendars. |
| Overlap rejection | Passed. A conflicting creation was rejected with an overlap message. |
| Personal-event protection | Passed. A temporary ordinary Google event appeared as read-only with no mutation controls. Live API update, completion, and deletion attempts each returned HTTP 403 / `forbidden`; Google read-back confirmed the event's ETag and contents were unchanged. |
| Web-container restart and token refresh | Passed. Only the web container was restarted. Saved event IDs, times, and completion survived; an expired cached access token was refreshed successfully using the persisted encrypted credentials. |
| Revoked Google access | Passed. Access was revoked at Google. Reads returned HTTP 409 / `not_connected`; a creation attempt returned a definitive failed result with reconnect guidance, without reporting success. The browser displayed connection guidance. |
| Reconnect and cleanup | Passed. Kent completed Google reconnection. Temporary personal and restart-test events were removed; the original Study event was preserved. |

The earlier handoff documents' “live acceptance pending” statements describe their status when written; this record supersedes those statements for iteration 1. A release tag is separate bookkeeping and is not claimed by this record. These results cover the calendar MVP; they do not assert acceptance of the later Moodle, AI, Telegram, or automatic-planning increments.

**Next milestone:** iteration 2 — assignment deadlines and effort, study availability/preferences, a generated plan preview, and approved study blocks written to Google Calendar. See [TEAM_SCHEDULE.md](TEAM_SCHEDULE.md).
