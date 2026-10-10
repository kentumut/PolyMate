# PolyMate: five-person delivery schedule

**Priority:** ship the interactive calendar with real Google Calendar integration first.

**Team:** Yildirim, Dogancem, Kent, Bartek, Catalin.

**Schedule owner:** Kent. **Release acceptance owner:** Catalin.

**Current milestone:** Iteration 1 is complete as of 10 October 2026, following live Google Calendar acceptance with Kent. [Recorded results](ITERATION_1_ACCEPTANCE.md). Next: iteration 2, deadlines and automatic backend planning.

This is the team's execution order. [POLYMATE_SPEC.md](POLYMATE_SPEC.md) describes the product vision; [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) supplies the detailed technical design. When a later feature appears in those documents, it does not become a prerequisite for the first release.

## 1. First release: a working Google-connected calendar

The first MVP is an interactive weekly calendar backed by the student's real Google Calendar. A student can connect Google, see existing commitments, create a PolyMate study block, change its time, mark it done, and delete it. Successful actions appear in Google Calendar and remain after a page reload.

Google integration is a release requirement. A static calendar, browser-only save, seeded calendar, or ICS export does not meet this milestone. Automatic backend planning comes in iteration 2; Telegram, AI chat, tutoring, and opportunity matching come later.

For the fastest safe release:

- Use the primary owned Google calendar only. Show its existing personal events as read-only busy commitments.
- Create and edit only PolyMate-owned study events. Confirm deletion; do not move personal commitments in the MVP.
- Use a simple event dialog to create/edit/move blocks. Drag-and-drop is optional after the first release.
- Give new study blocks a proposed 50-minute duration. The student chooses the time; no automatic slot selection yet.
- Display pending, synced, failed, and uncertain operation states. Never label a local draft as synced.
- Keep only the minimum backend: managed-proxy identity, Google OAuth, encrypted token storage, calendar operations, and health checks.
- Run web and PostgreSQL in Compose. Add the worker and durable planning jobs in later iterations.

The MVP is done only when a tester can perform the entire journey on the VM managed address and verify the same event changes in Google Calendar. The calendar must work without an LLM key, Telegram bot, uploaded PDF, or imported deadline.

## 2. One permanent position per teammate

These assignments distribute work; they do not assume particular skills that the team has not stated. Keep the ownership boundaries even if the team later swaps people.

| Teammate | Position | Owns | First concrete deliverable |
|---|---|---|---|
| **Yildirim** | Calendar interface owner | Week rendering, navigation, event display/selection, responsive calendar behavior | Weekly calendar showing actual Google events and PolyMate study blocks. |
| **Dogancem** | Scheduling and calendar-service owner | Google event read/write adapter, time validation, conflict checks; automatic planner in iteration 2 | Typed list/create/update/complete/delete operations for PolyMate events. |
| **Kent** | Integration and release owner | Scaffold, root configuration, managed identity, Docker, VM, CI, merge/deploy coordination | Deployable skeleton and the first working release at the managed address. |
| **Bartek** | Data and connection owner | Database schema/migrations, Google OAuth, encrypted token refresh, later imports and repositories | Reliable Google connect/reconnect/disconnect with server-side credentials. |
| **Catalin** | Student workflow and quality owner | Event forms, connection controls, action feedback, later progress/onboarding flows, acceptance tests and demo | Create/edit/move/done flow with a verified Google Calendar round-trip. |

Each person writes focused tests for their owned behavior. Catalin owns the integrated acceptance journey, not everybody else's unit tests. Kent owns the release process, not implementing every unfinished feature.

## 3. Parallel schedule and release gates

Use elapsed working time for the first release because the actual kickoff may shift. The first MVP target is about three hours after kickoff; it is a target, not a reason to publish broken Google integration. Later windows are timeboxes and can move. Keep Sunday 11 October's 10:00 Zurich feature freeze and noon VM-access cutoff fixed.

### Iteration 0: shared starting point — first 20 minutes

