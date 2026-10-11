# PolyMate

**PolyMate is an AI study companion for ETH students.** You tell it what you have to do, and it turns your deadlines into concrete study sessions in your calendar. It then checks in on how they went and reschedules when plans change.

In one sentence: *understand the student → notice upcoming work → schedule it → check progress → adapt the plan.*

- **Live deployment:** https://07.hackathon.ethz.ch
- **Guided demo, no accounts needed:** `/demo`

This README is our submission report. It first explains what PolyMate does for a student, then how it is built, how it keeps student data and calendars safe, how we tested and deployed it, and what is still open.

---

## What a student can do

| Feature | What it means for the student |
|---|---|
| **Weekly calendar** | See lectures, personal events, and PolyMate study blocks in one Zurich-time week view. Create, move, complete, and delete study blocks. |
| **Google Calendar or PolyMate calendar** | Study blocks are written to Google Calendar, or kept in PolyMate's own calendar if the student prefers. Switching moves upcoming blocks across. Personal Google events are view-only and are never changed. |
| **Academic inputs** | Subscribe to a private Moodle calendar link, import `.ics` files (Moodle, myStudies), or add assignments by hand or by chat, each with a deadline and an effort estimate. |
| **Automatic study planning** | PolyMate splits each assignment into 50-minute blocks with 10-minute breaks before the deadline, respecting lectures, busy events, preferred hours, and a daily limit. The student sees a preview and approves it before anything is written. |
| **Study chat** | A streamed chat assistant that can read the calendar, draft a timeline, create or move study blocks, add assignments, record progress, and remember preferences. Every calendar change needs explicit confirmation. |
| **Progress and recovery** | After each session the student reports *Done*, *Partly done*, *Missed*, or *Stuck*. Missed or partial work is moved to the next free slot, and the remaining effort is tracked. |
| **Proactive check-ins** | PolyMate opens a chat by itself after an unreported session, before an unplanned deadline, after a *Stuck* report, or when a course has gone quiet. It respects quiet hours (22:00–08:00), at most three check-ins a day, and a one-hour gap. |
| **Semester and degree planning** | Course search through the ETH course catalogue (VVZ), a graduation audit for the MSc CS, and an agentic multi-semester plan with a workload ceiling. |
| **Onboarding and memory** | A short onboarding collects programme, courses, and study preferences. The assistant keeps durable notes that the student can see. |

### Try it

1. Open **`/demo`**. It is a deterministic, choice-driven walkthrough inside the normal Chat tab: onboarding, a proactive check-in, course-aware planning, explicit calendar approval, and moving an existing study block. It needs no Google account and makes no model calls. The full script is in [docs/CHAT_DEMO_PLAN.md](docs/CHAT_DEMO_PLAN.md).
2. Open **`/calendar`** for the real app: connect Google, add a Moodle link or an assignment, generate a plan, and use the chat.

---

## Technical overview

### Architecture

```text
Browser (Next.js / React)
  │  calendar, chat (NDJSON stream), settings, onboarding
  ▼
Next.js server (apps/web) ── one Node 24 process
  ├─ API routes: identity, calendar, assignments, planning, progress,
  │  imports, Moodle, VVZ, chats, onboarding, health
  ├─ Foreground AI chat: OpenAI Agents SDK (direct chat runtime)
  │     └─ owner-bound tool dispatcher → the same services as the UI
  └─ packages/core: scheduling engine, calendar service, check-in rules,
     progress, Google / Moodle / VVZ clients
  ▼
PostgreSQL 17 (packages/db, SQL migrations 0001–0009)

OpenClaw (optional container)
  └─ background jobs only (scheduled check-ins, automations)
     → signed internal bridge /api/internal/agent/tools

External: Google Calendar API (OAuth), Moodle iCal export, VVZ API, OpenAI
```

### Technology

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4, Radix UI, `react-markdown` |
| Backend | Next.js route handlers in TypeScript, Zod validation, standalone production build |
| Data | PostgreSQL 17 with plain SQL migrations; an encrypted local file store in development |
| AI | OpenAI Agents SDK (`@openai/agents`) in the web process, model `gpt-6-luna`, reasoning effort `none`; OpenClaw for scheduled background agents |
| Tooling | pnpm 11 monorepo, TypeScript 6, Vitest 5, ESLint 9 |
| Hosting | Docker Compose on the hackathon VM, behind the managed ETH proxy |

### Repository layout

