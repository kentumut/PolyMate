# Task: Progress check-ins and adaptive study plans

Branch: `codex/progress-checkins`

Give the study companion a reliable way to ask whether the student is up to date, record their answers and adapt remaining work. Build on the main agent, Moodle assignments and existing calendar tools.

## Deliverables

- Persist per-owner assignment progress and explicit links between assignments and PolyMate calendar blocks. Distinguish assignment completion, completion of one session, and submission to Moodle.
- Support responses: `done`, `partly_done`, `missed`, `stuck` and `unconfirmed`. A session ending does not imply completion; silence remains unconfirmed.
- Ask a short progress question after a planned study session unless the student already reported progress. Use the shared OpenClaw automation interface and the same agent conversation/context as web chat. Cancel obsolete jobs when a session moves or is deleted.
- For partial completion, ask or use the student's reported remaining effort. Replan only that remainder. For missed work, ask about changed constraints and offer a feasible new plan. For stuck work, ask which question or concept is difficult and begin a helpful conversation; a full tutoring/PDF system is outside this branch.
- Create a morning digest when relevant: upcoming deadlines, remaining work and unresolved progress. Consume deduplicated Moodle changes rather than polling Moodle independently.
- Implement shared notification preferences: quiet hours 22:00–08:00 Europe/Zurich, maximum three unsolicited messages per day, pause/resume and student-configurable cadence. Do not replay a backlog of stale check-ins after quiet hours or a pause.
- Use the supported messaging adapter from the agent branch. If Telegram is enabled, require the student to start/pair the bot before proactive delivery. No unsolicited message can go to an unverified destination.
- Respect explicit permission to manage PolyMate study blocks. Reuse existing etag/conflict/idempotency safeguards, preserve personal commitments and disclose partially applied changes.

## Acceptance criteria

- A planned session produces one relevant check-in; an existing progress response suppresses it.
- “Finished half” records partial progress and schedules only the reported remainder, without duplicated study blocks.
- “I missed it” leads to a revised plan based on actual availability; “stuck” leads to a targeted question/help rather than assuming laziness or automatically marking work done.
- Silence leaves progress unconfirmed. Completing a session does not mark the entire assignment submitted.
- Quiet hours, pause and the daily notification cap apply across both Moodle alerts and progress messages, including retries and multiple simultaneous jobs.
- Moving/deleting a block updates or cancels its check-in. Retry/restart does not duplicate a notification or write.
- Tests cover progress transitions, ownership, job cancellation, timezone/DST behavior, notification deduplication and remaining-effort replanning.

Dependencies: main agent/runtime and automation interface from `codex/ai-agent`; assignment records and durable credentials from `codex/moodle-ai-integration`. See [branch plan](STUDY_COMPANION_BRANCHES.md) for shared contracts and integration order.
