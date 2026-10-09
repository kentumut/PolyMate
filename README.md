# PolyMate

An AI study companion for ETH students. We are shipping an interactive calendar with live Google Calendar integration first; automated planning and the proactive buddy follow in later iterations.

**Current status:** Kent's application/infrastructure foundation is live at [the managed team address](https://07.hackathon.ethz.ch). Successful `main` CI runs deploy automatically to the VM. The calendar page is a labelled preview; Google OAuth, calendar actions, and teammate UI modules still need integration.

- [Five-person schedule](docs/TEAM_SCHEDULE.md)
- [Branches, ownership, and parallel merging](CONTRIBUTING.md)
- [Kent's handoff](docs/KENT_HANDOFF.md)
- [VM deployment and recovery](docs/DEPLOYMENT.md)
- [Product specification](docs/POLYMATE_SPEC.md) and [implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Full project overview](docs/README.md)

## Development

Use Node 24 and pnpm 11.1.1:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:3000/calendar. The local shell uses a fixed synthetic student and requires no external credentials. `pnpm check` runs typecheck, lint, tests, and the production build. See CONTRIBUTING.md for first-time setup, and the deployment runbook for isolated production container tests. Credentials and production data must stay outside Git.
