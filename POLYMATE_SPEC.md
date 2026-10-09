# PolyMate — Three-Day Hackathon Spec

**Audience:** ETH CS bachelor's and master's students

**Version:** 0.2 · 9 October 2026

**Purpose:** Product and implementation specification for a three-day hackathon

**Delivery order:** [TEAM_SCHEDULE.md](TEAM_SCHEDULE.md) assigns the five teammates and defines the release gates. Ship the interactive calendar with live Google Calendar integration first; automatic backend planning and the other capabilities follow in later iterations.

## 1. Product and success criteria

**PolyMate is a proactive AI study companion for ETH CS bachelor's and master's students.** It learns what students care about, helps them plan their studies, follows up on their progress, teaches when they struggle, and connects them with relevant academic opportunities.

Its central behavior is:

**Understand the student → notice upcoming work → schedule it → check progress → adapt the plan or help them learn.**

The first MVP is a live Google-connected calendar: students see existing commitments and create, move, complete, and delete PolyMate study blocks, with changes reflected in Google and preserved after reload. It requires a minimal OAuth/calendar backend, but no automatic planner, Telegram, AI, imports, or tutoring.

Later iterations add automatic planning, real academic imports, proactive conversations, and exercise tutoring. Course recommendations, opportunity matching, and wellbeing advice remain smaller, optional increments after scheduling is stable.

The first demo succeeds when the interactive calendar journey works with real Google Calendar events. The expanded product demo adds these capabilities as their iterations ship:

- Turn an imported deadline into realistic study blocks in Google Calendar.
- Contact the student through Telegram while the web app is closed.
- Reschedule after a missed session without losing track of the assignment.
- Recognize that struggling requires learning support, then teach from the exercise sheet.
- Remember the difficulty and adapt the next session.
- Explain a relevant course or research opportunity using a real source.

Better grades and deeper understanding are long-term goals. The prototype measures completed study actions, student-reported progress, and short understanding checks.

## 2. Student experience and feature requirements

### Onboarding and memory

Use a short conversational onboarding supported by editable profile fields. Collect:

- Bachelor's/master's programme, semester, and current courses.
- Interests, career or research goals, and relevant prior knowledge.
- Preferred study times, weekly capacity, and usual session length.
- Protected commitments, quiet hours, and permission to manage study blocks.

Connect Google Calendar and pair Telegram through a single-use link. The student must start the bot before receiving messages.

Remember explicit preferences, assignment progress, and reported difficulties across both channels. Students can inspect and correct this memory. PolyMate should sound warm, direct, and persistent without shaming students for changing plans.

### Academic inputs

Support three separate inputs:

| Input | Hackathon behavior |
|---|---|
| Moodle deadlines | Upload an `.ics` calendar export, preview events, and confirm which are assignments. |
| Lecture timetable | Upload a myStudies `.ics` export or use lectures already in Google Calendar. |
| Learning material | Upload a text-based exercise PDF and associate it with a course or assignment. |