All five teammates work immediately; only Kent edits the root scaffold.

| Teammate | Parallel task | Handoff |
|---|---|---|
| Yildirim | Define the week-view component inputs and build the first component against a shared event fixture. | Calendar component and fixture visual review. |
| Dogancem | Define event/operation contracts and pure interval validation; agree the service signatures with Bartek. | Shared schemas and calendar-service interface. |
| Kent | Create the workspace/app shell, root tooling, Compose web/db services, health route, and managed identity resolver. Inspect VM port ownership. | Bootstrap PR merged; everyone branches from it. |
| Bartek | Configure the Google web client/test account/callback; draft the minimum schema and token-store interface. | OAuth settings viable; migration PR ready. |
| Catalin | Define the create/edit form fields and acceptance script; build the dialog against callback props. | Form component and first end-to-end test outline. |

**Gate:** shared contracts and app shell merged; each teammate has a named branch and clear file ownership. If Google client configuration is blocked, Bartek escalates immediately while everyone else continues against the fake adapter. Fixtures unblock development; they never count as Google integration.

### Iteration 1: Google-connected scheduling MVP — next 2–3 hours

**Status: COMPLETE — 10 October 2026.** The deployed calendar passed the live connect/read/create/move/complete/reload/delete journey, overlap rejection, personal-event protection, revoked-access handling, and web-container restart with token refresh. See [acceptance results](ITERATION_1_ACCEPTANCE.md).

| Teammate | Parallel task | Acceptance / handoff |
|---|---|---|
| Yildirim | Render the week, previous/next navigation, today marker, personal-event versus study-block styling; wire the read adapter and selection callbacks. | Real primary-calendar events show in Zurich time; opening a block passes its ID to the form. |
| Dogancem | Implement list/create/update/complete/delete Google operations, PolyMate ownership rules, overlap checks, stable create IDs, and uncertain-write reconciliation. | A service-level test can create and move a real test event; personal events cannot be mutated. |
| Kent | Deploy the skeleton early, enforce proxy-only identity, integrate root/config PRs, and wire the calendar page with the shared client adapter. | Managed-origin login and health work; production build has no model/worker dependency. |
| Bartek | Implement OAuth callback/state, minimum database migration, encrypted refresh tokens, connect status, and the token provider consumed by Dogancem. | Google authorization returns to the managed page; refreshing access survives a container restart. |
| Catalin | Implement connection UI and event dialog, validation messages, pending/synced/error states, mark-done/delete actions; run the live acceptance journey. | Every reported success is visible in Google and survives reload; failures remain actionable. |

**Merge order:** Kent's bootstrap → Dogancem's contracts + Bartek's minimum migration → OAuth/token provider and calendar service → Yildirim's view + Catalin's forms → Kent's composition/deployment PR. Independent branches may merge as soon as their dependencies are satisfied.

**First MVP acceptance:** connect → see existing events → create study block → verify in Google → move it → verify again → mark done → reload → delete it. Also test rejected overlap, disconnected Google, and one attempted edit of a personal event. All five spend the final 20–30 minutes fixing integration defects. Kent tags and deploys `v0.1-calendar` once Catalin signs off.

If time slips, remove animation, fancy onboarding, multi-calendar selection, and drag-and-drop. Keep live Google reads/writes, token handling, ownership checks, truthful operation states, and refresh persistence. Do not start later feature work until this release is live.

### Iteration 2: deadlines and automatic backend planning — 3 hours

Start from the deployed calendar release. This is the first iteration requiring an assignment model and automatic scheduling.

