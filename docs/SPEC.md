# ETH Campus Companion — Project Spec Sheet

**Working name:** ETH Campus Companion  
**Product:** AI-assisted student life web application  
**Audience:** ETH Zurich students  
**Version:** 0.1 · 9 October 2026  
**Purpose:** Hackathon product and implementation specification

## 1. Product concept

Help students decide what to study, which lab projects to pursue, which campus events to attend, and which internships to explore through one personalised web application.

The app combines a shared student profile, a semester planner, and three opportunity discovery helpers. Students can browse recommendations or ask questions in a conversational interface. Every recommendation explains its fit, links to its source, and identifies missing information.

**Value proposition:** “Build a semester around your interests, and discover the opportunities that fit it.”

### Problem

Students must search separate course catalogues, programme documents, lab websites, event calendars, and job boards. These sources rarely connect academic requirements with personal interests, availability, skills, and career goals. The app brings those decisions together while keeping the original sources visible.

### Primary user stories

- As a student, I want a course plan that respects my degree requirements, completed courses, interests, and available time.
- As a student, I want to discover lab projects suited to my skills and intended project period.
- As a student, I want campus events that match my interests and fit my schedule.
- As a student, I want internships aligned with my skills, career interests, location, and availability.
- As a student, I want to understand and adjust recommendations before committing to anything.

## 2. Hackathon scope

The MVP must demonstrate all four helpers through one coherent journey. Depth is concentrated in the study planner; the other helpers share a recommendation pipeline and card UI.

**Assumptions:** English-first responsive web app; one explicitly selected ETH study programme and regulation version; one target semester; a small curated dataset; no existing ETH integration credentials. These are implementation assumptions, not verified access arrangements.

| Priority | Deliverable | MVP boundary |
|---|---|---|
| P0 | Shared student profile | Programme, study stage, interests, skills, availability, completed courses, goals |
| P0 | Study planner | Generate and edit a single-semester plan; validate supported rules and timetable conflicts |
| P0 | Lab project helper | Ranked projects from a small set of selected labs |
| P0 | Campus event helper | Ranked upcoming events with availability checks |
| P0 | Internship helper | Ranked internships from a verified curated source set |
| P0 | Explanations and sources | Source link, retrieval time, fit reasons, caveats on every recommendation |
| P0 | Shared dashboard | Plan summary, opportunity cards, saved items, scoped chat |
| P1 | Calendar export | Download an ICS file for selected courses or events |
| P1 | Feedback | Save, dismiss, and record a reason to improve subsequent ranking |
| Later | Expanded coverage | More programmes, multi-semester planning, more source adapters |
| Later | Connected services | Approved university sign-in, calendar sync, optional CV import, notifications |

**Out of scope for the hackathon:** automatic course enrolment, application submission, contacting supervisors or employers, inbox access, complete degree certification, and comprehensive coverage of ETH opportunities.

## 3. Core user journey

1. **Onboard:** Select programme, degree stage, target semester, interests, skills, completed courses, and availability. Optional fields can be skipped.
2. **Set planning constraints:** Specify target credits, weekly study budget, fixed commitments, preferred free periods, and career or research goals.
3. **Generate a plan:** Receive recommended courses, a timetable, credit totals, estimated workload, and validation results.
4. **Adjust:** Lock a course, remove another, or ask “Make Fridays lighter.” Regenerate around locked selections.
5. **Discover:** Review project, event, and internship cards that use the same profile and saved plan.
6. **Act:** Save an opportunity, export a calendar item, or open the original listing to enrol, register, contact, or apply.

**Example demo prompt:** “I’m interested in machine learning and sustainability. Help me plan next semester, find a relevant lab project, suggest an event next week, and look for a summer internship.”

The interface collects missing hard constraints before presenting a validated plan. Demo examples use a declared profile and dataset rather than implying eligibility for an unspecified degree.

## 4. Functional requirements

### 4.1 Shared student profile

Required for planning: programme, applicable curriculum version, target semester, completed courses or explicit ‘none entered’, credit target, and time budget. Discovery can begin with interests and availability alone.

Optional fields: specialisation, preferred language, skills and experience level, career goals, preferred campus, internship locations, remote preference, desired duration, and earliest start date.

Students can edit or reset their profile. Manual input is sufficient for the MVP; transcript and CV uploads are deferred. The interface distinguishes a confirmed requirement from a personal preference.

### 4.2 Study planner

**Inputs:** Student profile, semester-specific course records, structured programme requirements, completed courses, fixed commitments, and locked course selections.

**Behaviour:**

