# Wiring the direct PolyMate AI agent

This repository contains two agent runtimes:

- OpenClaw is the currently connected foreground-chat runtime and remains the scheduler for background jobs.
- `apps/web/lib/direct-chat-runtime.ts` is the prepared low-latency foreground runtime built with the OpenAI Agents SDK. It is not connected to the API route yet.

The wiring task is intentionally narrow: replace the foreground model-execution seam in `apps/web/app/api/agent/chat/route.ts`. Do not redesign the UI, duplicate tool implementations, or move background scheduling away from OpenClaw.

## Target architecture

```text
Browser
  -> POST /api/agent/chat
  -> authenticate, validate origin/body, beginAgentTurn
  -> load app context + durable student context
  -> streamDirectChatTurn (or runDirectChatTurn for JSON clients)
  -> dispatchForegroundAgentTool
  -> existing owner-bound PolyMate services
  -> agentResponseBody
  -> existing NDJSON or JSON response

OpenClaw
  -> background cron jobs only
  -> existing signed /api/internal/agent/tools bridge
```

The OpenAI Agents SDK runs inside the web process. Authenticated identity stays in the SDK run context and must never become a model-supplied tool argument. This follows the official OpenAI distinction between conversation input, which the model sees, and local run context, which application code sees.

## Existing building blocks

Use these functions rather than creating replacements:

- `beginAgentTurn`, `endAgentTurn`, `agentResponseBody`, `agentAppContext`, and `dispatchForegroundAgentTool` in `apps/web/lib/agent-runtime.ts`.
- `runDirectChatTurn` and `streamDirectChatTurn` in `apps/web/lib/direct-chat-runtime.ts`.
- `StreamRedactor`, `encodeAgentEvent`, `wantsAgentStream`, and `AGENT_STREAM_CONTENT_TYPE` in `apps/web/lib/agent-stream.ts`.
- `listActiveStudentMemories` and `listCourses` already used by `persistentStudentContext` in the chat route.
- `logTurn`, `summarizeTurn`, and `serverTimingHeader` in `apps/web/lib/agent-telemetry.ts`.

The direct runtime already:

- exposes every canonical definition from `AGENT_TOOL_DEFINITIONS`;
- executes tools through `dispatchForegroundAgentTool`;
- preserves owner binding, validation, consent, operation IDs, write budgets, cards, and private-value tracking;
- permits parallel independent reads while keeping writes and stateful tools exclusive;
- limits model turns and output size;
- defaults to `gpt-6-luna` with reasoning effort `none`;
- disables SDK tracing because prompts and tool results contain student data.

## Route integration

### 1. Add a runtime selector

Introduce a server-only setting such as:

```dotenv
POLYMATE_CHAT_RUNTIME=direct
```

Allow only `direct` and `openclaw`. Default to `openclaw` until direct runtime acceptance passes. Resolve the setting once per request before starting model execution; never switch runtimes halfway through a turn.

Keep the OpenClaw path available during rollout and for rollback. Do not fall back from direct to OpenClaw after a direct run has started: a tool write may already have reached the calendar, and replaying the same user turn through another runtime can repeat work.

### 2. Keep request handling unchanged

Do not alter the following route behavior:

- `resolveOwner` and `assertSameOrigin` run before chat work.
- `confirm_progress` remains an authenticated application action, not a model turn.
- `schedule_current_plan` remains an authenticated application action, not a model turn.
- `beginAgentTurn` enforces one active turn per owner.
- `endAgentTurn` always runs in `finally`.
- streaming clients continue receiving `application/x-ndjson` events.
- non-streaming clients continue receiving the existing JSON response shape.

The frontend should not need a transport or response-contract change.

### 3. Load context once

Keep the existing parallel context load:

```ts
const [appContext, persistentContext] = await Promise.all([
  agentAppContext(owner.userId),
  persistentStudentContext(owner.userId),
]);
```

Pass these values to the direct runtime together with:

```ts
{
  turn,
  message,
  history: turn.history,
  draftContext: turn.draftContext,
  appContext,
  persistentContext,
  signal,
}
```

`turn` belongs in SDK local context. `history`, draft data, app data, and durable memory are deliberately model-visible but labelled as untrusted factual context. Do not place secrets, OAuth data, signed session keys, bridge credentials, CSRF values, or raw confirmation tokens in those strings.

### 4. Wire non-streaming execution

For normal JSON responses, replace only `callOpenClawAgent` with:

```ts
const reply = await runDirectChatTurn({
  turn,
  message,
  history: turn.history,
  draftContext: turn.draftContext,
  appContext,
  persistentContext,
  signal,
});
```

Then keep the authoritative finalization exactly as it is:

```ts
const body = agentResponseBody(reply, turn, owner.userId);
```

`agentResponseBody` must remain the final authority because it redacts private references, replaces inaccurate model claims with actual calendar-write outcomes, collects cards, updates pending-plan state, and saves bounded conversation history.

### 5. Wire streaming execution

The SDK stream emits model and tool-loop events. Forward only output text deltas. Tool status events already come from `dispatchForegroundAgentTool` through `turn.onEvent`.

The execution shape should be:

```ts
const result = await streamDirectChatTurn({
  turn,
  message,
  history: turn.history,
  draftContext: turn.draftContext,
  appContext,
  persistentContext,
  signal,
});

for await (const event of result) {
  if (
    event.type === 'raw_model_stream_event' &&
    event.data.type === 'output_text_delta'
  ) {
    onDelta?.(event.data.delta);
  }
}

await result.completed;
const reply = result.finalOutput;
if (typeof reply !== 'string' || !reply.trim()) {
  throw new AgentRequestError('The AI assistant returned an empty response. Try asking again.', 502);
}
```