Moodle documents calendar export support, and ETH documents myStudies timetable exports. Availability and content must be checked with an actual student account on day one. [Moodle documentation](https://docs.moodle.org/en/Using_Calendar), [ETH timetable documentation](https://ethz.ch/applications/teaching/en/applications/mystudies/welcome/schedule.html).

Imports must show their source and import time. File imports are snapshots; changes require reimporting. Missing deadlines can be added manually. Do not assume every Moodle activity has a deadline or exercise attachment in its calendar export.

### Planning and calendar management

For each assignment, PolyMate asks for an effort estimate or suggests one for confirmation. It schedules specific actions such as “attempt questions 1–2,” rather than generic “study” events.

Default scheduling rules:

- Plan over the next seven days, before each assignment's deadline.
- Use 50-minute blocks with at least 10 minutes between blocks.
- Respect lectures, busy events, preferred hours, and the student's daily study limit.
- Prioritize urgent work and distribute larger assignments across multiple days.
- If insufficient time exists, explain the shortfall and offer choices.

After onboarding consent, PolyMate can automatically create and move its own study blocks. Each change includes an explanation and an undo action.

It can propose changes to existing personal commitments, but must obtain confirmation for the specific event and new time before editing it. Read-only events remain fixed. Changes involving attendees or recurring series are handed off to Google Calendar in this version.

Recheck availability immediately before writing a change.

### Proactive accountability

Telegram supports natural-language replies and quick actions: **Start**, **Done**, **Partly done**, **Stuck**, and **Reschedule**.

Trigger check-ins:

- A morning digest when relevant work is approaching.
- A reminder shortly before a study block.
- A progress question after the block, unless progress was already reported.

Default to a maximum of three unsolicited messages per day, quiet hours from 22:00–08:00, and a pause control. Replies to an active conversation do not count toward that limit.

Different responses produce different actions:

| Student response | PolyMate response |
|---|---|
| “I met friends instead.” | Acknowledge it, ask about new constraints, and reschedule remaining work. |
| “I finished half.” | Record partial progress and schedule only the remaining effort. |
| “I tried, but it was too hard.” | Identify the difficult question or concept and enter tutoring mode. |
| No reply | Leave progress unconfirmed and include it in the next permitted check-in. |

A calendar block ending never proves that studying happened.

### Tutoring and understanding

The student selects an exercise and describes where they got stuck. PolyMate:

1. Asks a diagnostic question.
2. Gives a small hint or explanation grounded in the uploaded sheet.
3. Offers progressively stronger hints.
4. Checks understanding with a short related question.
5. Records the student's reported difficulty and adjusts the next study task.

Keep the PDF visible beside the conversation and reference the relevant page or exercise. If extraction is unreadable, ask the student to paste the specific question. Scanned and handwritten document support is outside the initial build.

### Courses, opportunities, and balance

Build recommendations from a curated dataset of **15 ETH courses and eight research/project pages**, each with a source URL and date checked.

- **Courses:** Rank three matches using interests, goals, study level, documented prerequisites, and workload information where available. For bachelor's students, distinguish required courses from elective recommendations. Use the [ETH course catalogue](https://ethz.ch/students/en/studies/academic-support/course-catalogue.html) as the source.
- **Opportunities:** Explain relevant labs, semester projects, and advertised assistant roles. Distinguish a research-interest match from a confirmed vacancy. Provide a next step and optionally draft an inquiry; sending outreach is outside the build.
- **Balance:** Suggest breaks or social time based on reported effort and the planned workload. Offer to reserve time after confirmation. Do not equate a busy calendar with burnout or treat social plans as failures.

These features share the student profile and appear as contextual suggestions, rather than separate onboarding journeys.

## 3. Implementation and interfaces

### Stack

| Component | Choice |
|---|---|
| Web app | Next.js, TypeScript, Tailwind, shadcn/ui |
| Agent | Vercel AI SDK `ToolLoopAgent` |
| Model | Configurable provider using the supplied API credits, from iteration 4 |
| Background execution | pg-boss and a Node worker, added for background features |
| Database, authentication, files | VM PostgreSQL, managed-proxy identity, private file volume when needed |
| Telegram | grammY long polling, from iteration 4 |
| Hosting | VIScon VM with Docker Compose; web/db first, worker later |

The [AI SDK provides the agent tool loop](https://ai-sdk.dev/docs/agents/overview) when conversational features are introduced. The detailed VM design and provider configuration are in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Neither agent infrastructure nor model credentials are prerequisites for the first calendar release.

Use one agent with focused tools and shared memory. Calendar validity, permissions, and reminder limits are enforced in application code.

### Interface and data flow

The web app has four areas:

- **Today:** next actions, deadlines, and progress.
- **Conversation:** streaming chat with action and confirmation cards.
- **Calendar:** weekly schedule with linked assignment details.
- **Explore:** course and opportunity recommendations.

Web messages and Telegram replies enter the same conversation service:

**Message or scheduled event → load student context → agent selects tools → validate action → execute or request confirmation → persist result → update both surfaces.**

Minimum tool interfaces cover:

- Reading assignments, availability, profile, and learning material.
- Creating or rescheduling study blocks.
- Proposing and confirming changes to existing events.
- Recording progress and learning difficulties.
- Scheduling follow-ups.
- Ranking courses and opportunities.

Persist profiles, courses, assignments, study blocks, learning notes, conversations, pending confirmations, scheduled jobs, source records, and action history. Assignment completion and study-session completion are separate states.

Every record belongs to an authenticated student. Telegram pairing resolves that identity server-side.

### Reliability and permissions

- Use Google OAuth with explicit calendar permissions and registered demo test users. Configure consent and test users on day one. [Google setup documentation](https://developers.google.com/workspace/guides/configure-oauth-consent).
- Store credentials server-side and encrypted; isolate student data and keep uploaded files private.
- Deduplicate imported events, Telegram updates, and scheduled jobs.
- Rescheduling invalidates reminders for the old block.
- Recheck event state before applying a confirmed change; request renewed confirmation if it changed.
- Reconcile uncertain calendar writes before retrying. Record Telegram delivery outcomes and avoid blindly repeating ambiguous sends.
- Treat PDFs and source pages as reference material; they cannot authorize actions.
- On integration failure, show the failure and recovery action. Never claim an event was changed without confirmation from the calendar API.

Include a protected demo control that advances a simulated clock through the same scheduling logic. Restrict it to the demo account and label simulated timing clearly.

## 4. Three-day delivery plan

Use five permanent positions: Yildirim owns the calendar interface; Dogancem owns calendar services and scheduling; Kent owns integration and release; Bartek owns data and connections; Catalin owns student workflow and integrated quality. [TEAM_SCHEDULE.md](TEAM_SCHEDULE.md) gives each person a parallel task and handoff in every iteration.

| Increment | Release gate |
|---|---|
| First MVP | Interactive calendar with real Google connect/read/create/move/complete/delete. Target roughly three hours after kickoff. |
| Iteration 2 | Manual deadlines/preferences plus automatic backend planning and applied Google study blocks. |
| Iteration 3 | Real imports, missed/partial progress, and adaptive rescheduling. |
| Iteration 4 | Telegram and AI check-ins using the existing scheduling services. |
| Optional iteration 5 | Verified exercise tutoring and sourced course/opportunity features. |
| Final stabilization | Three rehearsals; Sunday 11 October 10:00 Zurich feature freeze, deploy by 11:00, submit/export by 11:30 before noon VM-access cutoff. |

Deploy each passing increment. If behind, defer later capabilities and visual polish; keep live Google integration and its permission/reliability checks. The broader roadmap must not delay shipping a useful calendar.

The expanded five-minute demo, after the relevant later increments ship:

1. Introduce a student's interests and goals.
2. Import a deadline and generate study blocks.
3. Receive a Telegram check-in.
4. Reply, “I met friends; tomorrow morning works better.”
5. Show the calendar change.
6. Reply later, “I started, but question two was too hard.”
7. Demonstrate a hint, an understanding check, and a revised study task.
8. Finish with one relevant academic opportunity and a break suggestion.

## 5. Acceptance tests and scope defaults

For the first release, verify Google connect, viewing commitments, creating/moving/completing/deleting PolyMate blocks, reload persistence, conflict handling, reconnect errors, and protection of personal events. The checks below activate with their later feature iterations:

- Importing the same calendar twice creates no duplicate assignments.
- Planned blocks respect deadlines, busy events, study limits, and Zurich daylight-saving changes.
- No available slot produces an honest shortfall message.
- Missed and partial sessions preserve remaining work and replace obsolete reminders.
- A scheduled check-in arrives with the web app closed.
- Quiet hours, pause, and daily message limits work.
- Telegram and web share progress and learning context.
- Tutoring references the selected exercise and handles unreadable content honestly.
- Existing personal events cannot change without the matching confirmation.
- Revoked calendar access produces a reconnect state, not a false success.
- Recommendations cite real sources and never invent eligibility or vacancies.
- One student cannot access another student's data or files.

**Defaults:** English interface, Europe/Zurich timezone, five or more builders, managed services, and an invited pilot with one complete demo student.

**Outside the three-day build:** automatic ETH login, continuous Moodle synchronization, Outlook support, automated enrolment, graduation-rule certification, sending applications, native mobile apps, and comprehensive wellbeing assessment.

Keep a clearly labelled fixture dataset and recorded demo as backups. Every release demonstrates live Google calendar actions. Real imports and live Telegram messages join the demonstration only after their iterations ship.
