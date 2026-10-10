# ETH Campus Companion — Implementation Plan

**Date:** 9 October 2026  
**Source specification:** [SPEC.md](./SPEC.md)  
**Target:** A demonstrable hackathon MVP covering study planning, lab projects, campus events, and internships.

## 1. Implementation approach

Complete a chat-first MVP in the first two waves, within four hours. Chat has the highest implementation priority: demonstrate a real message/reply by minute 60, then route all four helpers through the conversation. The journey is chat → shared profile/clarification → real VVZ course draft → projects/events/internships → grounded explanation → contextual follow-up → save. Use cached/curated JSON, browser-local state, and one server-side chat endpoint with structured intent routing. Reviewed curriculum rules, timetable screens, and richer discovery come later.

The repository currently contains the specification and no application implementation. The deadline is **Sunday, 11 October 2026, at 12:00 Europe/Zurich**. The authoritative sprint scope and completion checks are in [TIMELINE.md](./TIMELINE.md): Waves 1–2 produce the MVP in at most four team elapsed hours, with a suggested Saturday 08:30–12:30 sprint and sleep protected on both nights. The detailed engineering backlog below is the broader roadmap, not the four-hour sprint checklist. It assumes roughly three or four contributors; a solo build needs a smaller scope or more time.

### Working defaults

| Area | Proposed choice |
|---|---|
| Application | Next.js, React, TypeScript; one app with server-side API routes |
| UI | Tailwind CSS; shared form, card, status, and calendar components |
| Storage | MVP: cached/curated JSON plus browser-local profile and saves; later: PostgreSQL with Prisma migrations |
| Data validation | Zod schemas at API, import, and model-response boundaries |
| AI | Provider-neutral server-side adapter; configure provider/model and credentials through environment variables |
| Retrieval | Structured filters plus tag/text matching; embeddings deferred |
| Planning | Pure TypeScript constraint validation and bounded search over the small supported catalogue |
| Verification | Vitest for rules and adapters; Playwright for a small set of critical browser flows |
| Identity | MVP: browser-local demo profile, no accounts; later: anonymous session cookie and server-scoped ownership |

Do not introduce separate microservices or a multi-agent runtime for the MVP. Four helper modes call shared application services.

### Decisions to resolve during setup

- Select one programme, regulation version, and target semester before implementing degree rules. Use a D-INFK programme as a provisional demo direction; confirm its actual rules rather than deriving them from department membership.
- Select the AI provider and confirm credentials before the sprint where possible; keep credentials server-side. Database provisioning is deferred from the four-hour MVP.
- Choose a small set of public lab, event, and internship listings. Use curated imports for these categories initially.
- Decide the hosting target before the final deployment task. Local operation is the initial completion target.

Framework setup, data contracts, and VVZ adapter work can proceed while programme selection is pending. Curriculum validation must wait for reviewed programme rules.

## 2. Milestones and dependencies

| Wave | Deliverable | Dependency |
|---|---|---|
| 1 — Hours 0–2 | Working AI chat, scoped routing, contextual follow-up, first sourced result, shared data contracts | — |
| 2 — Hours 2–4 | All four helpers inside chat, basic planning, grounded explanations, local saves, verified MVP | Wave 1 |
| 3 — Saturday early afternoon | Reviewed planner checks, timetable, locks and replanning | MVP |
| 4 — Saturday afternoon | Richer opportunity filters, sources, and event compatibility | MVP; Wave 3 for plan conflicts |
| 5 — Saturday late afternoon/early evening | Better conversation quality and richer planner edits | MVP chat; Wave 3 for richer plan edits |
| 6 — Saturday evening, finish by 22:00 | Stabilisation, failure checks, feature freeze | MVP and completed enhancements |
| 7 — Sunday morning, ready by 11:30 | Final fixes, rehearsal, delivery | Wave 6 |

**MVP critical path:** chat UI and server response → scoped routing and context → sourced helper services → grounded chat cards → conversation verification. Data work proceeds in parallel. Subsequent waves improve the verified MVP.

The following M0–M7 sections are engineering work packages, not the new wave numbers. Use TIMELINE.md for sprint order and scope; complete these broader backlog items only when selected for later improvements.

## 3. Ordered implementation backlog

