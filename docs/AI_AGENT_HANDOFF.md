# PolyMate AI agent handoff

PolyMate uses the OpenClaw Gateway as the model runtime and automation scheduler. The authenticated Next.js application remains the authority for student identity, encrypted Moodle calendar subscriptions, Google credentials, plan validation, and calendar writes.

## Setup

Configure the application with `OPENCLAW_GATEWAY_HTTP_URL`, `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_AGENT_ID`, `OPENCLAW_SCHEDULER_AGENT_ID`, `AGENT_CONTEXT_SECRET`, and `OPENCLAW_AGENT_BRIDGE_SECRET`. Generate both PolyMate secrets with `openssl rand -hex 32`. The Gateway token is an operator credential; keep it on private service-to-service ingress and never put it in browser code or logs. `OPENCLAW_GATEWAY_HTTP_URL` must be reachable from the web container.

Install the OpenClaw plugin from `integrations/openclaw-agent-plugin` using OpenClaw **2026.9.9** (the plugin pins this SDK version). Set `POLYMATE_AGENT_TOOL_URL` in the Gateway process to the web service's private URL, for example `http://web:3000/api/internal/agent/tools`, and set the same `OPENCLAW_AGENT_BRIDGE_SECRET` in the Gateway and web services.

After changing Moodle tool definitions, run `pnpm agent:sync-openclaw-tools`, then rebuild and validate the plugin with the installed OpenClaw CLI:

```sh
cd integrations/openclaw-agent-plugin
openclaw plugins build --entry ./index.mjs
openclaw plugins validate --root . --entry ./index.mjs
openclaw plugins install .
```

Enable the OpenAI-compatible chat-completions endpoint on the Gateway and configure the model on the selected agent. Keep its tool surface narrow. The shape below shows the policy intent; merge these entries into the Gateway's existing configuration and preserve other required provider settings:

```json5
{
  gateway: {
    http: { endpoints: { chatCompletions: { enabled: true } } },
    tools: { allow: ["cron"] },
  },
  tools: {
    allow: [
      "moodle_get_calendar_events",
      "moodle_plan_assignment_timeline",
      "moodle_schedule_assignment_timeline",
      "polymate_check_connections",
      "polymate_get_calendar",
      "polymate_create_study_block",
      "polymate_edit_study_block",
      "polymate_move_study_block",
      "polymate_delete_study_blocks",
      "polymate_get_study_progress",
      "polymate_link_study_session",
      "polymate_report_study_progress",
      "cron",
    ],
  },
  agents: {
    entries: {
      main: {
        tools: { allow: [
          "moodle_get_calendar_events",
          "moodle_plan_assignment_timeline",
          "moodle_schedule_assignment_timeline",
          "polymate_check_connections",
          "polymate_get_calendar",
          "polymate_create_study_block",
          "polymate_edit_study_block",
          "polymate_move_study_block",
          "polymate_delete_study_blocks",
          "polymate_get_study_progress",
          "polymate_link_study_session",
          "polymate_report_study_progress",
        ] },
      },
      "polymate-scheduler": { tools: { allow: ["cron"] } },
    },
  },
  plugins: {
    allow: ["polymate-agent"],
    entries: { "polymate-agent": { enabled: true } },
  },
}
```

The app calls `/v1/chat/completions` with a signed, owner-scoped session key. The plugin signs tool callbacks to PolyMate. Scheduler mutations call `/tools/invoke` using the isolated `polymate-scheduler` agent; generated jobs target the configured student agent, use only their registered read-only tools, and have no delivery route. OpenClaw's HTTP invoke API treats its bearer credential as full operator access, so its Gateway must stay private and the agent/tool allowlists above must be kept narrow. Run `pnpm db:migrate` to add the owner-scoped automation registration and calendar-subscription tables (migrations 0002 and 0003).

## Supported behavior

The chat lives on `/calendar` beside the weekly calendar and Google/Moodle connection cards. The subscription card previews Moodle events without AI or Google. Calendar event cards show source links, retrieval time and feed limitations; dates are planning targets, not independently verified deadlines. The agent asks for effort estimates and explicit availability, previews a sealed timeline, and only writes after explicit consent. Partial plans require their own choice. The agent can also create one explicitly requested study block or edit an existing block after reading its current owner-scoped event and etag, and delete explicitly requested PolyMate blocks after reading them (personal Google events stay read-only). Confirmed, failed, and uncertain writes are shown per block; the calendar reloads after a write attempt. Retrieved Moodle text is always treated as untrusted source content. The calendar retains manual study-block creation, editing, completion and deletion, and the separate assignment-entry panel. Confirmed AI calendar writes refresh the same interactive calendar. Manually entered assignments are not yet an AI planning source.

### Interactive local progress

The foreground agent now reads local assignments, linked sessions and recent difficulty/history using `polymate_get_study_progress`. Optional local assignment UUID / event ID filters narrow the bounded view (50 assignments, 100 sessions, 30 reports and 10 pending completions). Local UUIDs are separate from numeric Moodle feed IDs: title similarity never establishes an association. Manually entered assignments are a progress source, but the Moodle planner still does not plan from them.

