# PolyMate

For real local OpenAI/OpenClaw testing and production configuration, see [LOCAL_AI_TESTING.md](docs/LOCAL_AI_TESTING.md).

An AI study companion for ETH students with a weekly calendar, Moodle calendar subscriptions, semester planning, and a streamed study chat. Foreground chat runs in the web process on the OpenAI Agents SDK ([direct chat runtime](docs/DIRECT_CHAT_RUNTIME.md)); OpenClaw remains the scheduler for background jobs.

**Current status:** Iteration 1 is complete: the Google-connected calendar passed live acceptance on 10 October 2026. See the [acceptance results](docs/ITERATION_1_ACCEPTANCE.md). Iteration 2 (deadlines, availability, plan preview, and approved Google study blocks) is implemented and awaiting live acceptance. Much of iterations 3 and 4 (crash recovery, direct streamed chat, ICS import, proactive check-in chats, onboarding, semester planning) is merged but not yet accepted on the VM; see the [roadmap](#roadmap-remaining-iterations). Moodle and AI integrations are implemented separately; their live acceptance is not covered by the calendar checks.

- [Roadmap: remaining iterations](#roadmap-remaining-iterations) (four-person split; supersedes the task matrix in TEAM_SCHEDULE.md)
- [Original five-person schedule](docs/TEAM_SCHEDULE.md)
- [Branches, ownership, and parallel merging](CONTRIBUTING.md)
- [Kent's handoff](docs/KENT_HANDOFF.md)
- [VM deployment and recovery](docs/DEPLOYMENT.md)
- [Product specification](docs/POLYMATE_SPEC.md) and [implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [AI agent and OpenClaw setup](docs/AI_AGENT_HANDOFF.md) and [direct chat runtime](docs/DIRECT_CHAT_RUNTIME.md)
- [Iteration 2 planner implementation](docs/ITERATION_2_HANDOFF.md)
- [Full project overview](docs/README.md)
- [Moodle calendar subscriptions and study planning](docs/MOODLE_AI_INTEGRATION.md)
- [Proactive check-in chats](docs/PROACTIVE_CHATS_HANDOFF.md)

## Roadmap: remaining iterations

Four people: Kent, Dogancem, Catalin, and Yildirim. Final deadline: Sunday 11 October 2026, 12:00 Europe/Zurich; feature freeze at 10:00. Do not start the next iteration while the current gate is failing. Present the last stable release honestly if later iterations remain incomplete.

**Status (Sunday 11 October, 10:35):** feature freeze has passed. Since Saturday evening, main gained the direct foreground chat runtime, student onboarding, calendar-home selection, assignments through chat, and agentic semester planning with a scripted demo mode. No release tag exists yet, and none of this work has passed a live acceptance check on the VM. The remaining priority is the final stabilization checklist below, not new features.

### Iteration 3a: feedback fixes

Feedback: the planning chat is slow, its replies are text-heavy, and the app must recover on the VM by itself.
Open:

| Person | Tasks |
|---|---|
| Kent | Install the watchdog timer on the VM and confirm Docker starts on boot. Repeat the latency baseline on the VM and add it to the results log. |
| Dogancem | Shorter replies that do not repeat timeline times as prose; send only the pending draft's ID and summary instead of the full draft on every turn. |
| Yildirim | Day-by-day timeline card with time blocks, if not already covered by the calendar UX work. |
| Catalin | Before/after response times with `pnpm agent:latency`. Stop the web container, freeze it, and reboot the VM; confirm it recovers each time. Check the timeline card on desktop and mobile. |

**Gate:** planning is noticeably faster, timelines are visual, and the app recovers from a crash, a hang, and a reboot without manual intervention.

### Iteration 3b: imports and adaptive rescheduling → `v0.3-adaptive`

Done:

- **ICS import** (#36): persistent calendar imports with review, deduplication, safe reimport, and planner integration; open-ended recurring series are previewed for one semester.
- **Progress controls:** Done / Partly done / Missed / Stuck on study sessions (iteration 2, #21).
- **Calendar write limits** (#35): server-side caps on agent deletions and created blocks. Agent-created blocks that overlap move to the nearest free slot under a fresh operation ID (#42).
- **Calendar home** (7b87051): each student chooses Google Calendar or the PolyMate calendar for study blocks; switching moves upcoming blocks under the same IDs (migration 0009). Google is the default on first connect.
- **Courses and semester planning** (#32, #34, #44, #45, #46): VVZ semester planner, graduation audit, and multi-semester course planning; in-place agentic planning with a workload ceiling and no semester gaps; semester planning exposed to agent tools; and a scripted demo mode that runs without VVZ or model calls.
- **Assignments** (f427193, 5cc8277): assignments live under their course and can be added through chat.

Open:

| Person | Tasks |
|---|---|
| Kent | Retry/reconciliation and a worker restart test. Confirm the latest deploy applied migrations 0005–0009. |
| Dogancem | Missed/partial-work replanning with undo. Invalidate stale proposals while keeping valid blocks. Google scope upgrade for selected calendars. |
| Catalin | Test ICS import end to end with real Moodle and myStudies files: preview, confirm, reimport. |
| Yildirim | Progress badges on imported deadlines. Calendar selection picker. |

**Gate:** real imported deadline → plan → missed or partial session → updated Google schedule with preserved progress.

## Development

Use Node 24 and pnpm 11.1.1:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:3000/calendar. The local shell uses a fixed synthetic student and requires no external credentials. `pnpm check` runs typecheck, lint, tests, and the production build. See CONTRIBUTING.md for first-time setup, and the deployment runbook for isolated production container tests. Credentials and production data must stay outside Git.

Open http://127.0.0.1:3000/demo for the deterministic product demo. It runs inside the normal Chat tab with choice-driven onboarding and branching decisions, demonstrating proactive coaching, response capture, durable memory, course-aware planning, explicit calendar approval, and moving an existing study block without external accounts. The complete rehearsal is documented in [docs/CHAT_DEMO_PLAN.md](docs/CHAT_DEMO_PLAN.md).

For Moodle, paste the private URL from Calendar → Export calendar → Get calendar URL into the subscription form. Set `TOKEN_ENCRYPTION_KEY` to a base64-encoded 32-byte key in the ignored `apps/web/.env.local`. The event preview works without Google or OpenClaw. Without `DATABASE_URL`, development stores encrypted subscriptions in ignored `apps/web/.local/`; production uses Postgres and requires `pnpm db:migrate`. Google Calendar writes require a Google connection; students can instead keep study blocks in the PolyMate calendar. Chat requires `OPENAI_API_KEY` for the web process (see [DIRECT_CHAT_RUNTIME.md](docs/DIRECT_CHAT_RUNTIME.md)); background check-ins and scheduled jobs use the OpenClaw setup in [LOCAL_AI_TESTING.md](docs/LOCAL_AI_TESTING.md).
