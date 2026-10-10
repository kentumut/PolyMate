# Wave plan — Four-hour MVP, then improvements

**Final deadline:** Sunday, 11 October 2026, 12:00, Europe/Zurich.  
**MVP deadline:** End of Wave 2, within four hours of starting Wave 1.  
**Suggested MVP sprint:** Saturday 08:30–12:30, with no overnight dependency.  
**Sleep protected:** Friday 22:00–Saturday 08:00 and Saturday 23:00–Sunday 08:00.  
**Assumption:** Three or four contributors working in parallel, with model credentials available. These are team elapsed hours, not four person-hours.

Friday evening is optional preparation: choose the demo programme/semester, obtain credentials, and assign owners. Nothing required for the MVP is assigned during the night. The four-hour sprint includes setup, integration, and verification; do not let setup become an extra uncounted wave.

## Four-hour MVP scope

Ship a small complete journey across all four helpers:

- **Chat is the primary interface and highest-priority feature:** message history, input, loading/error states, suggested prompts, follow-up questions, and source-backed result cards inside the conversation.
- A short student profile: interests, skills, programme/semester, credit target, completed courses, and availability.
- A basic course shortlist/semester draft using 10–15 real VVZ records, correct credit totals, completed-course exclusion, and explicit flags for unverified prerequisites or schedule constraints.
- Three discovery categories with at least three source-backed records each: projects, events, and internships.
- Shared interest/skill filtering and AI-assisted explanations using only the retrieved records.
- Source links, visible unknowns, local saving, and a working sample profile.

**Simplifications:** One chat page with a compact profile panel and four suggested helper prompts; curated opportunity JSON; cached VVZ JSON; browser-local profile and saved items; one server-side chat endpoint with a small structured intent router. Dedicated helper tabs, a full planner screen, database provisioning, accounts, vector stores, and crawlers are deferred. Keep private state in the student's browser and out of shared server caches. Model credentials stay server-side.

The course result is labelled a **draft**, with a list of checks performed. Full curriculum compliance, timetable generation, and automatic conflict-free optimisation are later improvements. An unavailable AI provider produces a clearly labelled rule-based fallback; that is a partial MVP until a real AI request is demonstrated.

## Wave 1 — Get a working AI chat and data foundation

**Budget:** 0:00–2:00. **Suggested slot:** Saturday 08:30–10:30.

1. **First 15 minutes:** Agree chat request/response schemas, supported intents, profile fields, and result-card shape. Assign frontend/chat, AI/router, and data/planning owners. A fourth contributor handles opportunity curation and verification.
2. **Next 45 minutes, in parallel:** Build the chat shell and server endpoint; demonstrate a real user message and AI reply; fetch a small VVZ dataset; create profile and opportunity fixtures. **By minute 60, text chat should work end to end.**
3. **Next 45 minutes:** Add scoped routing for courses, projects, events, internships, and explain-result requests; pass the profile and a bounded recent conversation history; add clarification for missing inputs. In parallel, cache real courses, curate three records per opportunity category, and prepare deterministic services.
4. **Final 15 minutes:** Connect at least one helper to chat and render a source-backed recommendation card in the conversation. Verify loading/error states, source links, and one contextual follow-up.

**Done when:** A student can send a message, receive a real AI reply, ask a contextual follow-up, and view at least one sourced helper result inside chat. All four datasets and service contracts are ready for Wave 2. Fixtures remain visibly labelled where used.

**Timebox:** If VVZ fetching stalls, use a small previously retrieved real snapshot with a timestamp. If AI setup fails, keep a labelled fallback and assign one owner to resolve it during Wave 2. Keep the UI moving against the agreed contracts.

## Wave 2 — Connect recommendations and prove the MVP

**Budget:** 2:00–4:00. **Suggested slot:** Saturday 10:30–12:30.

