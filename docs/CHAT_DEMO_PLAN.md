# PolyMate chat demo plan

## Goal

Demonstrate PolyMate as one coherent study companion inside the product's primary Chat surface. The walkthrough must show only shipped capabilities, preserve the production approval boundary, and remain repeatable without external accounts.

Entry point: `/demo`, which redirects to `/calendar?demo=1&view=chat`. There is no separate demo UI.

## What the audience should understand

By the end of the walkthrough, the audience should have seen PolyMate:

1. combine a Moodle deadline, saved course priorities, calendar commitments, and durable student preferences;
2. remember a temporary commitment and expose it in Student memory;
3. produce a conflict-free study draft without writing anything;
4. require explicit approval before creating multiple calendar blocks;
5. adapt an existing PolyMate block instead of creating a duplicate.

## Fixture student

- Student: Alex Meier.
- Course: Algorithms and Data Structures.
- Course context: 4 lecture hours per week, 12 exercise sessions at 120 minutes each, exam on 25 January 2027.
- Exam priorities: dynamic-programming sheets and the 2025 past exam are required; extra graph problems are optional; the coding project is not required.
- Moodle item: Problem set 4, due Friday at 18:00, with 150 minutes of student-estimated effort.
- Persistent preference: focused sessions should be no longer than 50 minutes.
- Existing calendar: Monday lecture, Tuesday student job, Wednesday lecture, Thursday team project, and Friday climbing.
- Added during the demo: volunteering Wednesday from 17:00–20:00, valid only through the demonstrated week.

All fixture dates are generated for the next Zurich calendar week so the scenario remains valid. Data and calendar writes stay in memory and reset on reload.

## Three-minute rehearsal

### 1. Context synthesis — 30 seconds

Choose: `What should I focus on this week?`

Expected result:

- Chat identifies Problem set 4 and its Friday deadline.
- It distinguishes must-do and optional exam preparation using the saved course profile.
- It calls out the busy parts of the calendar and the 50-minute preference.
- The normal Moodle source card is displayed.

### 2. Durable memory — 25 seconds

Choose: `Remember that I volunteer next Wednesday from 17:00 to 20:00.`

Expected result:

- Chat states exactly what was saved and that it is temporary.
- Coach → Student memory shows the preference and volunteering plan.
- The planning step treats the new commitment as unavailable time.

### 3. Draft-first planning — 40 seconds

Choose: `Plan 150 minutes for Algorithms problem set 4 before Friday. I can study Monday to Thursday from 16:00 to 20:00.`

Expected result:

- Chat proposes three 50-minute blocks.
- The blocks avoid the job, volunteering, project meeting, and climbing.
- The draft card says that no calendar write has happened.
- The calendar approval button is visible.

### 4. Explicit approval — 35 seconds

Choose `Add to calendar` on the draft card.

Expected result:

- The shared in-memory `CalendarClient` creates all three blocks.
- The normal calendar-sync result card reports each operation separately.
- Opening Calendar shows the same blocks; this is not a visual-only transcript change.

### 5. Adaptation — 30 seconds

Choose: `Thursday no longer works. Move the final review to Friday at 16:00.`

Expected result:

- Chat reads the current fixture calendar, finds the existing editable block, and updates it with its current etag.
- The result card reports a move, not a replacement create.
- Calendar shows the final review on Friday from 16:00–16:50, before the deadline and before climbing.

### 6. Close — 20 seconds

Open Calendar, then Courses and Coach if time permits. Emphasize that the fixture is deterministic, while the production agent uses the same UI contracts and protected operations against the signed-in student's data.

## Capability parity with the production agent

| Demonstrated behavior | Production source of truth |
| --- | --- |
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

- Always show `Demo` and `Safe sample data` labels.
- Never imply that the fixture is a live ETH, Moodle, or Google connection.
- Never create study blocks before the approval step.
- Preserve per-operation results instead of claiming blanket success.
- If a required block is missing, explain the prerequisite step instead of inventing it.
- Reloading is the reset mechanism; it affects no external data.
- `/calendar?calendar=sample` remains a development fixture with Chat disabled. Only `demo=1` enables deterministic fixture Chat.

## Release checklist

- `/demo` redirects to the Chat tab.
- The full guided path works with mouse, keyboard, and mobile layout.
- Coach memory updates after the memory step.
- Calendar is initially positioned on the generated demo week.
- The approval step creates exactly three blocks.
- The move step updates exactly one existing block.
- Refresh resets the scenario.
- Browser console has no application errors.
- Typecheck, lint, tests, and production build pass.