`polymate_link_study_session` prepares an explicit assignment-link card after reading local assignments and the Google calendar. `polymate_report_study_progress` uses the sealed context reference from a linked-session read to prepare Done / Partly done / Missed / Stuck. Both tools **prepare only**; clicking the card calls the authenticated, same-origin chat action `confirm_progress`, which also requires the agent CSRF token: the browser first calls `GET /api/agent/csrf` (HttpOnly `polymate_agent_csrf` cookie scoped to `/api/agent`) and sends the returned token as `x-csrf-token`. A failure while synchronizing linked-session metadata during calendar reads is logged and never hides the Google events. A proposed whole-assignment completion additionally requires the student's checkbox and an explicit `confirmAssignmentFinished` value; a model flag alone cannot finish the assignment. Partial work needs a student-supplied positive remaining-minute estimate; Stuck needs a difficulty note; Missed never changes effort.

General progress reads are cached history and remain available without Google; they do not issue new-report context tokens. After choosing a linked session, call `polymate_get_study_progress` with its `eventId`. This fetches the owned Google event directly, even if it moved outside the displayed week, synchronizes metadata using the read-start timestamp, and reloads local versions before issuing a token. A failed/unavailable refresh returns cached state with an explanation and no new-report token. Concurrent changes that prevent the fetched event matching local metadata also withhold authorization. An old prepared report remains rejected after a move; refresh the selected session and ask the student to review a new draft. Saved pending-completion cards always retain their original UUID/ETag/revision, regardless of refreshed session metadata.

Confirmation cards carry an encrypted, owner-bound draft token containing the original request UUID, assignment version, session revision and ETag. They contain no OAuth/subscription credentials. New drafts expire after 30 minutes. The exact token can confirm/retry across web-process restarts without a runtime-map entry. Expired report tokens can replay only an already persisted report, through existing durable deduplication/reconciliation. Changed versions are rejected rather than silently refreshed. Unconfirmed browser cards are in component memory and disappear on page reload; ask for a fresh draft. Saved unresolved Done reports are returned as recovery cards on the next progress read, retaining their original request IDs. Keep `TOKEN_ENCRYPTION_KEY` stable.

Linked calendar moves use `rescheduleStudySessionFor`; unlinked moves preserve the existing calendar service path and observe confirmed outcomes. Agent calendar reads synchronize linked metadata. Moves keep event IDs/remaining effort, increment session revisions, and retain historical reports. Confirmations refresh the shared assignments/progress workspace, and Google completion attempts refresh the calendar. Backend receipts determine save/completion wording; a saved report is distinct from an unknown/failed Google write. Replayed receipts show the report's original effort snapshot rather than claiming it is the latest estimate.

Move results distinguish Google status from `progressSync` (`synced`, `pending`, or `not_attempted`). Secondary observation failures do not discard a Google-confirmed move, its result card, or the calendar refresh. A pending-metadata notice tells the student not to repeat the confirmed move. The next progress-state read repairs missing effects from the confirmed calendar ledger; transaction rollback and effect deduplication prevent duplicate session revisions/activity. Validation/ownership/version failures before a write still block it, and failed/unknown Google outcomes are never promoted to success.

Progress/link tools are not background automation tools. This increment does not register check-ins, send Telegram messages, perform automatic replanning, map Moodle entries automatically, or support assignment-only reports outside linked calendar sessions. Development sample-mode chat is disabled to prevent a sample interaction from changing the connected server workspace.

The chat lives in the Chat view of `/calendar`, alongside separate Calendar and Settings views. The subscription card previews Moodle events without AI or Google. Calendar event cards show source links, retrieval time and feed limitations; dates are planning targets, not independently verified deadlines. The agent asks for effort estimates and explicit availability, previews a sealed timeline, and only writes after explicit consent. Partial plans require their own choice. Confirmed, failed, and uncertain writes are shown per block; the calendar reloads after a write attempt. Retrieved Moodle text is always treated as untrusted source content. The calendar retains manual study-block creation, editing, completion and deletion, and the separate assignment-entry panel. Confirmed AI calendar writes refresh the same interactive calendar. Manually entered assignments are not yet an AI planning source.

The agent can also create one explicitly requested study block or edit an existing block after reading its current owner-scoped event and etag, and delete explicitly requested PolyMate blocks after reading them (personal Google events stay read-only). The PolyMate calendar remains available without Google; when Google is connected, its events are shown as a read-only overlay.

The shared `AutomationScheduler` interface is exported from `@polymate/core/agent/automations`; `agentAutomationScheduler` in `apps/web/lib/agent-automations.ts` implements registration and owner-scoped cancellation for Moodle monitoring and progress jobs. Background callbacks are bound to the persisted Gateway job ID and stored tool allowlist. Scheduled reads resolve the registered owner's encrypted calendar subscription on the server, without browser cookies. Only registered read tools are permitted. Disconnecting removes access for later runs. No background write tool is exposed.