### M0 — Scaffold and contracts

- [ ] Initialise the application, dependency lockfile, TypeScript, linting, and environment validation.
- [ ] Add `.env.example` for `DATABASE_URL`, model configuration, and API credentials; ignore local secrets.
- [ ] Define shared schemas for profile, course, teaching component, meeting occurrence, programme rule, opportunity, plan, recommendation, and validation finding.
- [ ] Implement an explicit validation result model: `pass`, `fail`, or `unknown` per check; aggregate to ‘Passes supported checks’, ‘Infeasible’, or ‘Needs review’.
- [ ] Define interfaces for `CatalogueRepository`, `PlannerService`, `RecommendationService`, and `AssistantProvider` so UI work can use fixtures before live integrations are ready.
- [ ] Create a minimal app shell with Dashboard, Planner, Discover, and Saved navigation.
- [ ] Establish development commands for run, build, lint, typecheck, tests, migrations, and seeding. Document them in the README.

**Done when:** The app runs locally, can connect to the database, and renders a fixture recommendation through the shared contract.

### M1 — VVZ catalogue integration and programme rules

- [ ] Implement a server-only client for the documented [VVZ API](https://vvzapi.ch/docs), with timeouts, bounded retries, response validation, and limited concurrency.
- [ ] Load available semesters from `/api/v1/misc/semesters`.
- [ ] Page through `/api/v1/unit/list` using `semkez`, `limit`, and `offset`; hydrate each ID through `/api/v1/unit/{unit_id}/get` and `/api/v1/course/get/{unit_id}`.
- [ ] Use unit/section relationships to select the supported catalogue subset; include relevant cross-department courses. Avoid treating a department filter as programme eligibility.
- [ ] Preserve upstream unit ID, semester, course number, original catalogue URL, upstream scrape time, retrieval time, and snapshot identifier.
- [ ] Normalise null credits, descriptions, restrictions, teaching components, group schedules, and meeting times. Preserve raw source payloads for diagnosing extraction errors.
- [ ] Expand schedules only where recurrence is known. Define semester teaching dates explicitly; unresolved biweekly parity, group selection, or semester-half rules remain unknown.
- [ ] Save a versioned snapshot and import report. Make reimport idempotent, quarantine invalid records, and retain the previous good snapshot if refresh fails.
- [ ] Select 20–40 useful real course records for the demo; ensure some have usable schedules and some demonstrate missing-data handling.
- [ ] Encode a manually reviewed programme-rule subset with regulation version and source sections. Add explicit course/category mappings and reviewed prerequisite/completion equivalences.
- [ ] Separate semester planning constraints from graduation-wide requirements. Calculate any remaining degree requirements against entered completions without implying full degree certification.

**Done when:** A repeatable import produces browsable semester-specific courses, source links, and a reviewed rule file. Missing schedules and unreviewed prerequisites are reported as unknown.

### M2 — Profile and persistence

- [ ] Create database tables and migrations for profiles, courses, rules, opportunities, plans, saved items, recommendations, and source records.
- [ ] Create a random anonymous session ID in an HTTP-only cookie. Resolve ownership server-side and scope every user-state query to that identity.
- [ ] Implement profile read/update endpoints and schema validation.
- [ ] Build onboarding for programme/version, semester, interests, skills, completed courses, credit target, weekly time budget, and fixed commitments.
- [ ] Provide a declared sample student profile and profile reset controls.
- [ ] Add profile and plan version numbers for invalidating stale recommendations.
- [ ] Implement reload persistence, reset/delete behaviour, and clear validation messages.

**Done when:** Profile changes survive reload, sample onboarding works, and two browser sessions cannot read or mutate one another's data.

### M3 — Deterministic study planner

- [ ] Implement pure functions for credit arithmetic, duplicate-completion checks, reviewed prerequisites, category requirements, semester availability, time budget, and known meeting conflicts.
- [ ] Rank eligible candidates by interests and preferences; retain unknown candidates only with visible review findings.
- [ ] Generate candidate plans using bounded backtracking or beam search over the small dataset. Include locked courses first and prune known-invalid combinations.
- [ ] Distinguish an exhaustive ‘no feasible plan’ result from a search timeout/budget exhaustion. An incomplete search must not claim proven infeasibility.
- [ ] Return selected IDs, credit/category totals, estimated workload, supported checks, findings, and alternatives. Use stable tie-breaking for reproducible demos.
- [ ] Implement plan generation and edit endpoints. Require the current plan version on writes to avoid overwriting a newer edit.
- [ ] Build course list, constraints panel, weekly calendar, lock/remove controls, and validation summary.
- [ ] Treat teaching groups as alternatives where appropriate, not simultaneous mandatory blocks. Keep unresolved group choices visible.
- [ ] Place editable self-study estimates around known commitments; show unplaced workload if available time is insufficient.
- [ ] Regenerate after changes while preserving locked selections; return actionable conflict explanations if locks prevent a feasible result.

**Done when:** A sample student can generate a plan, lock a course, change availability, and regenerate with correct totals and explicit conflicts/unknowns. Validation succeeds without an LLM.

### M4 — Opportunity discovery and shared ranking

- [ ] Create typed JSON import formats for lab projects, events, and internships, each with provenance and nullable unknown fields.
- [ ] Curate 8–12 projects, 10–20 events, and 10–20 internships where feasible. Label synthetic fixtures explicitly if real records are insufficient; exclude them from claims of live coverage.
- [ ] Deduplicate by source ID/canonical URL, using organisation/title/date only as a reviewed fallback.
- [ ] Implement hard filters for explicit eligibility, dates, duration, location, and work arrangement; maintain an injected clock for reproducible date-based tests.
- [ ] Implement event conflict checks against the saved timetable in `Europe/Zurich`. Missing event end times produce unknown compatibility.
- [ ] Add transparent weighted ranking for interest, skill, timing, and location fit. Return score components internally and evidence-backed reason labels to the UI.
- [ ] Build Discover tabs, filters, reusable cards, details, and source/freshness indicators.
- [ ] Implement idempotent save/remove actions and a Saved page. Saving alone does not add a commitment to the timetable.
- [ ] Refresh affected rankings when profile or plan versions change.

**Done when:** All three categories produce source-backed results, exclusions work, unknowns are visible, and saved items survive reload.

### M5 — AI explanations and conversation

- [ ] Implement provider configuration and a model-independent interface for structured intent parsing and grounded explanations.
- [ ] Define allowed intents: generate plan, adjust plan constraints, find projects, find events, find internships, explain a result, and request missing information.
- [ ] Pass only necessary profile fields and retrieved candidates to the model; treat source text as untrusted content.
- [ ] Let application code retrieve/filter/rank results. Do not let model output bypass checks or create arbitrary catalogue entries.
- [ ] Render factual card fields from stored records. Validate model-selected IDs and structured reason references against the supplied candidate set; use deterministic reason templates for unsupported explanations.
- [ ] Translate requests such as ‘Make Fridays lighter’ into a proposed constraint edit. Show the resulting plan and revalidate before saving it; request clarification if the meaning changes a hard constraint ambiguously.
- [ ] Add chat to the dashboard with visible helper mode, missing-input prompts, loading state, timeout handling, and bounded request/context sizes.
- [ ] Cache explanations against item, profile, plan, and source versions. Fall back to rule-generated reasons if the model is unavailable.

**Done when:** The four helper modes respond to scoped requests, remain grounded in stored data, and fail gracefully. Course validation and opportunity browsing still work without the model.

### M6 — Integration and verification

- [ ] Connect the dashboard to profile, latest plan, recommendation groups, and saved items.
- [ ] Add empty, stale, partial-data, API-failure, model-failure, and no-feasible-plan states across the UI.
- [ ] Review keyboard navigation, labels, mobile layout, calendar readability, and source-link visibility.
- [ ] Add focused tests for planner rules, recurrence, imports, ownership, expiry, and output grounding. Avoid tests that simply mirror UI markup.
- [ ] Run the full sample-student journey and fix integration failures.
- [ ] Measure cached browsing and AI latency against the spec's targets. Record actual results and remaining limitations.
- [ ] Complete production build, typecheck, lint, and relevant automated tests; verify secrets do not enter client bundles or logs.

**Done when:** All P0 acceptance criteria pass or have an explicitly documented data-coverage limitation. No silent bypass of hard constraints or user ownership is accepted.

### M7 — Demo and handoff

- [ ] Freeze a known-good snapshot, reviewed rules, and sample profile; record source timestamps.
- [ ] Add a demo reset command that restores the declared sample state without affecting unrelated user data.
- [ ] Write a README covering setup, environment variables, migrations, import/seed commands, supported programme, model fallback, and known limitations.
- [ ] Rehearse the three-minute demo: profile → plan → replan → project → event → internship → saved source-backed item.
- [ ] Test with VVZ and the model unavailable; show the cached-data and deterministic-explanation fallbacks.
- [ ] Prepare local startup instructions. If a hosting target has been selected, prepare and verify the build/configuration before publishing under the user's deployment instructions.

**Done when:** Another teammate can start the app, reproduce the demo, and identify which sources and checks are supported.

## 4. Proposed code layout

```text
src/
  app/                    # Onboarding, dashboard, planner, discover, saved, API routes
  components/             # Forms, cards, source/status badges, weekly calendar, chat
  lib/
    contracts/            # Shared schemas and API response types
    db/                   # Database and ownership-scoped queries
    session/              # Anonymous session identity
    vvz/                  # Client, response schemas, normalisation, import logic
    planner/              # Rules, scheduling, candidate search, explanations
    recommendations/      # Retrieval, filtering, ranking, invalidation
    ai/                   # Provider adapter, prompts, grounded-output validation
    time/                 # Timezone and recurrence helpers
data/
  programme-rules/         # Reviewed, versioned rules with provenance
  opportunities/          # Curated source-backed import records
  snapshots/              # Reproducible catalogue fixtures
scripts/                  # Catalogue import, opportunity import, seed, demo reset
prisma/                   # Schema and migrations
tests/                    # Focused unit/integration and browser scenarios
```

Keep generated snapshots separate from manually reviewed rules. Record snapshot size before committing large raw datasets.

## 5. Verification matrix

| Scenario | Required result |
|---|---|
| Feasible reviewed course set | Correct credits; only supported checks reported as passed |
| Missing prerequisites or timetable | ‘Needs review’; no fabricated eligibility or meetings |
| Conflicting locked courses | Locks retained; explicit conflict; no silent relaxation |
| Search budget exhausted | Incomplete search reported separately from proven infeasibility |
| Alternative tutorial groups | Only the chosen group contributes scheduled meetings |
| Semester-half and biweekly meetings | Actual recurrence used, or uncertainty shown |
| Repeated VVZ import | No duplicate records; prior good snapshot survives failed refresh |
| Past event or expired internship | Excluded using the test clock and correct timezone |
| Profile/plan updated | Old recommendation cache invalidated |
| Unknown model ID or injected source instruction | Output rejected/fallback used; no arbitrary action |
| Model or upstream API unavailable | Cached browsing and saved plans remain usable |
| Two sessions, including guessed record IDs | Each session reads and edits only its own state |

## 6. Work allocation and scope control

| Workstream | Initial ownership | Integration responsibility |
|---|---|---|
| Product/frontend | Onboarding, shell, cards, planner calendar | Complete user journey and demo |
| Data | VVZ adapter, curated listings, programme rules | Provenance, completeness, reproducible snapshots |
| Backend/planner | Persistence, sessions, constraints, search | Correctness and cross-user isolation |
| AI/verification | Intent, explanations, scenario fixtures | Grounding, fallbacks, critical flow checks |

These are team workstreams; they can be combined for a smaller team. Share contracts at M0 and integrate at every milestone instead of waiting until the final day.

If time is tight, reduce catalogue size and source coverage, use simple weighted text/tag matching, retain curated imports for opportunities, and simplify the calendar to a readable weekly grid. Preserve all four helpers, source links, validation findings, saving, and the AI request flow. Defer ICS export, continuous scraping, embeddings, university sign-in, CV uploads, and multi-semester optimisation.

**First implementation task:** Build the chat shell and server endpoint from Wave 1 in TIMELINE.md; target a real message/reply by minute 60. By hour four, demonstrate all four helpers through chat, source-backed explanations, and a contextual follow-up. Defer standalone screens, the database, and richer planner work until that MVP works.