- Retrieve courses available in the selected semester and relevant to the supported programme.
- Check prerequisites, duplicate completions, supported curriculum categories, credit constraints, and known timetable overlaps using deterministic rules.
- Treat missing prerequisites, unresolved course equivalences, or incomplete timetable data as unknown; do not silently pass them.
- Rank feasible electives by interests, goals, schedule preferences, and workload estimates.
- Build a weekly timetable with contact hours and suggested self-study blocks.
- Explain why each course was selected and how it contributes to the plan.
- Replan after a constraint changes while preserving locked courses.
- If no feasible plan exists, show the conflicting constraints and offer specific changes. Never silently relax a hard constraint.

**Output:** Course list with codes and credits; category credit totals; weekly calendar; estimated workload; unmet or unknown requirements; alternative courses; source links.

Credit totals, contact hours, and weekly workload are separate measures. Self-study estimates are editable and labelled as estimates. A clash-free lecture timetable does not imply a clash-free exam timetable; exam conflicts are checked only when reliable dates are available.

**Validation status:** ‘Passes supported checks’, ‘Needs review’, or ‘Infeasible’. The UI lists which checks were actually performed. Planning supports student decisions; formal eligibility and enrolment remain with the programme and university systems.

### 4.3 Lab project helper

**Inputs:** Interests, skills, degree stage, desired project type, intended dates, and available effort.

**Behaviour:** Retrieve and deduplicate student project listings; filter explicit eligibility and timing constraints; rank by topic and skill fit; explain strengths and skill gaps.

**Output card:** Project title, lab, project type, topic summary, stated prerequisites, duration or workload if published, contact route, availability status, source, and fit explanation.

A lab research page is not automatically an open student position. If a page invites enquiries without a specific opening, label it ‘Enquire with lab’. Undated listings have ‘Availability unconfirmed’. Missing project duration or eligibility stays unknown.

### 4.4 Campus event helper

**Inputs:** Interests, date range, language, location preference, and saved timetable.

**Behaviour:** Retrieve upcoming events, filter by date, flag schedule conflicts, rank by interests, and provide practical attendance information.

**Output card:** Event title, organiser, start/end time, location, category, language, price and registration deadline if stated, conflict status, source, and recommendation reason.

Use `Europe/Zurich` for display and calendar export, preserving timezone offsets. If an end time is missing, mark schedule compatibility as uncertain. Travel buffers between campuses are configurable estimates. Do not claim whole-campus event coverage from one calendar.

### 4.5 Internship helper

**Inputs:** Skills, career interests, degree stage, desired start date, duration, location, and work arrangement.

**Behaviour:** Retrieve internship listings, remove duplicates and known expired postings, filter explicit constraints, and rank by skills, timing, and career fit.

**Output card:** Role, employer, location, work arrangement, required skills, duration, start date, deadline, compensation if published, source, skill gaps, and fit explanation.

Unknown dates, salary, or eligibility remain unknown. The app does not infer work authorisation or claim hiring probability. The primary action opens the employer or listing application page.

### 4.6 Shared assistant and recommendation cards

One conversational entry point routes requests to the planner or the relevant discovery tool. Four visible helper modes make the supported tasks clear without requiring four separately deployed agents.

Every recommendation includes:

- A concise summary and two or three evidence-backed fit reasons.
- Relevant constraints, conflicts, missing facts, or freshness concerns.
- Original source link and last successful retrieval time.
- Save, dismiss, and open-source actions.

Saved opportunities do not become busy calendar blocks until the student explicitly adds them. Saving or attending an event does not automatically rewrite the course plan.

## 5. Data sources and ingestion

The following public resources were identified on 9 October 2026. Their existence is verified; API access, scraping permission, licensing, completeness, and reliable machine-readable formats still require integration checks.