| Path | Contents |
|---|---|
| `apps/web` | Next.js app: pages (`/`, `/calendar`, `/demo`), API routes, UI components, chat runtime |
| `packages/core` | Domain logic: `scheduling/` (planner, allocator, free-slot search), `calendar/` (Google and standalone services, ICS import, operations), `agent/` (canonical tool definitions, context), `checkins/`, `progress/`, `integrations/` (Google auth, Moodle, VVZ) |
| `packages/contracts` | Shared request and response types between UI, API, and agent |
| `packages/db` | Postgres access and SQL migrations |
| `integrations/openclaw-agent-plugin` | OpenClaw plugin exposing PolyMate tools to background jobs |
| `scripts`, `ops` | Deploy, rollback, backup and restore, watchdog, check-in tick, config and smoke checks, systemd units |
| `tests` | 69 Vitest suites plus integration and end-to-end checks |

### The AI chat agent

Foreground chat runs in the web process on the OpenAI Agents SDK ([direct chat runtime](docs/DIRECT_CHAT_RUNTIME.md)). We moved it there from OpenClaw to cut latency. OpenClaw still runs the scheduled background jobs.

- **Tools.** The agent sees one canonical tool list (`AGENT_TOOL_DEFINITIONS`): read the calendar, check connections, create, edit, move, and delete study blocks, create assignments, read and report study progress, link sessions to assignments, read Moodle dates, plan semesters, and remember student context.
- **Owner binding.** Every tool call goes through one dispatcher (`dispatchForegroundAgentTool`) that injects the authenticated student from server-side context. The model never supplies a user ID, OAuth token, operation ID, or calendar connection.
- **Consent.** Writes require an explicit confirmation card. The model's intent is never treated as authorization.
- **Write limits.** Server-side caps on deletions and created blocks per turn. Each write carries an operation ID, so a retry cannot double-book. An uncertain write is reconciled and never blindly repeated.
- **Parallelism.** Independent read tools run in parallel; writes and stateful tools run one at a time. Only one turn per student runs at once.
- **Streaming.** Replies stream to the browser as NDJSON together with tool status ("Drafting your timeline…"). A streaming redactor removes private values, even when a value is split across chunks. A final authoritative step replaces any inaccurate model claim with the real calendar outcome.
- **Privacy.** SDK tracing is off because prompts contain student data. Telemetry records timing only (context, model, and tool time), never content.

### Scheduling engine

`packages/core/scheduling` is deterministic and does not use the model:

- plans over the next seven days, before each deadline;
- creates blocks of up to 50 minutes with 10-minute buffers, within preferred hours and daily and weekly limits;
- prioritizes urgent work and spreads large assignments across days;
- keeps already-scheduled and completed minutes, so replanning does not lose progress;
- reports a shortfall when not enough time remains instead of overbooking.

Availability is checked again immediately before every write. An agent-created block that overlaps an event moves to the nearest free slot under a fresh operation ID.

### Integrations

- **Google Calendar:** OAuth with encrypted, persisted refresh tokens. Only PolyMate-owned events can be changed; personal events return `403`. Revoked access is detected and the student is asked to reconnect.
- **Moodle:** a read-only private iCalendar subscription, with no Moodle token. Only the configured ETH Moodle export endpoint is accepted. The link is encrypted at rest and never sent to the browser or the model. The parser handles time zones, recurrence, and size limits.
- **ICS import:** persistent imports with preview, deduplication, and safe reimport. Open-ended recurring series are limited to one semester.
- **VVZ:** semester course search, alternatives, and graduation audit through the public VVZ API.

### Security and privacy