The application stores up to 12 conversation messages per owner, limits each retained message to 4,000 characters, and expires idle history after one hour. Browser history displays up to 40 messages. Each request creates a fresh signed OpenClaw session so callbacks from timed-out turns cannot use a later turn's authorization; bounded prior messages and current draft details are supplied as untrusted conversation data. The model-facing `planToken` is the short timeline ID; the backend resolves it to the owner’s retained sealed payload. The sealed payload stays server-side. Exact chat approvals such as “schedule it” use the displayed timeline ID through the same authenticated scheduling action as the preview button, without a model round trip. Commands containing revisions remain in chat. The backend still checks the current draft, expiry, and separate partial approval. OpenClaw runs the model/tool loop for other messages. Configure Gateway retention to prune completed per-turn sessions.

Live tool-call context, direct-write retries, history, and the current sealed preview are held in process memory; use one web replica. Session affinity alone is insufficient if the same owner can reach multiple replicas. A web restart or expired 30-minute plan clears the preview, so the student must request a fresh one. Revised drafts reset consent; failed and uncertain schedules preserve the same sealed token and operation IDs. Direct creates use stable operation IDs for uncertain retries. Existing blocks are edited through the owner-scoped calendar update service, using their actual event ID and etag; uncertain edits retain the original etag and operation ID for one hour. Personal events cannot be edited.

## Verification and current limits

For the local-progress increment and synchronization fixes, `pnpm check` passes typecheck, lint, **269 tests across 32 files**, and the production build. Progress integration cases exercise signed foreground dispatch, non-mutating previews, authenticated confirmations/CSRF, whole-assignment consent, session-vs-assignment completion, explicit effort/difficulty semantics, tampering/owner isolation, stale/expired drafts, exact persisted-request replay after runtime reset, unknown Done recovery, explicit linking/personal-event protection, linked moves/history and move retries, bounded reads, and background write refusal. Synchronization regressions cover confirmed linked/unlinked moves surviving observation failure, genuine failed moves, external moves outside the displayed week, cached reads without Google, refresh/ownership/deletion/concurrency failures withholding new tokens, and saved recovery identity after a move. The real-SQL progress runner verifies failed metadata transaction rollback and exact-once repair from the calendar ledger. The generated plugin definitions and manifest match the canonical contracts. No OpenClaw CLI is available in this environment; running-plugin validation and live AI/Google checks remain pending. Browser verification remains paused.

Live acceptance after installing the updated plugin/allowlists:

1. Connect Google and configure OpenClaw; Moodle is not required for local progress. Add a local assignment and a linked Google study block in Calendar.
2. In Chat, ask “What progress do I have on this assignment?” Verify the local assignment, session time and history.
3. Say “I partly finished this session; 100 minutes remain.” Verify no change occurs before confirmation, then confirm the card and inspect Calendar → Assignments and block history.
4. Report Stuck with a question/topic, then Missed on an open linked session. Verify the saved note and unchanged missed effort.
5. Explicitly request a new date/time for the missed session. Verify the same Google event moved, the revision increased and previous reports remain historical.
6. On an open linked session, report Done without whole-assignment completion; verify Google Done with remaining effort preserved. Separately report the whole assignment finished; verify the additional checkbox is required and Moodle submission is not asserted.
7. Change the assignment or move the block after preparing a card; confirmation must reject the stale draft. Retry an original unknown completion rather than preparing a duplicate report. After a web restart/page reload, request progress again to retrieve pending-completion recovery cards.

Checks performed on Windows on 2026-10-10: `pnpm typecheck`, `pnpm lint` (zero warnings), and `pnpm build` passed. All 68 focused agent/Moodle tests passed, including subscription security, DST/all-day parsing, recurring overrides, encrypted persistence, refreshed dates/conflicts and safe retries. The full Vitest suite had 207 passing tests and two existing failures in `tests/install-google-env.test.ts` (POSIX file modes and child-process stdout on Windows). Automated tests cover signed session isolation, tool allowlists and argument validation, negated consent, consent reset on replanning, exact-draft retries, uncertain calendar moves, prompt separation, automation ownership, bounded streams, and the actual structured Gateway response envelope.

The plugin factory and cron result contracts were checked against the [OpenClaw 2026.9.9 source](https://github.com/openclaw/openclaw/tree/v2026.9.9). The [tool plugin guide](https://docs.openclaw.ai/plugins/tool-plugins), [chat HTTP API](https://docs.openclaw.ai/gateway/openai-http-api), and [tools invoke API](https://docs.openclaw.ai/gateway/tools-invoke-http-api) describe Gateway setup. The plugin has not been loaded or CLI-validated in a running OpenClaw installation in this checkout; run the build/validate commands above before deployment.

This checkout has no OpenClaw Gateway token/model configuration, live Moodle calendar subscription, or connected Google account. The full journey has not been live-tested against ETH Moodle or Google Calendar. Fixture tests verify the local logic only; they are not evidence of live connectivity. Calendar subscriptions persist per owner; feed access and calendar export availability still need live verification. See [Moodle subscription setup](MOODLE_AI_INTEGRATION.md).