| Domain | Candidate source | MVP ingestion approach |
|---|---|---|
| Courses | [ETH Course Catalogue (VVZ)](https://ethz.ch/students/en/studies/academic-support/course-catalogue.html) and [catalogue](https://vvz.ethz.ch/Vorlesungsverzeichnis/gesamtverzeichnis.view?lang=en) | Import selected semester records with course codes and provenance |
| Programme requirements | Official study regulations and study guide for the selected programme | Manually encode and review a limited rule set; retain document version and section references |
| Lab projects | Selected lab pages, such as [Programming Methodology student projects](https://www.pm.inf.ethz.ch/education/student-projects.html); [ETH project guidance](https://ethz.ch/students/en/studies/study-abroad/project-traineeship/projects.html) also points to SiROP | Curate listings from two or three labs; investigate SiROP access separately |
| Events | [ETH event search](https://ethz.ch/en/news-and-events/events.html) | Import a small upcoming event set; add student association sources later |
| Internships | [ETH Career Center job portal directory](https://ethz.ch/studierende/de/karriere/Startseite_CareerCenter/Exploration_Stellensuche/Stellenplattformen.html), including ETH get hired | Verify access to actual listings; curate permitted public employer listings or use labelled synthetic fixtures |

**Ingestion pipeline:** fetch/import → extract → schema validation → normalise dates and identifiers → deduplicate → attach provenance → store → index.

Each source adapter handles its own schema and failures. Invalid records are quarantined for review. Store source URL, source item ID where available, publication/update date if supplied, retrieval time, and extraction status. Fetch time alone does not establish that a listing is still open.

The demo must run from a frozen snapshot if live sources fail. Show snapshot age; distinguish real sourced records from synthetic examples. Initial fixture targets: 20–40 courses, 8–12 projects, 10–20 events, and 10–20 internships. These are build targets, not claims about current availability.

## 6. AI and decision logic

**Use the language model for:** interpreting requests, mapping interests to topics, summarising retrieved listings, and explaining ranked results.

**Use application code for:** prerequisite and curriculum checks, timetable collision detection, credit arithmetic, deadlines, persistence, filtering, and calendar export.

Pipeline:

1. Parse the request into structured intent and constraints.
2. Retrieve records from the approved dataset.
3. Apply hard filters and deterministic validation.
4. Rank remaining candidates by preference fit.
5. Generate explanations from selected records and profile fields.
6. Validate structured output and ensure every recommended ID exists.

For discovery, start with a transparent weighted ranking across interest fit, skills or study-stage fit, timing, and location preferences. Weights are configuration values, not learned truths. Curriculum validity is a gate, not a ranking factor that can be outweighed by interests. Unknown constraints reduce certainty and surface a review flag.

If the dataset has no suitable results, say so and suggest changing a specific filter. Do not generate nonexistent courses, projects, events, or jobs. Avoid displaying a percentage ‘match’ until its meaning is defined and evaluated.

Treat retrieved page content as untrusted data. It cannot override system instructions, trigger tool actions, or access unrelated student data. Explanations cite source records; model-generated facts absent from those records are rejected or marked as estimates.

## 7. Proposed architecture

**Default implementation:** TypeScript web app with Next.js and React, PostgreSQL for structured records and user state, a server-side LLM adapter, and a small import script per source. An embedding index is optional; tag and text search are sufficient for a small demo dataset.

```text
Web UI
  └─ Application API
      ├─ Profile, saved items, and plan persistence
      ├─ Planner constraint validator
      ├─ Retrieval and recommendation service
      └─ LLM adapter for intent and explanation
             ↑
      Normalised database
             ↑
      Source adapters / curated imports
```

Keep model credentials server-side. Use validated structured responses, bounded retries, timeouts, cached retrieval, and a per-session request limit. A model failure still allows browsing records and viewing the saved plan.

Suggested endpoints:

| Endpoint | Purpose |
|---|---|
| `GET/PATCH /api/profile` | Read or update the current student's profile |
| `POST /api/plans/generate` | Generate a plan from profile and constraints |
| `PATCH /api/plans/:id` | Edit or lock course selections and revalidate |
| `GET /api/recommendations?type=project|event|internship` | Retrieve filtered, explained recommendations |
| `POST /api/chat` | Route a scoped student request |
| `POST/DELETE /api/saved-items/:id` | Save or remove an opportunity |
| `GET /api/calendar/export` | Export explicitly selected schedule items |

### Core data model

| Entity | Important fields |
|---|---|
| StudentProfile | user ID, programme/version, degree stage, interests, skills, completed course IDs, goals, availability, preferences |
| Course | ID/code, semester, title, credits, category mapping, prerequisites, language, meeting occurrences, source |
| ProgrammeRule | programme/version, rule type, required courses/categories, credit bounds, source section, review status |
| StudyPlan | owner, semester, selected and locked course IDs, constraints, time blocks, validation findings, version |
| Opportunity | ID, type, title, organisation, description, tags, requirements, dates, location, status, source |
| Recommendation | user ID, item ID, ranking components, reasons, missing facts, profile/plan version, generated time |
| SavedItem | owner, item ID, saved time, optional calendar selection |
| SourceRecord | URL, external ID, retrieved time, source update time, extraction status, snapshot identifier |

Projects, events, and internships share common opportunity fields with type-specific schemas. Missing values are nullable, not fabricated defaults. Recommendations are invalidated when relevant profile or plan fields change.

## 8. Interface specification

| Screen | Main elements |
|---|---|
| Onboarding | Short form, interest chips, study details, availability, sample-profile option |
| Dashboard | Semester summary, next useful actions, recommendation groups, chat entry |
| Study planner | Course list, weekly calendar, constraints panel, credits, validation findings, lock/remove controls |
| Discover | Projects / Events / Internships tabs, filters, recommendation cards |
| Item detail | Source-grounded description, fit explanation, missing information, original listing action |
| Saved items and settings | Saved opportunities, profile editing, calendar export, data reset |

Use a clean student-facing visual style, responsive layouts, readable typography, keyboard-accessible controls, and explicit loading, empty, error, and stale-data states. English UI may display German source titles; translated summaries are labelled. An AI response must not obscure the source link or validation warnings.

## 9. Privacy, reliability, and quality targets

- Collect only data needed for recommendations. Interests and manually entered skills are enough for discovery.
- For the hackathon, use a sample profile or isolated anonymous session; define accounts and university sign-in later.
- Isolate profiles, plans, and saved items by session/user. Provide reset/delete controls.
- Send only necessary profile fields and selected source excerpts to the model provider; avoid raw personal documents.
- Do not include personal profile contents in routine logs. Log timings, errors, item IDs, and validation outcomes.
- Refresh cadence is source-specific. For an operational pilot, target daily opportunities refreshes and semester-based course imports with periodic update checks.
- Target cached browsing under 2 seconds and AI generation under 15 seconds on the demo dataset; measure rather than promise these numbers.
- Clearly surface partial source failures, unsupported requirements, and stale records.

## 10. Acceptance criteria

| Feature | MVP passes when… |
|---|---|
| Onboarding | A student can create and edit a profile and use a sample profile without personal documents |
| Course planning | Selected courses exist in the selected semester snapshot; credits are correct; supported curriculum and prerequisite checks run |
| Schedule checking | Known time overlaps are flagged; incomplete schedules produce ‘Needs review’ |
| Replanning | Locked courses remain selected, or the app explains why the resulting constraints are infeasible |
| Project discovery | Returned cards are source-backed; skill gaps and unconfirmed availability are visible |
| Event discovery | Known past events are excluded; schedule conflicts and timezone handling are correct |
| Internship discovery | Known expired or explicitly incompatible listings are excluded; unknown eligibility is flagged |
| AI grounding | All recommendation IDs resolve to stored records; factual card fields come from those records |
| Personalisation | Changing an interest or availability constraint changes the relevant ranking or eligibility result |
| Failure handling | Cached data remains browsable when a source or model call fails |
| Persistence | Profile, plan, and saved items survive reload and remain isolated between users/sessions |

Test with a small labelled scenario set: feasible plan, impossible credit target, unmet prerequisite, locked-course conflict, missing timetable, expired internship, event timezone boundary, duplicate listing, source outage, and prompt injection in retrieved content. Review recommendation relevance against manually selected expected matches.

## 11. Hackathon delivery plan

Indicative allocation for a 24–48-hour build, adjusted to team size:

1. **First 15%:** Choose one programme and semester; freeze scope; define schemas; curate verified source records and programme rules.
2. **Next 30%:** Build onboarding, database, dashboard, source provenance, and deterministic planning checks.
3. **Next 30%:** Add ranking, model explanations, scoped chat, and all three discovery tabs.
4. **Next 15%:** Integrate replanning, saved items, fallback states, and essential scenario tests.
5. **Final 10%:** Polish, rehearse, and freeze a reproducible demo snapshot. Add ICS export only if P0 is complete.

Suggested ownership: frontend/product; data ingestion and rules; backend/planner; AI integration and evaluation. These are workstreams, not a requirement for four team members.

### Three-minute demo

- Load a declared sample student profile and generate a semester plan.
- Show credit totals, supported checks, and a source-backed course explanation.
- Change one availability constraint and demonstrate replanning.
- Show one relevant lab project, one compatible event, and one internship with a skill gap.
- Save an item and open its source. Close with the connected value: academic choices inform campus and career discovery.

## 12. Risks and decisions before implementation

| Risk or decision | Resolution |
|---|---|
| Which programme and regulation version? | Select one before encoding curriculum rules |
| Meaning of ‘time frame’? | MVP supports target semester plus weekly availability; opportunity helpers also use start/end dates |
| Source access or inconsistent HTML | Validate adapters early; retain curated snapshots with provenance |
| Incomplete degree rules | State supported checks and unknowns; manually review the encoded subset |
| Outdated openings or event details | Show freshness and uncertainty; link to original listings |
| Four helpers create too much scope | Share retrieval, ranking, explanations, and UI components |
| Model fabricates or ignores constraints | Validate record IDs and facts; keep constraints in application code |
| Demo depends on live services | Ship a reproducible snapshot and non-AI browsing fallback |

**MVP completion definition:** A student can enter a profile, generate and modify a plan for the supported programme, receive source-backed recommendations in all three opportunity categories, understand the limits of each result, and save or follow through on a recommendation.
