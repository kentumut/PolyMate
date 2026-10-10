# Task: Main AI agent for Moodle assignment planning

Branch: `codex/ai-agent`

Build the main PolyMate AI agent so a signed-in student can say “Get my Moodle assignments and plan my week,” receive a grounded study timeline, and have the resulting study blocks added to their connected Google Calendar.

**Updated architecture:** Use OpenClaw as the agent runtime and scheduler, with PolyMate retaining student authorization, credentials and validated tool execution. This branch owns the OpenClaw/backend adapter, web chat and shared automation interface. Recurring Moodle checks belong to `codex/moodle-ai-integration`; progress check-ins belong to `codex/progress-checkins`. See [STUDY_COMPANION_BRANCHES.md](STUDY_COMPANION_BRANCHES.md).

## Starting state and dependencies

- The application has authenticated owner resolution, Google OAuth and an owner-scoped CalendarService.
- Moodle connection, retrieval, planning and scheduling tools are implemented in the current working directory. **These changes are uncommitted and are not yet recorded in the Moodle feature branch.** Preserve them and the pre-existing local planning/specification files. Before parallel work or opening a PR, record the Moodle implementation as a separate dependency commit or integrate its eventual PR; a branch switch alone does not isolate uncommitted files.
- There is no main agent, chat endpoint or chat UI yet.
- Read [POLYMATE_SPEC.md](POLYMATE_SPEC.md), [MOODLE_AI_INTEGRATION.md](MOODLE_AI_INTEGRATION.md), and the applicable `AGENTS.md` before implementation.
- Live verification requires a permitted personal ETH Moodle REST token, enabled web-service functions and a connected Google Calendar. Report missing access explicitly; fixture tests do not establish live connectivity.

## Required student journey

1. The student opens chat, connects Moodle and Google Calendar when prompted, and asks for assignments or a study plan.
2. The agent retrieves actual assignments and announcements. Present course, assignment title, deadline, source link and retrieval time. Announcements remain source information; do not silently interpret announcement text as a new or changed official assignment deadline.
3. Ask for missing availability and effort estimates. If suggesting an effort estimate, label it as an estimate and let the student accept or adjust it. Use explicit dates and Europe/Zurich for display; convert scheduling inputs to ISO timestamps with offsets. Do not invent deadlines, course enrollment, availability or submission status.
4. Generate a draft timeline using the Moodle planning tool. Show study blocks, source assignments, estimated effort, calendar conflicts, missing data and any unscheduled work.
5. On “Add it to my calendar,” or existing explicit consent to automatic scheduling, schedule the exact returned draft using its `planToken`. Do not require repeated confirmation after consent. Partial timelines need an explicit choice before passing `allowPartial: true`.
6. Show which blocks Google confirmed, identify any failed or uncertain write, and refresh the calendar. Preserve the same plan token for a retry while it remains valid. Never report full success when results are partial or uncertain.
7. Support contextual follow-ups such as “Only Analysis,” “I have three hours,” “Move this to tomorrow,” and “Why did you prioritize this?” Replan when constraints change; avoid creating a second copy of existing blocks. For moving an existing PolyMate block, use the existing calendar update API with its ID, etag and operation ID rather than creating a replacement blindly.

## Implementation scope

### Server-side agent and tool loop