| Teammate | Parallel task | Acceptance / handoff |
|---|---|---|
| Yildirim | Add assignment-linked block labels, a proposed-plan preview, and unscheduled-work indicators to the existing calendar. | Proposed versus synced blocks remain visually distinct. |
| Dogancem | Build the deterministic seven-day planner: deadlines, remaining effort, busy intervals, study windows, 50-minute blocks, breaks, and capacity limits. | Known scenarios produce feasible slots or an explicit shortfall; no LLM required. |
| Kent | Add the worker deployment profile and CI planner checks; integrate the planner into the working calendar without changing the existing interaction contract. | `v0.2-planner` deploys while existing manual scheduling still works. |
| Bartek | Add assignment/study-block/preference repositories and additive migrations; map existing Google PolyMate events into local records without recreating them. | Existing v0.1 blocks survive migration with the same external IDs and completion state. |
| Catalin | Build manual assignment/deadline/effort entry, study-preference controls, Generate Plan / Apply Plan actions, and shortfall tests. | One manually entered deadline creates a preview, then real Google study blocks after approval. |

**Gate:** deadline + effort + availability → proposed plan → explicit initial apply → real Google blocks. Re-fetch conflicts before writes. Respect the original consent policy for subsequent automated changes. A planner failure must not break manual calendar editing. Merge schema/contracts first, then planner/repository work, then UI/apply flow, and deploy at the end of the timebox.

### Iteration 3: imports and adaptive rescheduling — 3 hours

| Teammate | Parallel task | Acceptance / handoff |
|---|---|---|
| Yildirim | Display imported lectures, deadlines, progress badges, and updated blocks without losing the current week selection. | Conflicting commitments and changed blocks are easy to inspect. |
| Dogancem | Add missed/partial-work replanning and safe undo; invalidate stale planning proposals and preserve existing valid blocks. | Remaining effort is replanned; completed work is not scheduled again. |
| Kent | Release additive migrations safely; integrate retry/reconciliation paths and run a worker restart test. | `v0.3-adaptive` keeps the earlier scheduling journeys working. |
| Bartek | Implement Moodle/myStudies ICS preview/confirm/reimport and source provenance; expand Google visibility to selected calendars with required scope upgrades if needed. | Real imports deduplicate, changed deadlines surface, and unresolved times require confirmation. |
| Catalin | Add Done / Partly done / Missed / Stuck controls, reschedule preferences, and import-review UI. | “I missed this block” can be handled through forms and produces a real Google change. |

**Gate:** real imported deadline → plan → missed or partial session → updated Google schedule with preserved progress. Telegram and natural-language AI are still unnecessary for this release.

### Iteration 4: proactive buddy and Telegram — 3–4 hours

| Teammate | Parallel task | Acceptance / handoff |
|---|---|---|
| Yildirim | Add a compact chat panel beside the calendar and surface confirmed tool actions in the week view. | Conversation-driven changes are visible in the same calendar. |
| Dogancem | Expose existing scheduling/progress services as validated agent tools; enforce consent and per-student turn serialization. | Natural language uses the same tested planner and Google adapter, rather than a second scheduling implementation. |
| Kent | Enable worker queues, production bot polling, provider config, logs, heartbeat, and release recovery. | `v0.4-buddy` runs with the browser closed and SSH disconnected. |
| Bartek | Persist conversation context, pairing/intake records, domain scheduled actions, delivery outcomes, and reminder-version invalidation. | Repeated updates and restarts do not repeat mutations or resurrect old reminders. |
| Catalin | Build pairing/pause/settings controls and quick actions; evaluate the missed-session conversation, quiet hours, and daily message cap. | Telegram follow-up → student reply → safe real-calendar reschedule. |

**Gate:** one proactive message arrives with the app closed; replying changes the schedule through existing services; old reminders are invalidated. The calendar remains fully usable when the model or Telegram is unavailable.

### Iteration 5: learning and opportunities — only after scheduling is stable, 2 hours

These are optional hackathon increments. Shipping the Google calendar and adaptive scheduling has priority over completing this entire product vision.

