# PolyMate chat demo plan

## Goal

Demonstrate PolyMate as one coherent study companion inside the product's primary Chat surface. The walkthrough must show only shipped capabilities, preserve the production approval boundary, and remain repeatable without external accounts.

Entry point: `/demo`, which redirects to `/calendar?demo=1&view=chat`. There is no separate demo UI.

## What the audience should understand

By the end of the walkthrough, the audience should have seen PolyMate:

1. adapt its behavior from a short, choice-based onboarding;
2. combine a Moodle deadline, saved course priorities, calendar commitments, and durable student preferences;
3. surface a proactive coaching question, collect the answer in Chat, and preserve progress;
4. remember a temporary commitment and expose it in Student memory;
5. produce a conflict-free study draft without writing anything;
6. explain a plan without changing the calendar, then require explicit approval before creating blocks;
7. adapt an existing PolyMate block instead of creating a duplicate.

## Fixture student

- Student: Alex Meier.
- Course: Algorithms and Data Structures.
- Course context: 4 lecture hours per week, 12 exercise sessions at 120 minutes each, exam on 25 January 2027.
- Exam priorities: dynamic-programming sheets and the 2025 past exam are required; extra graph problems are optional; the coding project is not required.
- Moodle item: Problem set 4, due Friday at 18:00, with 150 minutes of student-estimated effort.
- Persistent preference: chosen during onboarding as either 30- or 50-minute focus sessions.
- Existing calendar: Monday lecture, Tuesday student job, Wednesday lecture, Thursday team project, and Friday climbing.
- Added during the demo: either volunteering Wednesday from 17:00–20:00 or a project rehearsal Thursday from 17:00–19:00, valid only through the demonstrated week.

All fixture dates are generated for the next Zurich calendar week so the scenario remains valid. Data and calendar writes stay in memory and reset on reload.

## Three-minute rehearsal

### 0. Interactive onboarding — 25 seconds

Recommended showcase path:

- Goal: `Build exam confidence`.
- Focus rhythm: `30-minute sprints`.
- Coaching: `Flag risks early`.

Expected result:

- Chat saves the chosen focus rhythm as persistent student memory.
- The Coach control becomes visibly outstanding with one response needed.
- Opening Coach and choosing `Respond` brings the question into the Chat composer.
- A response is stored as this week's context without advancing or resetting the guided walkthrough.

### 1. Context synthesis — 30 seconds

Choose either `Prioritize deadlines` or `Connect to the exam`.

Expected result:

- Chat identifies Problem set 4 and its Friday deadline.
- It distinguishes must-do and optional exam preparation using the saved course profile.
- It calls out the busy parts of the calendar and the selected focus preference.
- The normal Moodle source card is displayed.

### 2. Durable memory — 25 seconds

Choose either `Protect volunteering` or `Protect rehearsal`.

Expected result:

- Chat states exactly what was saved and that it is temporary.
- Coach → Student memory shows the preference and chosen commitment.
- The planning step treats the new commitment as unavailable time.

### 3. Draft-first planning — 40 seconds

Choose either `Spread the work` or `Front-load it`.

Expected result:

- Chat proposes either three 50-minute blocks or five 30-minute blocks.
- The blocks avoid the job, chosen commitment, project meeting, and climbing.
- The draft card says that no calendar write has happened.
- The calendar approval button is visible.

### 4. Explicit approval — 35 seconds

First choose `Explain the trade-off`, then `Approve all blocks`.

Expected result:

- The explanation keeps the draft intact and leaves the calendar unchanged.
- The shared in-memory `CalendarClient` creates all selected blocks only after approval.
- The normal calendar-sync result card reports each operation separately.
- Opening Calendar shows the same blocks; this is not a visual-only transcript change.

### 5. Adaptation — 30 seconds

Choose either `Move to Friday 15:00` or `Move to Friday 16:00`.

Expected result:

- Chat reads the current fixture calendar, finds the existing editable block, and updates it with its current etag.
- The result card reports a move, not a replacement create.
- Calendar shows the final review at the selected Friday time, with the chosen 30- or 50-minute duration, before the deadline and before climbing.

### 6. Close — 20 seconds

Open Calendar, then Courses and Coach if time permits. Emphasize that the fixture is deterministic, while the production agent uses the same UI contracts and protected operations against the signed-in student's data.

## Capability parity with the production agent

| Demonstrated behavior | Production source of truth |
| --- | --- |
| Choice-driven setup | Persistent preference memory plus coaching cadence used by Chat and Coach |
| Moodle deadline retrieval | `moodle_get_calendar_events` |
| Course workload and exam priorities in Chat | Saved course profiles injected into the agent's persistent context |
| Durable temporary memory | `polymate_remember_student_context` with an exact student quote and `validUntil` |
| Busy-time retrieval | `polymate_get_calendar` |
| Draft-first assignment planning | `moodle_plan_assignment_timeline` |
| Explicit multi-block approval | Server-held pending plan plus `schedule_current_plan` |
| Calendar creation | `moodle_schedule_assignment_timeline` / PolyMate calendar service |
| Existing-block move | Calendar read followed by `polymate_move_study_block` |

The deterministic demo does not call the model gateway or external Moodle/Google accounts. It invokes the same frontend card shapes and calendar-client contract so the UI, approval boundary, and mutations can be rehearsed reliably. Production tool tests cover authentication, consent checks, sealed plans, retries, and moves.

## Guardrails and failure behavior

- Always identify the experience as a mentor demo and interactive walkthrough.
- Never imply that the fixture is a live ETH, Moodle, or Google connection.
- Never create study blocks before the approval step.
- A coaching answer must not advance or reset the guided demo stage.
- The explanation path must not create calendar events.
- Preserve per-operation results instead of claiming blanket success.
- If a required block is missing, explain the prerequisite step instead of inventing it.
- Reloading is the reset mechanism; it affects no external data.
- `/calendar?calendar=sample` remains a development fixture with Chat disabled. Only `demo=1` enables deterministic fixture Chat.

## Release checklist

- `/demo` redirects to the Chat tab.
- Onboarding requires one choice from every group before it can start.
- Onboarding choices alter memory, coaching state, planning, and rescheduling.
- The full guided path works with mouse, keyboard, and mobile layout.
- Proactive Coach shows a response-needed badge and records the answer in Chat.
- Coach memory updates after the memory step.
- Calendar is initially positioned on the generated demo week.
- The approval step creates exactly three 50-minute or five 30-minute blocks.
- The move step updates exactly one existing block.
- Refresh resets the scenario.
- Browser console has no application errors.
- Typecheck, lint, tests, and production build pass.

