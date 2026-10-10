# PolyMate

For real local OpenAI/OpenClaw testing and production configuration, see [LOCAL_AI_TESTING.md](docs/LOCAL_AI_TESTING.md).

An AI study companion for ETH students with a weekly calendar, Moodle calendar subscriptions, and an OpenClaw-backed study chat.

**Current status:** Iteration 1 is complete: the Google-connected calendar passed live acceptance on 10 October 2026. See the [acceptance results](docs/ITERATION_1_ACCEPTANCE.md). Iteration 2 is the next roadmap milestone: deadlines, availability, plan preview, and approved Google study blocks. Moodle and AI integrations are implemented separately; their live acceptance is not covered by the calendar checks.

- [Five-person schedule](docs/TEAM_SCHEDULE.md)
- [Branches, ownership, and parallel merging](CONTRIBUTING.md)
- [Kent's handoff](docs/KENT_HANDOFF.md)
- [VM deployment and recovery](docs/DEPLOYMENT.md)
- [Product specification](docs/POLYMATE_SPEC.md) and [implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [AI agent and OpenClaw setup](docs/AI_AGENT_HANDOFF.md)
- [Iteration 2 planner implementation](docs/ITERATION_2_HANDOFF.md)
- [Full project overview](docs/README.md)
- [Moodle calendar subscriptions and study planning](docs/MOODLE_AI_INTEGRATION.md)

## Development

Use Node 24 and pnpm 11.1.1:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:3000/calendar. The local shell uses a fixed synthetic student and requires no external credentials. `pnpm check` runs typecheck, lint, tests, and the production build. See CONTRIBUTING.md for first-time setup, and the deployment runbook for isolated production container tests. Credentials and production data must stay outside Git.

For Moodle, paste the private URL from Calendar → Export calendar → Get calendar URL into the subscription form. Set `TOKEN_ENCRYPTION_KEY` to a base64-encoded 32-byte key in the ignored `apps/web/.env.local`. The event preview works without Google or OpenClaw. Without `DATABASE_URL`, development stores encrypted subscriptions in ignored `apps/web/.local/`; production uses Postgres and requires `pnpm db:migrate`. Google is required for study planning/calendar writes, and chat requires the OpenClaw setup above.
