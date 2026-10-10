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
      "polymate_move_study_block",
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
          "polymate_move_study_block",
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

The chat lives on `/calendar` beside the weekly calendar and Google/Moodle connection cards. The subscription card previews Moodle events without AI or Google. Calendar event cards show source links, retrieval time and feed limitations; dates are planning targets, not independently verified deadlines. The agent asks for effort estimates and explicit availability, previews a sealed timeline, and only writes after explicit consent. Partial plans require their own choice. Confirmed, failed, and uncertain writes are shown per block; the calendar reloads after a write attempt. Retrieved Moodle text is always treated as untrusted source content.

The shared `AutomationScheduler` interface is exported from `@polymate/core/agent/automations`; `agentAutomationScheduler` in `apps/web/lib/agent-automations.ts` implements registration and owner-scoped cancellation for Moodle monitoring and progress jobs. Background callbacks are bound to the persisted Gateway job ID and stored tool allowlist. Scheduled reads resolve the registered owner's encrypted calendar subscription on the server, without browser cookies. Only registered read tools are permitted. Disconnecting removes access for later runs. No background write tool is exposed.

The application stores up to 12 conversation messages per owner, limits each retained message to 4,000 characters, and expires idle history after one hour. Browser history displays up to 40 messages. Each request creates a fresh signed OpenClaw session so callbacks from timed-out turns cannot use a later turn's authorization; bounded prior messages and the current sealed draft are supplied as untrusted conversation data. OpenClaw runs the model/tool loop. Configure Gateway retention to prune completed per-turn sessions.

Live tool-call context, move retries, history, and the current sealed preview are held in process memory; use one web replica. Session affinity alone is insufficient if the same owner can reach multiple replicas. A web restart or expired 30-minute plan clears the preview, so the student must request a fresh one. Revised drafts reset consent; failed and uncertain schedules preserve the same sealed token and operation IDs. Existing blocks are moved through the owner-scoped calendar update service, using their actual event ID and etag; uncertain moves retain the original etag and operation ID for one hour. Personal events cannot be moved.

## Verification and current limits

Checks performed on Windows on 2026-10-10: `pnpm typecheck`, `pnpm lint` (zero warnings), and `pnpm build` passed. All 68 focused agent/Moodle tests passed, including subscription security, DST/all-day parsing, recurring overrides, encrypted persistence, refreshed dates/conflicts and safe retries. The full Vitest suite had 163 passing tests and two existing failures in `tests/install-google-env.test.ts` (POSIX file modes and child-process stdout on Windows). Automated tests cover signed session isolation, tool allowlists and argument validation, negated consent, consent reset on replanning, exact-draft retries, uncertain calendar moves, prompt separation, automation ownership, bounded streams, and the actual structured Gateway response envelope.

The plugin factory and cron result contracts were checked against the [OpenClaw 2026.9.9 source](https://github.com/openclaw/openclaw/tree/v2026.9.9). The [tool plugin guide](https://docs.openclaw.ai/plugins/tool-plugins), [chat HTTP API](https://docs.openclaw.ai/gateway/openai-http-api), and [tools invoke API](https://docs.openclaw.ai/gateway/tools-invoke-http-api) describe Gateway setup. The plugin has not been loaded or CLI-validated in a running OpenClaw installation in this checkout; run the build/validate commands above before deployment.

This checkout has no OpenClaw Gateway token/model configuration, live Moodle calendar subscription, or connected Google account. The full journey has not been live-tested against ETH Moodle or Google Calendar. Fixture tests verify the local logic only; they are not evidence of live connectivity. Calendar subscriptions persist per owner; feed access and calendar export availability still need live verification. See [Moodle subscription setup](MOODLE_AI_INTEGRATION.md).