| Teammate | Parallel task | Acceptance / handoff |
|---|---|---|
| Yildirim | Add the PDF side panel and minimal Explore cards without reworking the calendar layout. | Learning content and recommendations link back to the current course/task. |
| Dogancem | Add exercise-grounded hint and understanding-check tools; let a confirmed learning outcome adjust the next study task. | Tutoring calls scheduling services only after a supported student response. |
| Kent | Deploy private-file support and model-budget controls; preserve the known-good scheduling release as rollback. | Optional features can be disabled independently. |
| Bartek | Add owner-scoped PDF storage/extraction and learning-note repositories; load curated sourced course/opportunity records. | Files remain private; recommended IDs exist and carry provenance. |
| Catalin | Validate one real exercise, expected hints/check answers, and course/opportunity explanations; prepare the combined demo. | Demonstrated help is grounded in the sheet and opportunities distinguish matches from vacancies. |

**Gate:** demonstrate one verified tutoring example and one sourced opportunity without regressing the calendar. If time is short, ship fewer verified cards or defer this iteration; do not displace release testing.

### Final stabilization: Sunday 08:30–11:30 Zurich

This fixed window overrides unfinished optional iteration timeboxes.

| Teammate | Final responsibility |
|---|---|
| Yildirim | Fix only release-blocking calendar rendering, navigation, accessibility, or device-layout defects. |
| Dogancem | Verify time/conflict correctness, mutation ownership, uncertain-write reconciliation, and planner regressions. |
| Kent | Freeze features at 10:00; deploy the final known-good commit, verify detached operation, retain rollback images, link the repo and complete submission by 11:30. |
| Bartek | Verify token refresh, database migrations, backup/restore, and off-VM export of data plus separately protected encryption keys. |
| Catalin | Run three complete rehearsals, record a backup demo, confirm judge access, and document the actual shipped feature set. |

Do not rely on SSH access after Sunday 12:00. Never reset production data to repair a demo. Present the last stable released iteration honestly if later increments remain incomplete.

## 4. Shared interfaces that enable parallel work

Dogancem owns calendar/scheduling contracts; Bartek owns repository/token-store contracts. Kent approves changes that affect both sides. Publish these first so views and forms can use fake adapters while OAuth is being completed.

```text
CalendarEvent:
  id, title, startAt, endAt, timezone, source (google-personal | polymate),
  editable, completion (open | done), etag

CalendarClient:
  listWeek(range)
  createStudyBlock(input, operationId)
  updateStudyBlock(id, changes, expectedEtag, operationId)
  completeStudyBlock(id, expectedEtag, operationId)
  deleteStudyBlock(id, expectedEtag, operationId)

TokenProvider:
  getValidAccessToken(ownerContext)

OperationResult:
  operationId, status (pending | synced | failed | unknown), event?, error?

Iteration 2 additions:
  Assignment, StudyPreferences, PlanProposal
  generatePlan(assignments, preferences, busyEvents, clock)
  applyPlan(proposalId, expectedVersions, operationId)
```

Transport uses ISO instants plus Europe/Zurich for display. Client inputs never choose an owner. The real CalendarClient calls authenticated routes; a fake implementation supplies the same interface for local development/tests. Fake mode is explicitly labelled and excluded from release acceptance.

Yildirim's calendar receives events, range, loading/error state, and onSelect/onRangeChange callbacks. Catalin's dialog receives the selected event and onCreate/onUpdate/onComplete/onDelete callbacks. Kent owns the page that composes them. Neither teammate needs to edit the other's main component to integrate it.

For iteration 1, use users, calendar_connections, oauth_states, and calendar_operations tables. Google is the source of truth for event contents; PolyMate private extended properties carry its block ID and completion state. Persist operation ID, target event ID/ETag, intended change, and result for reconciliation. Broader assignment, study-block, queue, conversation, and document schemas are added in their iterations.

## 5. Working in the same repository

Use one repository and separate local clones or worktrees. Do not share one mutable filesystem checkout or write concurrently in the VM deployment directory. The VM is the release target, not a shared development editor.