1. **First 45 minutes, in parallel:** Connect all four helper services to chat. Implement deterministic course selection and credit totals, opportunity filtering/ranking, local profile/saves, and grounded explanations. Use suggested prompts as shortcuts into the same chat flow.
2. **Next 30 minutes:** Support one-turn-at-a-time requests and follow-ups such as ‘Only events next week’ or ‘Why this project?’. Keep structured filters and selected result IDs in conversation state; validate IDs and proposed profile changes. Render facts from records, expose unknowns, and exclude known expired opportunities.
3. **Next 25 minutes:** Test the chat journey: ‘Plan my semester’ → clarification if needed → course draft → ‘Find a related lab project’ → events → internships → explain → save → reload. Test correct credits, unknown intents, invalid AI IDs, empty results, and API/model failure. Fix blockers.
4. **Final 20 minutes:** Run build/typecheck and relevant focused checks; rehearse a 90-second demo; save a known-good snapshot and document what is supported.

**Done when:** All four helpers are usable through chat with actual stored records, a shared profile, grounded AI explanations, and at least one contextual follow-up. Sources and unknowns are visible, saved items survive reload, and the app builds successfully. Standalone browsing screens cannot substitute for this chat acceptance check.

**At hour four:** Freeze the MVP candidate. If a completion check fails, record it as incomplete and prioritise that fix before enhancements. Do not silently extend the sprint or claim a static fixture screen is the finished MVP.

## Wave 3 — Improve the planner

**When:** Saturday early afternoon, after lunch. **Budget:** About 1¾ hours.

1. Review a limited programme-rule and prerequisite subset with source references.
2. Add known meeting conflict checks, a simple weekly grid, and explicit unknown recurrence/group findings.
3. Add lock/remove and replanning controls. Preserve locked courses and distinguish infeasibility from incomplete search.
4. Verify one feasible plan and one conflicting request.

**Done when:** The basic course draft gains useful scheduling and reviewed validation without hiding unsupported checks.

## Wave 4 — Improve opportunity quality

**When:** Saturday afternoon. **Budget:** About 2 hours.

1. Expand curated listings only where source quality is adequate; preserve timestamps and unknown availability.
2. Add type-specific filters, details, skill gaps, and event compatibility against known plan meetings.
3. Improve ranking and stale-data indicators; confirm interests and availability affect the appropriate results.
4. Verify expiry and timezone handling.

**Done when:** Recommendations are more useful and contextual across all three categories.

## Wave 5 — Improve conversation quality

**When:** Saturday late afternoon/early evening. **Budget:** About 1 hour.

1. Improve intent recognition and follow-ups against real demo conversations; add compound requests only if the basic flow is reliable.
2. Connect richer planner edits from Wave 3 to chat, previewing constraint changes before saving.
3. Improve answer brevity, progress feedback, context trimming, and recovery from ambiguous questions.
4. Test longer conversations, changing interests, and cross-helper references without leaking stale constraints.

**Done when:** The existing MVP chat becomes more reliable and expressive. Basic chat, routing, and contextual follow-ups were already completed in Waves 1–2; persistent long-term conversation memory remains deferred.

## Wave 6 — Stabilise and freeze

**When:** Saturday evening, finish development by 22:00. **Budget:** About 2 hours, plus dinner.

1. Run the complete journey and fix correctness, persistence, and integration blockers.
2. Check mobile/keyboard usability and test upstream/model failures.
3. Run build, typecheck, lint, and focused checks; freeze code, source snapshots, and sample profile.
4. Rehearse the three-minute demo and write startup/reset instructions.

**Done when:** A reproducible demo candidate is ready. Stop adding features and protect Saturday-night sleep.

## Wave 7 — Rehearse and deliver

**When:** Sunday morning. **Budget:** About 3 hours, plus breakfast and submission buffer.

1. Start from a clean demo state; fix only blockers and rerun affected checks.
2. Freeze code and data by 10:00.
3. Rehearse twice; prepare screenshots or a backup recording; verify the presenting machine and any already-arranged hosting.
4. Be ready by 11:30; use 11:30–12:00 for submission and contingencies.

**Done when:** Required deliverables are submitted before Sunday noon.

## Scope and dependency rules

Waves 1–2 are the chat-first MVP. If time is tight, reduce record counts, filters, and visual polish while preserving working chat, all four helper routes, grounded results, and sources. Waves 3–5 improve it and can be shortened or skipped if integration fails. Waves 6–7 are protected verification and delivery work.

Database-backed accounts and cross-device persistence, ongoing ingestion, calendar export, embeddings, extra programmes, CV uploads, and multi-semester optimisation are deferred. The full engineering backlog in [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) remains a roadmap; it is not a requirement to complete every item before Sunday.
