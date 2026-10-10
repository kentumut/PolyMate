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

## Plan

Ordered by effort against the 10:00 feature freeze on Sunday 11 October. Each step is measured with `pnpm agent:latency` before and after, using the same prompts and runs.

1. **Measure (done in this change).** Telemetry, `Server-Timing`, the benchmark, and this plan. *Kent:* run `baseline` locally and on the VM and fill in the results log.
2. **Configuration only, no code.** *Kent:* A/B `POLYMATE_LLM_THINKING` (`low` → `minimal`) and, if per-step time is high, one faster OpenAI model. Before adopting a change, re-run the consent and planning journey in [LOCAL_AI_TESTING.md](LOCAL_AI_TESTING.md): a faster model must not skip consent rules or invent deadlines.
3. **Small prompt changes.** *Dogancem* (already on the 3a roadmap):
   - Move `Current time` out of the system message into the final user message, rounded to the minute, so the instructions and history stay cacheable (H3).
   - Check whether OpenClaw keeps a transcript per `x-openclaw-session-key`. If it does, stop sending our own history, or send a fresh session key per turn (H4).
   - Shorten the instructions and stop repeating timeline times as prose.
4. **Fewer round trips** (if the logs show H1/H5). Put a compact per-student snapshot (connections, upcoming Moodle items, next-7-day busy times) into the first message, cached for about 60 seconds, so the model can skip 1–2 tool calls. Allow read-only tools to run in parallel. Owner to be agreed after step 1's numbers.
5. **Streaming (stretch, likely after the freeze).** Stream the reply and a status line per tool ("Reading Moodle…") to the chat. This complements Yildirim's rotating status words. It touches the gateway call, the route, and the chat UI, so it should only start with a clear measurement and a passing gate.

*Catalin:* use `pnpm agent:latency` for the before/after comparison in the 3a gate.

## Results log

Fill in one row per run. "Plan p50" is the `plan` prompt; "Model step p50" is from the report header.

| Date | Where | Label / change | Runs | Plan p50 total | Plan p50 tool calls | Model step p50 | Tool time share | Notes |
|---|---|---|---|---|---|---|---|---|
| | | baseline | | | | | | |