| Teammate | Branch pattern | Primary paths |
|---|---|---|
| Yildirim | feat/yildirim-i1-calendar, then the next iteration number | apps/web/components/calendar/ |
| Dogancem | feat/dogancem-i1-calendar-service | packages/core/calendar/, packages/core/scheduling/, packages/contracts/calendar.ts, apps/web/app/api/calendar/ |
| Kent | chore/kent-i1-release | Root manifests/lockfile, Docker/Compose, CI/scripts, identity, apps/web/app/calendar/page.tsx |
| Bartek | feat/bartek-i1-google-oauth | packages/db/, packages/core/integrations/google-auth/, apps/web/app/api/integrations/google/ |
| Catalin | feat/catalin-i1-study-workflow | apps/web/components/study/, apps/web/components/connections/, tests/e2e/ |

Add future directories under the same ownership pattern; announce a boundary change before editing a teammate's files. Bartek generates migrations after agreeing the schema; Kent alone updates root dependencies and the shared lockfile after receiving package requests. Dogancem owns scheduling schemas, and Catalin owns browser-test fixtures. No two people generate migrations or scaffolds independently.

Repo rhythm:

1. Start each iteration with a 10-minute check: confirm shipped baseline, five tasks, shared contracts, blockers, and acceptance gate. Keep tasks in a simple shared issue/board with owner, iteration, dependency, and done criteria.
2. Branch from updated main. Keep each PR focused on one handoff and small enough to integrate within 30–60 minutes; do not leave one whole-iteration branch until the end.
3. Request one peer review: Yildirim ↔ Catalin; Dogancem ↔ Bartek; Kent's infrastructure PRs reviewed by Bartek. Kent merges dependency/root changes first; non-conflicting feature PRs can merge after green checks.
4. Rebase or merge main into the feature branch before the next integration checkpoint. Resolve conflicts with the affected owner; never force-push main or rewrite teammates' published commits.
5. Reserve the end of each iteration for integration and a live acceptance run. Kent deploys the passing commit and records the release SHA/tag; Catalin records passed scenarios and any limitations.
6. All five verify the deployed increment before opening the next feature iteration. If the gate fails, fix the failed gate; optional work does not bypass it.

Minimum PR checks are typecheck, lint, targeted meaningful tests, and production build. Do not require planner, Telegram, LLM, or document tests before those subsystems exist. Run one live Google smoke test per release using a dedicated test event/account and clean up only PolyMate-owned test events.

## 6. Immediate task board

| ID | Owner | Task to start now | Dependency | Done when |
|---|---|---|---|---|
| CAL-01 | Kent | Bootstrap the workspace, app shell, identity boundary, and web/db Compose target. | None. | Everyone can run the app; managed VM serves the skeleton. |
| CAL-02 | Dogancem | Publish CalendarEvent / CalendarClient schemas and calendar operation stubs. | Contract agreement with Bartek; can draft before CAL-01 merges. | UI/fake adapter and real service share one contract. |
| CAL-03 | Bartek | Configure Google client and implement OAuth/token storage. | CAL-01 and minimum migration; provider setup starts immediately. | Managed-origin Google connect and refresh succeed. |
| CAL-04 | Yildirim | Implement the weekly view against CAL-02 fixtures. | CAL-02 for final integration. | Week navigation, event distinction, and selection work. |
| CAL-05 | Catalin | Implement the event dialog and live Google acceptance script. | CAL-02 for final integration. | Create/edit/move/done/delete callbacks and validation work. |
| CAL-06 | Dogancem | Implement real Google read/write operations and ownership/conflict checks. | CAL-02; CAL-03 token interface can be stubbed until integrated. | Existing commitments read correctly and PolyMate events change safely. |
| CAL-07 | Kent | Compose the page, merge the five handoffs, and deploy the candidate. | CAL-03–06. | Live managed-address journey is ready for acceptance. |
| CAL-08 | Catalin, with all five fixing defects | Execute the Google round-trip and failure cases. | CAL-07. | Kent can tag/deploy v0.1-calendar with evidence, then start iteration 2. |

These are implementation assignments for the human teammates. No application code, deployment, or messages to teammates are performed by this planning document.
