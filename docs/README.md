# PolyMate

PolyMate is a proactive AI study companion for ETH CS bachelor's and master's students. It connects academic deadlines, study planning, Telegram check-ins, exercise tutoring, and relevant academic opportunities.

## Project documents

- **Start here:** [Five-person delivery schedule](TEAM_SCHEDULE.md): named roles, parallel tasks per iteration, branch/file ownership, and release gates.
- [Iteration 1 acceptance](ITERATION_1_ACCEPTANCE.md): completed live Google Calendar checks on 10 October 2026.
- [Parallel development and merging](../CONTRIBUTING.md): each person's branch, file boundaries, commands, review pairs, and merge order.
- [Kent's implementation handoff](KENT_HANDOFF.md): implemented infrastructure and remaining teammate dependencies.
- [Manual assignment entry](ASSIGNMENT_ENTRY_HANDOFF.md): assignment form/list, persistence API, migration, and testing instructions for iteration 2.
- [Deployment and recovery](DEPLOYMENT.md): VM setup, SHA releases, backup/restore, and rollback.
- [Product specification](POLYMATE_SPEC.md): agreed student experience, hackathon scope, and success criteria.
- [Implementation plan](IMPLEMENTATION_PLAN.md): staged VM architecture, service contracts, testing, and deployment/recovery runbook.
- [Earlier campus companion concept](SPEC.md): background reference for broader discovery features.

**First MVP:** a working interactive calendar with live Google Calendar integration. Automatic backend planning follows in iteration 2; imports/adaptation, Telegram/AI, and learning/discovery come afterward.

The five positions are Yildirim (calendar interface), Dogancem (scheduling/calendar service), Kent (integration/release), Bartek (data/connections), and Catalin (student workflow/quality).

**Iteration 1 is complete.** The Google-connected calendar passed live acceptance at [the managed address](https://07.hackathon.ethz.ch) on 10 October 2026; the final checks used deployed commit `c39aae9`. Google OAuth and calendar actions are integrated, including ownership/conflict protection, reload persistence, revoked-access feedback, and restart/token-refresh recovery. See [the results](ITERATION_1_ACCEPTANCE.md). Iteration 2 adds deadlines, availability, plan generation, and approved Google blocks.

## Run locally

Use Node.js 24 and pnpm 11.1.1 (pinned in `.nvmrc` and `package.json`):

```bash
nvm install
nvm use
npm install --global pnpm@11.1.1
pnpm install --frozen-lockfile
pnpm dev
```

Open http://127.0.0.1:3000/calendar. Local development uses one fixed synthetic student. Run `pnpm check` for typechecking, lint, tests, and the production build. See the deployment runbook for PostgreSQL and production container checks. Working credentials belong in the ignored VM `.env`; `.env.example` only documents variable names.
