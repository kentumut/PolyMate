# Direct foreground chat runtime

The backend uses the OpenAI Agents SDK runtime in `apps/web/lib/direct-chat-runtime.ts` for foreground traffic from `/api/agent/chat`. OpenClaw remains configured for scheduled jobs.

The runtime:

- uses the Responses-backed TypeScript Agents SDK in the Next.js server process;
- defaults to `gpt-6-luna` with reasoning effort `none`;
- supports both complete and streaming runs;
- exposes the canonical PolyMate tools in process;
- calls the existing owner-bound foreground dispatcher, preserving validation, consent, write serialization, cards, retry IDs, and private-value handling;
- allows independent read tools to run in parallel while the foreground dispatcher keeps writes and stateful tools serialized;
- keeps SDK tracing disabled because prompts and tool results contain student data.

Configuration is independent from the existing OpenClaw model configuration:

```dotenv
OPENAI_API_KEY=...
POLYMATE_CHAT_MODEL=gpt-6-luna
POLYMATE_CHAT_REASONING=none
```

The route passes the active turn returned by `beginAgentTurn` to `streamDirectChatTurn`, forwards only output-text deltas to the client, awaits stream completion, sanitizes and persists the final text with `agentResponseBody`, and always calls `endAgentTurn` in `finally`.