Keep `StreamRedactor` between `onDelta` and `encodeAgentEvent`. Never send raw SDK deltas directly to the browser. Tools can add private values during a turn, so the redactor must continue reading `turn.privateValues` live.

After the stream settles, pass the final string through `agentResponseBody` and send the existing `done` event. The final `done.reply` is authoritative and may replace text already displayed from deltas.

Do not treat the run as complete merely because async iteration ended. Await `result.completed` before reading `finalOutput`, persisting history, or releasing the turn.

### 6. Normalize direct-runtime failures

Map SDK/provider failures to safe `AgentRequestError` messages before they reach the route:

- abort -> request ended or client disconnected;
- model timeout -> HTTP 504;
- rate limit or temporary provider failure -> HTTP 503;
- max-turn exhaustion -> a bounded, user-safe retry message;
- empty/non-text final output -> HTTP 502;
- all other provider details -> a generic HTTP 502/503 message.

Never return provider stack traces, request bodies, API responses, tool arguments, or API keys. Preserve the existing telemetry outcome and always call `endAgentTurn`.

## Configuration and deployment

The direct runtime reads:

```dotenv
OPENAI_API_KEY=...
POLYMATE_CHAT_MODEL=gpt-6-luna
POLYMATE_CHAT_REASONING=none
POLYMATE_CHAT_RUNTIME=direct
```

Required deployment changes when enabling it:

1. Add those values to the `web` service environment in `compose.yaml`. Currently `OPENAI_API_KEY` is passed only to the optional OpenClaw service.
2. Update `.env.example` comments to distinguish the web runtime key from the OpenClaw provider configuration.
3. Extend `scripts/config-check.mjs` so `OPENAI_API_KEY` is required when `POLYMATE_CHAT_RUNTIME=direct`, the runtime enum is validated, and model/reasoning values remain validated.
4. Update `tests/config.test.ts` for direct, OpenClaw, and invalid configurations.
5. Keep the key server-only. Never add a `NEXT_PUBLIC_` variant or return it through health/config endpoints.

The existing standalone Next.js build already packages `@openai/agents`; no browser dependency is required.

## Safety invariants

Do not weaken these boundaries while wiring the runtime:

- The model never chooses an owner ID, session key, OAuth credential, operation ID, or calendar connection.
- Tool calls always pass through `dispatchForegroundAgentTool`; do not call calendar, Moodle, progress, VVZ, coaching, or database services from SDK tool wrappers directly.
- Canonical schemas come from `AGENT_TOOL_DEFINITIONS`; do not maintain a second hand-written tool inventory.
- Application parsers remain authoritative because the SDK wrappers intentionally use non-strict schemas for the existing optional/`anyOf` contracts.
- Explicit consent and confirmation cards remain application checks. Model intent is not authorization.
- Calendar write budgets, per-turn deletion limits, retry IDs, and uncertain-write behavior remain unchanged.
- `privateValues` are redacted from streamed and final text.
- Parallelism is allowed only where `foregroundTool` already permits it.
- OpenClaw background registrations and `/api/internal/agent/tools` remain intact.
- Never retry or cross-runtime-fallback automatically after a possibly executed write.

## Tests to add or update

At minimum, cover:

1. Runtime selection defaults to OpenClaw and accepts only the supported values.
2. Direct non-streaming runs receive history, draft, app, durable context, and the request abort signal.
3. Direct streaming forwards only `output_text_delta` events.
4. A split private token never appears in NDJSON deltas.
5. Tool status events still reach the browser.
6. `agentResponseBody` remains the source of final cards, calendar outcome wording, redaction, and stored history.
7. `endAgentTurn` runs on success, provider failure, tool failure, timeout, and client cancellation.
8. Confirmation and `schedule_current_plan` actions do not call either model runtime.
9. Direct tool calls preserve owner isolation, consent checks, write limits, and exact retry operation IDs.
10. No OpenClaw gateway credential or OpenAI API key appears in prompts, tool results, logs, or responses.
11. Direct configuration is required only when the direct runtime is selected; OpenClaw scheduler configuration remains independently valid.

Use an injected or mocked `Runner` in tests. CI must not make live OpenAI calls.

Run:

```sh
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

The two `tests/install-google-env.test.ts` assertions concerning POSIX file modes and child-process stdout are known to fail on Windows. Do not attribute those failures to the agent wiring unless their behavior changes on a POSIX runner.

## Acceptance checklist

- Direct runtime can answer a plain message without OpenClaw foreground chat.
- A read-only question emits tool status, calls the correct owner-bound tool, and streams text.
- A timeline draft produces the same card and private-token redaction as OpenClaw.
- A calendar write is impossible without the same explicit consent as before.
- An uncertain write is not repeated during an error or rollback path.
- Client cancellation aborts the SDK run and releases the active turn.
- Non-streaming clients retain the current JSON contract.
- Streaming clients retain the current NDJSON contract.
- OpenClaw scheduled jobs still run through the signed internal bridge.
- Latency telemetry remains content-free and distinguishes context, model, and tool time where available.

## References

- OpenAI Agents SDK overview: https://developers.openai.com/api/docs/guides/agents/sdk
- Agent definitions and local run context: https://developers.openai.com/api/docs/guides/agents/define-agents
- Running and streaming agents: https://developers.openai.com/api/docs/guides/agents/running-agents
- Function calling and streaming: https://developers.openai.com/api/docs/guides/function-calling
