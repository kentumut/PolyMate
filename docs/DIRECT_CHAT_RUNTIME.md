# Direct foreground chat runtime

The backend now contains a prepared OpenAI Agents SDK runtime in `apps/web/lib/direct-chat-runtime.ts`. It is intentionally not connected to `/api/agent/chat` or any UI component yet. Foreground traffic therefore continues through OpenClaw until a separate integration change switches the route.

The prepared runtime:

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

Before connecting the route, pass the active turn returned by `beginAgentTurn` to `streamDirectChatTurn`, forward only output-text deltas to the client, await stream completion, sanitize and persist the final text with `agentResponseBody`, and always call `endAgentTurn` in `finally`. Keep OpenClaw configured for scheduled jobs.