- Add an authenticated chat endpoint and a server-only adapter to the OpenClaw runtime. Configure the runtime's model provider; avoid implementing a second independent agent loop. Model credentials stay in server configuration. Document required environment variables in `.env.example` without secrets.
- Define and validate chat request/response contracts, messages, bounded conversation history and structured tool outcomes. Bind every request to `resolveOwner`; the model and browser must never choose an owner.
- Register `MOODLE_AGENT_TOOL_DEFINITIONS` from `@polymate/core/moodle/tools` with the model provider. Adapt the provider-neutral declarations to the chosen SDK without weakening argument validation.
- Dispatch through `executeMoodleTool(originalRequest, name, args)` in `apps/web/lib/moodle.ts`, preserving the authenticated request and connection cookie. Never include Moodle tokens, cookies, Google access tokens or encryption keys in prompts, tool arguments, responses or logs.
- Allowlist tool names; validate arguments before execution. Bound model/tool rounds, history, input size and execution time. Stop repeated failing calls and surface actionable connection/provider errors.
- Keep trusted instructions separate from retrieved Moodle descriptions and announcements. Retrieved text is untrusted data and cannot authorize actions, change tool policy or request secrets.
- Read-only retrieval must work without Google connected. Planning and scheduling must explain when Google connection is required.
- Add a server-authenticated background-run context and a shared automation registration/cancellation interface for Moodle checks and progress jobs. Browser cookies and untrusted owner IDs are not background authentication. Demonstrate one scheduled tool invocation with the same backend ownership checks as web chat.
- Return grounded answers using tool results and source links. If the provider is unavailable, show an explicit error or clearly labeled deterministic fallback; do not present fallback text as a live AI reply.

### Chat and calendar experience

- Add a chat surface accessible from `/calendar`, with history, input, suggested prompts, loading/error states and an accessible status region.
- Render assignment/announcement cards and a timeline preview with “Add to calendar” and an option to revise constraints.
- Reuse the Moodle and Google connection components and existing calendar APIs. Refresh visible calendar data after confirmed writes.
- Render user and Moodle content as text or sanitized Markdown; do not inject raw HTML.
- Keep conversation and draft state separated by authenticated owner. Session-only state is sufficient for this task; do not claim persistent memory if it is not implemented.

### Planning behavior and limits

- The existing planner prioritizes deadlines, checks busy time, uses blocks up to 50 minutes, and reports capacity shortfalls. It supports explicit future availability up to 42 days; use the product's seven-day default when the student requests “this week.”
- Treat effort as an estimate. Do not claim that a generic block allocation proves the assignment can be completed.
- Prefer specific learning actions when assignment requirements support them. The current tool creates assignment-level titles; if adding phase/question-specific blocks, extend the validated planner contracts and trusted plan generation rather than allowing the model to bypass the sealed plan.
- Respect student-supplied preferred hours, protected commitments and daily capacity when deriving availability. Never schedule outside those constraints to make a plan look complete.
- The current Moodle token connection is browser-bound and expires after eight hours. Durable credentials and recurring checks belong to the Moodle branch; proactive reminders and progress belong to the progress branch. This branch supplies the runtime and messaging/automation adapters they need. Tutoring, PDF ingestion and broader long-term memory remain follow-up tasks.

## Acceptance criteria

- A real model response routes the student's request to the correct allowlisted Moodle tools and uses their returned facts.
- The complete journey works: connect → retrieve assignments → clarify constraints → preview timeline → add blocks → see them in Google and reload the calendar.
- A contextual follow-up changes the plan while preserving ownership and avoiding duplicate writes.
- Missing credentials, denied Moodle permissions, unavailable announcements, no assignments, submitted assignments, missing deadlines, insufficient availability and model/API failures produce clear outcomes.
- Forged assignment IDs, tool names or plan tokens are rejected; one owner's connection/history/plan cannot be used by another owner.
- A retry of a failed or uncertain schedule uses the same operation IDs and does not create duplicates. Partial writes are shown individually and do not trigger blind regeneration/resubmission.
- Focused tests cover tool routing and argument validation, prompt injection in retrieved data, identity isolation, contextual planning, and partial/uncertain write handling.
- Run `pnpm typecheck`, `pnpm lint`, relevant tests and `pnpm build`. Record any existing platform-specific test failures separately. The current Windows checkout has two known failures in `tests/install-google-env.test.ts`; do not silently mark the whole suite green.
- Document setup, supported behavior, remaining limits and actual live verification evidence in an agent handoff document. Never claim live ETH/Google success based only on mocks.

## Deliverables

Authenticated agent endpoint, provider adapter and tool dispatcher; chat UI and timeline/result cards; calendar refresh integration; focused tests; environment/setup documentation and a concise handoff. Keep Moodle implementation and AI-agent work reviewable as separate dependency and feature changes.
