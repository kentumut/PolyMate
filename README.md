# PolyMate

**PolyMate is an AI study companion for ETH students.** It turns deadlines into concrete study sessions in your calendar, checks in on how they went, and reschedules when plans change.

- **Live:** https://07.hackathon.ethz.ch
- **Demo, no accounts needed:** `/demo`

## What it does

- **Calendar:** a weekly view of lectures, personal events, and study blocks, synced with Google Calendar or kept in PolyMate's own calendar. Personal events are view-only.
- **Inputs:** Moodle calendar subscription, `.ics` import (Moodle, myStudies), and assignments added by hand or by chat.
- **Planning:** splits each assignment into 50-minute blocks before its deadline around lectures and busy times. The student approves a preview before anything is written.
- **Chat:** a streamed assistant that reads the calendar, drafts plans, moves blocks, and records progress. Every calendar change needs explicit confirmation.
- **Progress and check-ins:** students mark sessions *Done*, *Partly done*, *Missed*, or *Stuck*. Missed work is rescheduled, and PolyMate reaches out on its own when a session goes unreported or a deadline approaches.
- **Semester planning:** course search through the ETH course catalogue (VVZ), an MSc CS graduation audit, and multi-semester plans.

## How it's built

```text
Browser (Next.js 16, React 19, Tailwind)
  → Next.js API routes (TypeScript, Zod)
      ├─ chat agent: OpenAI Agents SDK → owner-bound tool dispatcher
      └─ packages/core: planner, calendar, check-ins, Google/Moodle/VVZ
  → PostgreSQL 17
OpenClaw: background check-ins only, via a signed internal bridge
```

- **Safe agent:** tools always act as the signed-in student, and the model never supplies IDs or tokens. Writes need confirmation, have per-turn limits, and carry operation IDs so retries cannot double-book. Private values are redacted from the stream.
- **Deterministic planner:** scheduling is plain code, not the model. It rechecks availability before every write and reports a shortfall instead of overbooking.
- **Security:** identity comes from the managed ETH proxy. Writes are protected by an Origin check and a CSRF token. Tokens and Moodle links are encrypted with AES-256-GCM, and keys stay on the server.
- **Operations:** Docker Compose on a VM with SHA-tagged releases, deploys with migrations and a smoke test, rollback, a watchdog timer, and Postgres backups every six hours.
- **Quality:** 69 Vitest suites. CI runs typecheck, lint, tests, build, planner checks, and container checks, and deploys on merge.

Repo: `apps/web` (app and API), `packages/core` (domain logic), `packages/db` (migrations), `scripts` and `ops` (deploy and recovery), `tests`.

## Run locally

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm dev
```

Then open http://127.0.0.1:3000/calendar or `/demo`. No credentials are needed. Optional: `OPENAI_API_KEY` (chat), Google OAuth variables, `TOKEN_ENCRYPTION_KEY`, and `DATABASE_URL`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Open things we should do and other things

**Status:** the Google-connected calendar passed live acceptance on 10 October 2026 ([results](docs/ITERATION_1_ACCEPTANCE.md)). Planning, chat, imports, check-ins, onboarding, and semester planning are deployed and tested automatically, but not yet accepted live.

- Run live acceptance for planning and ICS import with real ETH files.
- Install the watchdog and check-in timers on the VM, then rehearse crash and reboot recovery.
- Make chat replies shorter and faster.
- Add undo for rescheduling, a day-by-day timeline card, and a chat panel beside the calendar.
- Cut for time: Telegram delivery, exercise tutoring, and course and opportunity recommendations.

More: [spec](docs/POLYMATE_SPEC.md) · [chat runtime](docs/DIRECT_CHAT_RUNTIME.md) · [Moodle](docs/MOODLE_AI_INTEGRATION.md) · [check-ins](docs/PROACTIVE_CHATS_HANDOFF.md) · [contributing](CONTRIBUTING.md)
