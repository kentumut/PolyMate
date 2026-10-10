# Catalin — proactive check-in chats

Branch: `feat/catalin-i4-proactive-chat`, based on `main` at `7e6a667`.

## Student-facing behavior

PolyMate starts a chat when it has a question. The question is the first message of a new chat, with suggested replies underneath. The student taps one or types freely, and from there it is an ordinary agent conversation that already knows what the chat is about.

- A **Chats** button in the header lists stored chats, marks the ones PolyMate started, and offers **New chat**. Chats now survive a reload.
- A notice announces a new check-in: inline above the message box in the chat view, floating bottom-right elsewhere.
- **Settings → Check-ins from PolyMate** pauses check-ins and offers **Check in with me now**.

| Question | Asked when |
|---|---|
| "Your study session for X ended at 14:50. How did it go?" | 10 minutes to 24 hours after a linked block ends with no report for that session revision |
| "X is due tomorrow at 18:00 … no study time is planned. Shall I look for a slot?" | Due within 48 hours, effort remaining, no upcoming linked block |
| "Last time you got stuck on … Want to work through it together?" | 12 hours to 3 days after a Stuck report with no later report |
| "How is X going?" | Due within 3 days, no report and no question about it for 2 days |
| "How is studying for {course} going?" | Exam within 30 days, not asked about this course for 7 days |
| "How is studying going this week?" | Nothing else to ask, and no message from the student for 24 hours |

Unsolicited check-ins open one at a time, most pressing first, at least an hour apart, at most three per Zurich day, never between 22:00 and 08:00, and not while paused. A held-back question is found again on a later run unless it has gone stale. **Check in with me now** is the student's own request and skips those limits.

The opening questions are templates filled with the student's data. The model is not called until the student replies.

## How it works

- `packages/core/checkins/rules.ts` is a pure function from a snapshot (assignments, linked sessions, reports, courses, earlier check-ins) and a time to the check-ins that are due.
- `packages/core/checkins/service.ts` opens each due chat through a store and announces it on every `CheckInChannel`. Each question has a dedupe key, so a page load and a timer can run at once without asking twice.
- `packages/db/migrations/0007_proactive_chats.sql` adds `chat_conversations`, `chat_messages`, `chat_deliveries` and `check_in_preferences`. Apply with `pnpm db:migrate`.
- `POST /api/agent/chat` accepts an optional `conversationId`. With one, the turn uses that chat's stored history and check-in context, and the exchange is saved afterwards. Without one it behaves as before.

| Route | Purpose |
|---|---|
| `GET /api/chats` | Opens any due check-in for the student, then lists their chats |
| `POST /api/chats` | `read`, `pause_check_ins`, or `check_in_now` |
| `GET /api/chats/:id` | One chat with its latest 40 messages |
| `POST /api/internal/check-ins/tick` | Opens due check-ins for every student; requires `Authorization: Bearer $CHECK_IN_TICK_SECRET` |

Check-ins are created when the student's app loads or polls its chats (every minute and on focus). To create them while the app is closed, set `CHECK_IN_TICK_SECRET` (at least 32 bytes) and run `scripts/check-in-tick.sh` from cron, for example every five minutes. Nothing in the web app needs the timer.

## Adding Telegram later

1. Implement `CheckInChannel` with `id: 'telegram'`: send `draft.body`, with `draft.quickReplies` as buttons, and return the Telegram message ID as `externalId`. Add it to `checkInChannels` in `apps/web/lib/chats.ts`. `chat_deliveries` already accepts the channel and records `sent`, `failed`, `skipped` or `unknown` per chat.
2. Add a pairing table that maps a verified Telegram chat to a student, and skip students without one.
3. Route an incoming reply to that student's chat. This needs a way to run an agent turn without a browser request: `beginAgentTurn` currently takes the `NextRequest`.
4. Install the timer above, because Telegram delivery cannot depend on the app being open.

## Limits

- Stored chats keep text only. Plan and confirmation cards carry short-lived tokens and are not shown again after a reload.
- Session follow-ups cover blocks linked to an assignment, since the link is what says which work the session was for.
- The existing weekly coach inbox (`coach_messages`) is unchanged and separate.
- `scripts/check-in-tick.sh` was tested against a local listener, not on the VM.

## Verification

- `pnpm check` passes: typecheck, lint, 429 tests, production build.
- `tests/check-in-rules.test.ts` covers each question, priority, pause, quiet hours across the daylight-saving change, the daily limit, the gap, and delivery outcomes. `tests/chats-api.test.ts` covers the routes, ownership, the timer secret, and stored-chat turns.
- `tests/integration/proactive-chats.db.mjs` runs the real SQL and all migrations on PGlite and is part of `scripts/planner-check.sh`.
- Checked by hand against PostgreSQL 18 with a stand-in for the agent gateway, in a headless browser: notice, opening the chat, quick reply, new chat, reload, pause, and check-in on request. Not checked against the real OpenClaw gateway or on the VM.
