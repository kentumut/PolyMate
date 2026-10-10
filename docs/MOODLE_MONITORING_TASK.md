# Task: Moodle connection and recurring checks

Branch: `codex/moodle-ai-integration`

Build on the existing [Moodle integration](MOODLE_AI_INTEGRATION.md) so the study companion checks for assignments occasionally, notices meaningful changes and shares them with the main agent.

## Deliverables

- Preserve and integrate the token connection, assignment/announcement retrieval, timeline tools and owner-scoped calendar dispatch already implemented.
- Replace browser-only credentials for scheduled execution with an encrypted, per-owner credential repository. Keep interactive connections compatible, support disconnect/revocation, and expose actionable expired/denied-access status without leaking tokens.
- Normalize and retain assignment and announcement snapshots per owner, site and stable Moodle ID. Track retrieval time and partial-access/truncation warnings.
- Compare successful snapshots to detect new assignments, changed verified deadlines, changed requirements and new announcements. Do not interpret an inaccessible/partial response as deletion; do not infer a new official deadline from announcement prose.
- Use the shared automation interface from the agent branch to register two daily checks in Europe/Zurich. Permit an on-demand refresh from chat. Keep timings configurable; scheduled checks continue without an open browser.
- Emit durable, deduplicated change events for the agent/digest workflow. An unchanged snapshot produces no repeated alert. Retry transient errors with bounded backoff and prevent overlapping checks for the same owner.
- Respect pause/disconnect and backend authorization. A scheduled job cannot select another student's connection or use proxy headers supplied by an untrusted caller.

## Acceptance criteria

- A new assignment and a changed deadline are detected once and include source links and timestamps.
- Repeated unchanged checks remain quiet; retries do not duplicate changes or calendar blocks.
- Partial forum access still permits assignment checks with an explicit warning. A failed/partial assignment fetch preserves the last known successful records.
- Disconnect stops future token use; paused monitoring stops scheduled checks; expired tokens prompt reconnection rather than repeated failing runs.
- Tests cover snapshot comparison, identity isolation, encrypted credential handling, overlapping runs, partial results and retry deduplication.
- Document and demonstrate one authorized live check. Do not label fixtures as live ETH integration.

Dependency: shared backend agent/automation contracts in [STUDY_COMPANION_BRANCHES.md](STUDY_COMPANION_BRANCHES.md). Database changes and deployment configuration require coordination with the owners described in CONTRIBUTING.md.
