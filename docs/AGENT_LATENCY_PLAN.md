# Agent latency: measurement and plan

Feedback from iteration 2: the planning chat is slow. This document records what we measure, how to run the measurement, where we think the time goes, and what we change in which order. Record every measured result in the [results log](#results-log) so before/after comparisons stay honest.

## Where we think the time goes

A chat turn is: browser → `POST /api/agent/chat` → OpenClaw gateway → OpenAI. Each tool the model calls goes back through a signed callback (`/api/internal/agent/tools`) and returns to the model, and the model runs again.

| # | Hypothesis | Code | Confirmed by |
|---|---|---|---|
| H1 | **Tool calls run one after another, and each one costs a full model round trip.** A planning turn is often connections → Moodle → calendar → plan → reply: about 5 model steps, each re-reading the prompt, the tool definitions and the history. | `foregroundTool` refuses parallel tools ([agent-runtime.ts](../apps/web/lib/agent-runtime.ts)); cap of 8 tools per turn ([contracts.ts](../packages/core/agent/contracts.ts)) | `toolCalls` ≥ 3 and `modelSteps` dominate `totalMs` |
| H2 | **Nothing streams.** The student sees nothing until the final token. This affects perceived speed, not total time. | `stream: false` in `callOpenClawAgent` | Not measurable server-side; judged in the UI |
| H3 | **Prompt caching is defeated.** `Current time: <ISO timestamp>` sits in the second system message, before the history, so everything after it changes on every call. | `callOpenClawAgent` | `cachedPromptTokens` low relative to `promptTokens` on the later steps of a turn (only if the gateway passes `usage` through) |
| H4 | **History may be sent twice.** We send the last 12 messages and also pass `x-openclaw-session-key`. If OpenClaw keeps its own transcript (including tool results), the prompt grows each turn. | `callOpenClawAgent` | `promptTokens` grows across a conversation much faster than `historyChars` |
| H5 | **Setup tools are repeated every turn.** Connections, Moodle and calendar are fetched again on each new message. | Model behaviour | The same tool names repeat in consecutive turns |
| H6 | **The tools are slow, not the model.** Moodle feed or Google API latency. | `executeMoodleTool`, `calendarServiceFor` | `toolMs` is a large share of `totalMs`; see `agent_tool` per tool |
| H7 | **The model or reasoning level is too slow per step.** | `POLYMATE_LLM_MODEL`, `POLYMATE_LLM_THINKING` | Per-step time (`modelStepMs`) is high even with few tools |

## What is logged

Every chat turn now produces structured JSON log lines on the web container (`docker compose logs web | grep agent_`). They contain **only timings, sizes, tool names, and token counts**: no message text, tool arguments, owner IDs, or session keys. A random `turnId` ties the lines of one turn together.

**`agent_tool`**: one per tool callback, logged when the tool finishes.

| Field | Meaning |
|---|---|
| `turnId` | Random ID of the chat turn |
| `index` | 1 for the first tool in the turn, 2 for the second, … |
| `name` | Tool name |
| `ms` | Time spent inside PolyMate for this tool (Moodle, Google, database) |
| `outcome` | `ok` or `error` (including policy refusals such as missing consent) |
| `resultBytes` | Size of the JSON returned to the model; large results make the next model step slower |
| `background` | `true` for scheduled (cron) runs, which have no chat turn |

**`agent_turn`**: one per chat turn, logged when the turn ends (success, error, timeout, or the student pressing stop).

| Field | Meaning |
|---|---|
| `outcome` | `ok`, `error`, `timeout` (504), or `aborted` (student pressed stop or closed the tab) |
| `status` | HTTP status of a failed turn |
| `totalMs` | Time from receiving the message until the reply is ready |
| `toolMs` / `toolCalls` / `toolErrors` | Total time in tools, and how many ran or failed |
| `modelMs` | `totalMs − toolMs`: model time plus gateway and network overhead |
| `modelSteps` / `modelStepMs` | The model time split into steps: before the first tool, between tools, and after the last tool. Each entry is roughly one LLM round trip. |
| `tools` | Per-tool `name`, `ms`, `outcome`, `resultBytes` in call order |
| `cards` | Number of cards shown to the student |
| `gateway.gatewayMs` | Duration of the single HTTP call to OpenClaw |
| `gateway.requestBytes` / `responseBytes` | Size of what we sent to and received from the gateway |
| `gateway.systemChars` | Characters in our two system messages |
| `gateway.historyMessages` / `historyChars` | History we sent (at most 12 messages) |
| `gateway.draftChars` / `messageChars` | Pending draft context and the student's message size |
| `gateway.replyChars` | Length of the model's reply |
| `gateway.promptTokens` / `cachedPromptTokens` / `completionTokens` / `reasoningTokens` | OpenAI usage, **only if OpenClaw passes `usage` through** (missing otherwise). Totals for the whole turn, as reported by the gateway. |

The same breakdown is returned on each chat response as a `Server-Timing` header, so it shows up in the browser devtools Network → Timing panel and is read by the benchmark below.

## How to measure

With the app and gateway running (see [LOCAL_AI_TESTING.md](LOCAL_AI_TESTING.md)):

```bash
pnpm agent:latency --runs 3 --label baseline
```

This sends six read-only prompts (small talk, connections, Moodle, calendar, progress, and a plan draft) `--runs` times, one turn at a time, and writes `.local/agent-latency/<time>-<label>.json` and `.md`. The Markdown report has a per-prompt table (p50/p90 total, model, tools, tool calls, tokens), a per-tool table, and every turn's step-by-step breakdown. Copy the summary rows into the [results log](#results-log).

- `--only moodle,plan` limits the prompts; `--prompts file.json` uses your own (`[{ "id": "...", "message": "..." }]`).
- The default prompts are checked in CI against the runtime's consent detectors so they never authorize a calendar write. The script also stops if any response reports a write.
- Prompts in one run share the local student's chat history (up to 12 messages, kept in memory for an hour). `historyMessages` in the report shows how much history each turn carried. Restart `pnpm dev` for a clean start.
- On the VM, run it inside the web network like `agent:smoke`: `AGENT_LATENCY_BASE=http://web:3000`, `AGENT_LATENCY_ORIGIN=<managed HTTPS origin>`, `AGENT_LATENCY_USER=<isolated test account>`. Never use the identity header from outside the trusted network.
- Compare configurations by changing one thing, restarting, and re-running with a new `--label` (for example `thinking-minimal`, `model-<id>`).

## How to read the results

| If you see | Then | Next step |
|---|---|---|
| `toolCalls` usually ≥ 3 on planning prompts and `modelMs` ≫ `toolMs` | H1/H5: round trips dominate | Step 3 (fewer round trips) |
| A single tool with high p50/p90 in "By tool" | H6: that integration is slow | Cache it or fetch it ahead of time (step 3) |
| High `modelStepMs` even for `smalltalk` (no tools) | H7: the model is slow per step | Step 2 (thinking level, model A/B) |
| `cachedPromptTokens` near zero on later steps | H3 | Step 1 (move the timestamp) |
| `promptTokens` jumps turn over turn while `historyChars` stays capped | H4 | Step 1 (send history once) |
| `clientMs` much larger than `totalMs` | Network or Next.js overhead outside the turn | Check the VM proxy |

## Findings: first local run (10 October)

Two benchmark runs on a local machine (6 prompts × 3 runs each, OpenClaw 2026.9.9, `openai/gpt-5.6-terra`); see the [results log](#results-log). Three runs per prompt is a small sample: compare medians, not single turns.

- **The model is the bottleneck, not the tools (H6 rejected).** Tools take 2% of turn time: Moodle and progress reads take milliseconds, the calendar read about 0.2 s, and the timeline planner about 0.4 s. All the rest is model time.
- **Round trips are the cost (H1 confirmed).** One model step takes about 2.7 s at p50 and 5 s at p90. A turn with no tools takes about 1.4 s, a turn with one tool 4–5 s, and the plan prompt (two tools, three steps) 12–18 s. The plan prompt's first two steps are the longest (4–8 s each), because the model reasons about the work and availability arguments.
- **Failed tool calls add extra round trips.** The OpenClaw log shows two causes, each costing a full extra step:
  - `polymate_get_calendar` is called with dates in the wrong format (`from must be an ISO timestamp with a timezone offset`). Its tool definition declares `from`/`to` only as `string`, without a format or example.
  - The model tries to call tools in parallel and our one-tool-at-a-time lock rejects it (`Wait for the current tool to finish before starting another`), so it retries one at a time.
- **Prompt caching works (H3 not supported).** Each model call carries about 15k prompt tokens, about 95% cached. Our own request is only about 3k tokens; OpenClaw adds the rest (tool definitions and its own instructions). Moving the timestamp is therefore low priority.
- **No duplicated history observed (H4 not supported).** Prompt tokens per step did not grow across turns while our history went from 2 to 12 messages.
- **Reasoning level does not help (H7, partly).** `minimal` vs. `low` changed neither the step time nor the reasoning tokens noticeably. A faster model is the remaining H7 experiment.
- The usage reported for turns with no tool calls looks wrong (3 prompt tokens), so do not rely on token counts for those turns.

## Plan

Ordered by expected gain per hour against the 10:00 feature freeze on Sunday 11 October, updated after the [first findings](#findings-first-local-run-10-october). Measure each step with `pnpm agent:latency` before and after, using the same prompts and runs.

1. **Measure (done).** Telemetry, `Server-Timing`, the benchmark, and this plan. *Kent:* repeat the baseline on the VM and add it to the results log.
2. **Stop failed tool calls (small, saves one step of about 2–3 s whenever it happens).** State the expected format in the tool definitions, e.g. `from`/`to`: "ISO 8601 with offset, e.g. 2026-10-12T00:00:00+02:00", and the same for `startAt`/`endAt` in the other tools. Then regenerate the plugin's tool definitions (`pnpm agent:sync-openclaw-tools`).
3. **Allow parallel read-only tools (medium, saves one step when the model fetches Moodle and the calendar together).** Let read-only tools (`polymate_check_connections`, `moodle_get_calendar_events`, `polymate_get_calendar`, `polymate_get_study_progress`) run concurrently. Keep writes one at a time and keep the per-turn tool limit.
4. **Fewer round trips for planning (medium).** Put a compact per-student snapshot (connections, upcoming Moodle items) into the first message, cached for about 60 seconds, so the plan prompt can skip `moodle_get_calendar_events` and go straight to `moodle_plan_assignment_timeline`. Shorter instructions and no timeline times repeated as prose (*Dogancem*, already on the roadmap) also shorten the final step.
5. **Faster model (configuration only).** A/B one faster OpenAI model against `gpt-5.6-terra` with `--label model-<id>`. Before adopting it, re-run the consent and planning journey in [LOCAL_AI_TESTING.md](LOCAL_AI_TESTING.md): a faster model must not skip consent rules or invent deadlines. Keep thinking at `low`; `minimal` did not help.
6. **Streaming (stretch, likely after the freeze).** Stream the reply and a status line per tool ("Reading Moodle…") to the chat. It does not change total time but shows progress during the 12–18 s planning turns. Complements Yildirim's rotating status words.

Not planned: moving the timestamp out of the system message, and history deduplication. The first run showed caching works and history does not grow.

*Catalin:* use `pnpm agent:latency` for the before/after comparison in the 3a gate.

## Results log

Fill in one row per run. "Plan p50" is the `plan` prompt; "Model step p50" is from the report header.

| Date | Where | Label / change | Runs | Plan p50 total | Plan p50 tool calls | Model step p50 | Tool time share | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-10-10 | Local (MacBook, `gpt-5.6-terra`) | baseline, thinking `low` | 3 | 14.9 s (12.3–17.9) | 2 (3 model steps) | 2.7 s | 2% | Small talk 1.4 s. Single-tool prompts 4.2–5.4 s. |
| 2026-10-10 | Local (MacBook, `gpt-5.6-terra`) | thinking `minimal` | 3 | 13.0 s (10.7–16.8) | 2 (3–4 model steps) | 2.6 s | 2% | Within noise of `low`; reasoning tokens barely changed; more failed calendar calls. Not adopted. |
