# PolyMate — Three-Day Hackathon Spec

**Audience:** ETH CS bachelor's and master's students

**Version:** 0.1 · 9 October 2026

**Purpose:** Product and implementation specification for a three-day hackathon

## 1. Product and success criteria

**PolyMate is a proactive AI study companion for ETH CS bachelor's and master's students.** It learns what students care about, helps them plan their studies, follows up on their progress, teaches when they struggle, and connects them with relevant academic opportunities.

Its central behavior is:

**Understand the student → notice upcoming work → schedule it → check progress → adapt the plan or help them learn.**

The hackathon version will demonstrate this loop end to end using real imported academic data, Google Calendar, Telegram, and an uploaded exercise sheet. Course recommendations, opportunity matching, and wellbeing advice will be smaller working features.

The demo succeeds when PolyMate can:

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
| Model | Claude Sonnet 5.5 through the AI SDK Anthropic provider; model ID configurable |
| Background execution | Inngest |
| Database, authentication, files | Supabase Postgres, Auth, and private Storage |
| Telegram | grammY with webhooks |
| Hosting | Vercel plus managed Supabase and Inngest |

The [AI SDK provides the agent tool loop](https://ai-sdk.dev/docs/agents/overview); [Inngest provides durable background execution](https://www.inngest.com/docs/durable-execution). This avoids building those framework components during the hackathon. Sonnet is a default balancing speed and capability, with [documented tool support](https://platform.claude.com/docs/en/models/overview).

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

Organize five workstreams, each with one owner:

1. Web experience and onboarding.
2. Google Calendar, imports, and scheduling.
3. Agent behavior and persistent memory.
4. Telegram and background execution.
5. Tutoring, recommendation content, and demo preparation.

Additional teammates support integration testing and content verification.

| Day | Work and completion gate |
|---|---|
| **Day 1: Prove the connections** | Deploy the skeleton; establish shared types; connect a real Google account; receive and send Telegram messages; import a real deadline; upload a PDF. **Gate: one conversation creates a real study block.** |
| **Day 2: Complete the loop** | Add scheduled check-ins, partial progress, rescheduling, tutoring, and persistent memory. Integrate curated recommendations. **Gate: Telegram reply → calendar change → tutoring → revised study task works end to end.** |
| **Day 3: Make it dependable** | Fix integration failures, verify permissions and retry behavior, polish the interface, and rehearse. Freeze features by midday. **Gate: three consecutive successful demo runs.** |

If behind, cut recommendation polish and advanced calendar proposals first. Preserve the deadline → study block → check-in → reschedule → tutoring loop.

The planned five-minute demo:

1. Introduce a student's interests and goals.
2. Import a deadline and generate study blocks.
3. Receive a Telegram check-in.
4. Reply, “I met friends; tomorrow morning works better.”
5. Show the calendar change.
6. Reply later, “I started, but question two was too hard.”
7. Demonstrate a hint, an understanding check, and a revised study task.
8. Finish with one relevant academic opportunity and a break suggestion.

## 5. Acceptance tests and scope defaults

Before presenting, verify:

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

Keep a clearly labelled fixture dataset and recorded demo as backups. The primary demonstration uses real imports, live calendar actions, and live Telegram messages.
