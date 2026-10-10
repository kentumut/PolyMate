# PolyMate

For real local OpenAI/OpenClaw testing and production configuration, see [LOCAL_AI_TESTING.md](docs/LOCAL_AI_TESTING.md).

An AI study companion for ETH students with a weekly calendar, Moodle calendar subscriptions, and an OpenClaw-backed study chat.

**Current status:** Iteration 1 is complete: the Google-connected calendar passed live acceptance on 10 October 2026. See the [acceptance results](docs/ITERATION_1_ACCEPTANCE.md). Iteration 2 (deadlines, availability, plan preview, and approved Google study blocks) is implemented and awaiting live acceptance. Much of iterations 3 and 4 (crash recovery, faster streamed chat, ICS import, proactive check-in chats) is merged but not yet accepted on the VM; see the [roadmap](#roadmap-remaining-iterations). Moodle and AI integrations are implemented separately; their live acceptance is not covered by the calendar checks.

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
- [Proactive check-in chats](docs/PROACTIVE_CHATS_HANDOFF.md)

## Roadmap: remaining iterations

Four people: Kent, Dogancem, Catalin, and Yildirim. Final deadline: Sunday 11 October 2026, 12:00 Europe/Zurich; feature freeze at 10:00. Do not start the next iteration while the current gate is failing. Present the last stable release honestly if later iterations remain incomplete.

**Status (Saturday 10 October, 20:30):** most of iteration 3a, ICS import from 3b, and the in-app half of the proactive buddy from iteration 4 are merged on main. No release tag exists yet, and none of this work has passed a live acceptance check on the VM. Tonight's priority is closing the open gates below, not starting new features.

### Close iteration 2

- **Catalin:** run the live acceptance journey in [ITERATION_2_HANDOFF.md](docs/ITERATION_2_HANDOFF.md), including the failure cases. *Open.*
- **Kent:** tag `v0.2-planner` on the deployed main SHA once it passes. *Open.*

### Iteration 3a: feedback fixes

Feedback: the planning chat is slow, its replies are text-heavy, and the app must recover on the VM by itself.

Done:

- **Crash recovery** (#31): `scripts/watchdog.sh` with a systemd timer in `ops/` restarts containers Docker reports as unhealthy, and skips runs during deploys.
- **Speed** (#31, #33): thinking level lowered to `low`; per-turn latency telemetry and `pnpm agent:latency`; tool definitions state date formats (no more failed calendar calls); read-only tools run in parallel; upcoming Moodle entries are sent with each turn. Plan prompt p50 went from 14.9 s to 13.1 s locally. Faster models were tested and rejected (see the [agent latency plan](docs/AGENT_LATENCY_PLAN.md)).
- **Streaming** (#33): per-tool status ("Drafting your timeline…") and streamed reply text in the chat.

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
- **Calendar write limits** (#35): server-side caps on agent deletions and created blocks.
- **Courses and semester planning** (#32, #34): VVZ semester planner, graduation audit, and multi-semester course planning.

Open:

| Person | Tasks |
|---|---|
| Kent | Retry/reconciliation and a worker restart test. Confirm the latest deploy applied migrations 0005–0007. |
| Dogancem | Missed/partial-work replanning with undo. Invalidate stale proposals while keeping valid blocks. Google scope upgrade for selected calendars. |
| Catalin | Test ICS import end to end with real Moodle and myStudies files: preview, confirm, reimport. |
| Yildirim | Progress badges on imported deadlines. Calendar selection picker. |

**Gate:** real imported deadline → plan → missed or partial session → updated Google schedule with preserved progress.

### Iteration 4: proactive buddy and Telegram → `v0.4-buddy`

Done:

- **Proactive check-in chats** (#38): PolyMate opens a chat after an unreported session, before an unplanned deadline, after a Stuck report, for a quiet course, or as a general check-in. Respects pause, quiet hours (22:00–08:00), three a day and an hour's gap. Chats are stored per student. Delivery goes through a channel interface ready for Telegram, and `scripts/check-in-tick.sh` opens due check-ins while the app is closed. See [PROACTIVE_CHATS_HANDOFF.md](docs/PROACTIVE_CHATS_HANDOFF.md).
- **Chat-first coaching workspace** (e3219be): coach inbox, durable memory, and course context for the agent.
- **Guided demo** (274561c, e8ac7c3): deterministic branching demo inside the Chat tab at `/demo`.

Open:

| Person | Tasks |
|---|---|
| Kent | Install the check-in tick as a cron job or systemd timer on the VM with `CHECK_IN_TICK_SECRET`. Telegram bot polling and a Telegram `CheckInChannel`, if time allows. |
| Dogancem | Per-student turn serialization and consent checks for agent tools that reschedule. |
| Catalin | Test the missed-session check-in, quiet hours, and the daily cap on the VM. Telegram pairing, pause, and settings, if Telegram ships. |
| Yildirim | Chat panel beside the calendar on desktop. |

**Gate:** a proactive message arrives with the app closed, a reply reschedules safely through existing services, and replies appear as they are written. The calendar still works without the model or Telegram. Telegram is the first item to cut if time runs out; in-app check-ins already cover the demo.

### Iteration 5 (optional): learning and opportunities

Not started. Cut unless iterations 3 and 4 pass their gates by Sunday 08:00.

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
