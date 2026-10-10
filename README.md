# PolyMate

For real local OpenAI/OpenClaw testing and production configuration, see [LOCAL_AI_TESTING.md](docs/LOCAL_AI_TESTING.md).

An AI study companion for ETH students with a weekly calendar, Moodle calendar subscriptions, and an OpenClaw-backed study chat.

**Current status:** Iteration 1 is complete: the Google-connected calendar passed live acceptance on 10 October 2026. See the [acceptance results](docs/ITERATION_1_ACCEPTANCE.md). Iteration 2 (deadlines, availability, plan preview, and approved Google study blocks) is implemented and awaiting live acceptance; see the [roadmap](#roadmap-remaining-iterations) for what comes next. Moodle and AI integrations are implemented separately; their live acceptance is not covered by the calendar checks.

- [Roadmap: remaining iterations](#roadmap-remaining-iterations) (four-person split; supersedes the task matrix in TEAM_SCHEDULE.md)
- [Original five-person schedule](docs/TEAM_SCHEDULE.md)
- [Branches, ownership, and parallel merging](CONTRIBUTING.md)
- [Kent's handoff](docs/KENT_HANDOFF.md)
- [VM deployment and recovery](docs/DEPLOYMENT.md)
- [Product specification](docs/POLYMATE_SPEC.md) and [implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [AI agent and OpenClaw setup](docs/AI_AGENT_HANDOFF.md)
- [Iteration 2 planner implementation](docs/ITERATION_2_HANDOFF.md)
- [Full project overview](docs/README.md)
- [Moodle calendar subscriptions and study planning](docs/MOODLE_AI_INTEGRATION.md)

## Roadmap: remaining iterations

Four people: Kent, Dogancem, Catalin, and Yildirim. Final deadline: Sunday 11 October 2026, 12:00 Europe/Zurich; feature freeze at 10:00. Do not start the next iteration while the current gate is failing. Present the last stable release honestly if later iterations remain incomplete.

### Close iteration 2

- **Catalin:** run the live acceptance journey in [ITERATION_2_HANDOFF.md](docs/ITERATION_2_HANDOFF.md), including the failure cases.
- **Kent:** tag `v0.2-planner` on the deployed main SHA once it passes.

### Iteration 3a: feedback fixes (first ~1 hour)

Feedback: the planning chat is slow, its replies are text-heavy, and the app must recover on the VM by itself.

| Person | Tasks |
|---|---|
| Kent | **Crash recovery:** add a watchdog timer in `ops/` that restarts unhealthy PolyMate containers (`restart: unless-stopped` covers crashes, not hangs), and confirm Docker starts on VM boot. **Speed:** time a planning request on the VM (model time vs. tool calls), then lower the reasoning effort or use a faster model for planning. |
| Dogancem | **Speed:** shorten the agent system prompt and send less chat history. Tell the model not to repeat timeline times as prose; the card shows them. |
| Yildirim | **Visual replies:** redesign the timeline card as a day-by-day view with time blocks. Show rotating status words while the agent works ("Juggling deadlines…", "Finding free slots…"). |
| Catalin | **Checks:** compare response times before and after. Stop the web container, freeze it, and reboot the VM; confirm it recovers each time. Check the timeline card on desktop and mobile. |

**Gate:** planning is noticeably faster, timelines are visual, and the app recovers from a crash, a hang, and a reboot without manual intervention.

### Iteration 3b: imports and adaptive rescheduling → `v0.3-adaptive`

| Person | Tasks |
|---|---|
| Kent | Migrations and repositories for imports and progress, including source provenance. Retry/reconciliation and a worker restart test. |
| Dogancem | Missed/partial-work replanning with undo. Invalidate stale proposals while keeping valid blocks. Google scope upgrade for selected calendars. |
| Catalin | ICS import end to end (Moodle/myStudies): parsing, deduplication, preview, confirm, reimport. Done / Partly done / Missed / Stuck controls. |
| Yildirim | Show imported lectures, deadlines, and progress badges. Calendar selection picker. |

**Gate:** real imported deadline → plan → missed or partial session → updated Google schedule with preserved progress.

### Iteration 4: proactive buddy and Telegram → `v0.4-buddy`

| Person | Tasks |
|---|---|
| Kent | Worker queues, production Telegram bot polling, provider config, logs, heartbeat. Persist scheduled reminders and delivery outcomes; invalidate old reminders. |
| Dogancem | Agent tools over the existing planner with consent checks and per-student turn serialization. Persist conversation context. **Server-side streaming** with progress events per tool step. |
| Catalin | Telegram pairing, pause, and settings; quick actions. Test the missed-session conversation, quiet hours, and the daily message cap. |
| Yildirim | Chat panel beside the calendar. **Streamed replies** with status words that show the real step ("Reading calendar…"). |

**Gate:** a proactive message arrives with the app closed, a reply reschedules safely through existing services, and replies appear as they are written. The calendar still works without the model or Telegram. Streaming is the first item to cut if time runs out.

### Iteration 5 (optional): learning and opportunities

| Person | Tasks |
|---|---|
| Kent | Private PDF storage and extraction, model budget limits, known-good rollback release. |
| Dogancem | Exercise-grounded hints and understanding checks; a confirmed outcome can adjust the next study task. |
| Catalin | Load curated, sourced course/opportunity records; validate one real exercise; prepare the combined demo. |
| Yildirim | PDF side panel and minimal Explore cards. |

**Gate:** one verified tutoring example and one sourced opportunity without regressing the calendar.

### Final stabilization: Sunday 08:30–11:30

| Person | Tasks |
|---|---|
| Kent | Freeze features at 10:00, deploy the final known-good commit, confirm the watchdog is active on the VM, verify migrations and backup/restore, submit by 11:30. |
| Dogancem | Verify time/conflict correctness, mutation ownership, uncertain-write reconciliation, planner regressions, and Google token refresh. |
| Catalin | Three full rehearsals including one "kill the app" recovery check, a backup recording, judge access, and a list of what actually shipped. |
| Yildirim | Fix only release-blocking calendar rendering, navigation, accessibility, or mobile defects. |

## Development

Use Node 24 and pnpm 11.1.1:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:3000/calendar. The local shell uses a fixed synthetic student and requires no external credentials. `pnpm check` runs typecheck, lint, tests, and the production build. See CONTRIBUTING.md for first-time setup, and the deployment runbook for isolated production container tests. Credentials and production data must stay outside Git.

Open http://127.0.0.1:3000/demo for the deterministic product demo. It runs inside the normal Chat tab with choice-driven onboarding and branching decisions, demonstrating proactive coaching, response capture, durable memory, course-aware planning, explicit calendar approval, and moving an existing study block without external accounts. The complete rehearsal is documented in [docs/CHAT_DEMO_PLAN.md](docs/CHAT_DEMO_PLAN.md).

For Moodle, paste the private URL from Calendar → Export calendar → Get calendar URL into the subscription form. Set `TOKEN_ENCRYPTION_KEY` to a base64-encoded 32-byte key in the ignored `apps/web/.env.local`. The event preview works without Google or OpenClaw. Without `DATABASE_URL`, development stores encrypted subscriptions in ignored `apps/web/.local/`; production uses Postgres and requires `pnpm db:migrate`. Google is required for study planning/calendar writes, and chat requires the OpenClaw setup above.
