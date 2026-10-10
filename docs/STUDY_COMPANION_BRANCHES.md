# Study companion implementation branches

Three feature branches implement the agreed loop: notice work → discuss and plan → check progress → adapt.

| Branch | Scope | Task |
|---|---|---|
| `codex/moodle-ai-integration` | Moodle connection and tools, recurring assignment/announcement checks, change detection | [Moodle task](MOODLE_MONITORING_TASK.md) |
| `codex/ai-agent` | OpenClaw runtime integration, shared automation interface, web chat, student context and planning conversation | [Agent task](AI_AGENT_TASK.md) |
| `codex/progress-checkins` | Daily digest, session follow-ups, progress responses and replanning | [Progress task](PROGRESS_CHECKINS_TASK.md) |

Optional enhancement: [Mobile-compatible UI](MOBILE_UI_TASK.md), primarily on `codex/ai-agent` with coordination across calendar and progress UI work. Implement after the core journey works; it is not a release blocker and does not require another feature branch.

## Shared contracts and ownership

- The PolyMate backend owns student identity, encrypted credentials, assignments, progress, preferences and permissions.
- OpenClaw provides the agent runtime and scheduled wakeups. Web chat and scheduled runs use the same validated PolyMate tools and student context.
- A server-authenticated adapter binds a run to an authorized student. Do not accept an arbitrary model-selected owner ID or reuse the browser's development identity for background jobs.
- Sessions separate conversation context; PolyMate authorization separates students' data. Do not expose a shared gateway directly as the student authorization boundary.
- Agree shared contracts before implementation: authenticated agent context, automation registration/cancellation, assignment change events, assignment-to-block links, progress states and notification preferences. Coordinate migrations with the repository's migration owner; reconcile root dependencies and deployment configuration with the release owner.
- Agree defaults: Moodle checks twice daily, a morning digest when relevant, session follow-ups only when progress is unconfirmed, quiet hours 22:00–08:00 Europe/Zurich, at most three unsolicited messages per day, and a pause control. Replies during an active chat do not count against this cap.

## Integration order

1. Record the existing Moodle implementation separately and agree shared contracts. Agent/runtime and Moodle work can proceed against those contracts.
2. Integrate owner-bound credentials, Moodle retrieval and the OpenClaw/backend adapter; demonstrate web chat invoking a real tool.
3. Add recurring Moodle checks and verify that unchanged data causes no repeated notification.
4. Integrate progress check-ins and demonstrate a partial-completion reply scheduling only the remaining work.
5. Verify the complete loop with live authorized Moodle and Google accounts, including pause, quiet hours, retries and cross-owner rejection.

## Current checkout

All three feature branches share the committed task briefs and integration guide so contributors can read the complete plan on any branch. Each branch's scope is defined in the table above. The Moodle implementation is still uncommitted in the original working directory; branch names do not isolate those changes. Preserve the existing local specification and planning changes, and record the intended Moodle implementation separately before assigning implementation work to contributors or worktrees.