- Identity comes from the managed ETH proxy (`AUTH_MODE=managed-proxy`). Every route resolves the student on the server.
- Mutating requests require the exact application Origin and a CSRF token. JSON bodies are size-limited, and private responses are `Cache-Control: no-store`.
- OAuth tokens and Moodle links are encrypted at rest with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`). Background jobs reach the app only through an HMAC-signed internal bridge.
- API keys are server-only. There are no `NEXT_PUBLIC_` secrets, and keys never appear in health or config endpoints.

### Reliability and deployment

- **Docker Compose** services: `db` (Postgres), `web`, and optional `openclaw` and `tooling`, with health checks, memory limits, and log rotation.
- **Releases** are immutable, tagged by commit SHA. `scripts/deploy.sh` runs migrations and a smoke test; `scripts/rollback.sh` returns to the last known-good SHA.
- **Self-recovery:** a systemd watchdog timer restarts unhealthy containers and skips runs during deploys. Containers restart automatically after a reboot.
- **Backups:** a systemd timer creates Postgres backups every six hours, each with a manifest, and `scripts/restore-check.sh` verifies that they restore.
- **CI** (GitHub Actions): `checks` (typecheck, lint, tests, build), `planner` (planner, planning API, and SQL migration checks), and `containers` (production images against real Postgres). Merges to `main` deploy to the VM.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full runbook.

### Testing and verification

- **Automated:** Vitest suites cover the planner and free-slot search, calendar operations and ownership, Google and Moodle clients, ICS import, the agent dispatcher, streaming redaction, the direct chat route and runtime (with a mocked runner, so CI makes no live model calls), check-in rules, onboarding, semester planning, and configuration validation.
- **Live acceptance:** the Google-connected calendar passed live acceptance on the deployed VM on 10 October 2026: sign-in, read, create, move, complete, delete, overlap rejection, personal-event protection, restart with token refresh, and revoked access. See [docs/ITERATION_1_ACCEPTANCE.md](docs/ITERATION_1_ACCEPTANCE.md).
- **Latency:** `pnpm agent:latency` measures per-turn latency. See [docs/AGENT_LATENCY_PLAN.md](docs/AGENT_LATENCY_PLAN.md).

### Run it locally

Use Node 24 and pnpm 11.1.1:

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm dev
```

Open http://127.0.0.1:3000/calendar (a fixed synthetic student, no credentials needed) or http://127.0.0.1:3000/demo. Run `pnpm check` for typecheck, lint, tests, and the production build.

Optional configuration goes in the ignored `apps/web/.env.local`:

- `TOKEN_ENCRYPTION_KEY`: a base64-encoded 32-byte key, for Moodle subscriptions and Google tokens.
- Google OAuth variables, for Google Calendar writes. Without them, study blocks stay in the PolyMate calendar.
- `OPENAI_API_KEY`: for the chat in the web process.
- `DATABASE_URL`: for Postgres, then run `pnpm db:migrate`. Without it, development uses an encrypted local file store.

Background check-ins use OpenClaw; see [docs/LOCAL_AI_TESTING.md](docs/LOCAL_AI_TESTING.md).

---

## Open things we should do and other things

**Where we stand.** The Google-connected calendar is live-accepted. Automatic planning, the direct streamed chat, ICS import, proactive check-ins, onboarding, and semester planning are all on `main` and deployed. They are covered by automated tests but have not yet completed a full live acceptance run on the VM. Moodle and the AI flows have not been verified against a real student's ETH Moodle account.

**Still to do:**

- **Live acceptance:** run the iteration 2 planner journey on the VM ([ITERATION_2_HANDOFF.md](docs/ITERATION_2_HANDOFF.md)), then tag `v0.2-planner`. Test ICS import end to end with real Moodle and myStudies files.
- **Operations:** install the watchdog and check-in tick timers on the VM (`CHECK_IN_TICK_SECRET`) and confirm Docker starts on boot. Confirm migrations 0005–0009 were applied. Rehearse recovery from a crash, a hang, and a reboot. Run the retry and reconciliation and worker-restart tests.
- **Chat quality and speed:** shorter replies that do not repeat timeline times as prose, sending only the pending draft's ID and summary each turn, and a VM latency baseline with before and after numbers.
- **Planning:** missed or partial work replanning with undo, invalidating stale proposals while keeping valid blocks, and per-student consent checks for agent tools that reschedule.
- **UI:** a day-by-day timeline card, progress badges on imported deadlines, a calendar selection picker, and a chat panel beside the calendar on desktop.
- **Google:** a scope upgrade so students can choose which calendars PolyMate reads.
- **Not started (cut for time):** Telegram delivery (the check-in channel interface is ready for it), exercise-PDF tutoring with understanding checks, model budget limits, and sourced course and research opportunity recommendations.

**Further documents:**

- [Product specification](docs/POLYMATE_SPEC.md) and [implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Direct chat runtime](docs/DIRECT_CHAT_RUNTIME.md) and [AI agent and OpenClaw setup](docs/AI_AGENT_HANDOFF.md)
- [Moodle subscriptions and study planning](docs/MOODLE_AI_INTEGRATION.md) and [proactive check-ins](docs/PROACTIVE_CHATS_HANDOFF.md)
- [Deployment and recovery](docs/DEPLOYMENT.md) and [contributing and branches](CONTRIBUTING.md)
- [Team schedule](docs/TEAM_SCHEDULE.md) and [project overview](docs/README.md)
