import { randomUUID } from 'node:crypto';

/**
 * Latency telemetry for agent turns. Records only timings, sizes, tool names and
 * token counts: never message content, owner IDs, session keys, or tool arguments.
 */
export type ToolSpan = { name: string; startMs: number; endMs: number; outcome: 'ok' | 'error'; resultBytes: number };
export type GatewayMetrics = {
  status?: number;
  gatewayMs?: number;
  /** Streaming only: gateway call start to the first reply text. */
  firstDeltaMs?: number;
  requestBytes?: number;
  responseBytes?: number;
  systemChars?: number;
  historyMessages?: number;
  historyChars?: number;
  draftChars?: number;
  appContextChars?: number;
  /** Durable student memories and courses. */
  persistentChars?: number;
  messageChars?: number;
  replyChars?: number;
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
};
export type TurnTelemetry = { turnId: string; startedAt: number; tools: ToolSpan[]; gateway: GatewayMetrics; /** Time to build app context before the model call. */ contextMs?: number };
export type TurnOutcome = 'ok' | 'aborted' | 'timeout' | 'error';

export function createTurnTelemetry(now = Date.now()): TurnTelemetry {
  return { turnId: randomUUID(), startedAt: now, tools: [], gateway: {} };
}

export function recordToolSpan(telemetry: TurnTelemetry, span: Omit<ToolSpan, 'startMs' | 'endMs'> & { startedAt: number; endedAt: number }): ToolSpan {
  const recorded: ToolSpan = { name: span.name, outcome: span.outcome, resultBytes: span.resultBytes,
    startMs: span.startedAt - telemetry.startedAt, endMs: span.endedAt - telemetry.startedAt };
  telemetry.tools.push(recorded);
  return recorded;
}

export function jsonBytes(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value) ?? ''); } catch { return 0; }
}

/**
 * The gaps around tools are model steps: before the first tool, between tool
 * batches, and after the last tool until the reply arrives.
 */
export function summarizeTurn(telemetry: TurnTelemetry, input: { endedAt: number; outcome: TurnOutcome; status?: number; cards?: number }) {
  const totalMs = Math.max(0, input.endedAt - telemetry.startedAt);
  const tools = [...telemetry.tools].sort((a, b) => a.startMs - b.startMs);
  // Parallel reads overlap: count wall-clock tool time, and treat overlapping tools as one batch between model steps.
  let toolMs = 0;
  const modelStepMs: number[] = [];
  let cursor = 0;
  for (const span of tools) {
    if (span.startMs >= cursor || !modelStepMs.length) modelStepMs.push(Math.max(0, span.startMs - cursor));
    toolMs += Math.max(0, span.endMs - Math.max(span.startMs, cursor));
    cursor = Math.max(cursor, span.endMs);
  }
  modelStepMs.push(Math.max(0, totalMs - cursor));
  // App context is built before the first model call, so it is part of the first gap, not model time.
  const contextMs = Math.min(telemetry.contextMs ?? 0, modelStepMs[0]);
  modelStepMs[0] -= contextMs;
  return {
    event: 'agent_turn' as const,
    turnId: telemetry.turnId,
    outcome: input.outcome,
    ...(input.status ? { status: input.status } : {}),
    totalMs,
    contextMs,
    modelMs: modelStepMs.reduce((sum, ms) => sum + ms, 0),
    toolMs,
    toolCalls: tools.length,
    toolErrors: tools.filter(span => span.outcome === 'error').length,
    modelSteps: modelStepMs.length,
    modelStepMs,
    tools: tools.map(span => ({ name: span.name, ms: span.endMs - span.startMs, outcome: span.outcome, resultBytes: span.resultBytes })),
    cards: input.cards ?? 0,
    gateway: telemetry.gateway,
  };
}
export type TurnSummary = ReturnType<typeof summarizeTurn>;

/** Server-Timing lets the latency benchmark (and browser devtools) read the breakdown per response. */
export function serverTimingHeader(summary: TurnSummary): string {
  const entries = [`total;dur=${summary.totalMs}`, `context;dur=${summary.contextMs}`, `model;dur=${summary.modelMs};desc="${summary.modelSteps} steps"`,
    `tools;dur=${summary.toolMs};desc="${summary.toolCalls} calls"`];
  summary.modelStepMs.forEach((ms, index) => entries.push(`step${index + 1};dur=${ms}`));
  summary.tools.forEach((tool, index) => entries.push(`tool${index + 1}_${tool.name};dur=${tool.ms};desc="${tool.outcome} ${tool.resultBytes}B"`));
  const { gateway } = summary;
  if (gateway.firstDeltaMs !== undefined) entries.push(`first-text;dur=${summary.contextMs + gateway.firstDeltaMs}`);
  if (gateway.promptTokens !== undefined) entries.push(`tokens;desc="prompt=${gateway.promptTokens} cached=${gateway.cachedPromptTokens ?? 0} completion=${gateway.completionTokens ?? 0} reasoning=${gateway.reasoningTokens ?? 0}"`);
  entries.push(`prompt;desc="system=${gateway.systemChars ?? 0} history=${gateway.historyMessages ?? 0}/${gateway.historyChars ?? 0} draft=${gateway.draftChars ?? 0} app=${gateway.appContextChars ?? 0} message=${gateway.messageChars ?? 0}"`);
  entries.push(`turn;desc="${summary.turnId}"`);
  return entries.join(', ');
}

export function logToolSpan(telemetry: TurnTelemetry, span: ToolSpan, background = false): void {
  console.info(JSON.stringify({ event: 'agent_tool', turnId: telemetry.turnId, background, index: telemetry.tools.length,
    name: span.name, ms: span.endMs - span.startMs, outcome: span.outcome, resultBytes: span.resultBytes }));
}

export function logTurn(summary: TurnSummary): void { console.info(JSON.stringify(summary)); }

/** Reads OpenAI-compatible `usage` if the gateway passes it through; absent fields stay undefined. */
export function usageMetrics(body: unknown): Pick<GatewayMetrics, 'promptTokens' | 'cachedPromptTokens' | 'completionTokens' | 'reasoningTokens'> {
  const usage = (body as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage || typeof usage !== 'object') return {};
  const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const details = (key: string) => (usage[key] && typeof usage[key] === 'object' ? usage[key] as Record<string, unknown> : {});
  return {
    promptTokens: count(usage.prompt_tokens) ?? count(usage.input_tokens),
    cachedPromptTokens: count(details('prompt_tokens_details').cached_tokens) ?? count(details('input_tokens_details').cached_tokens),
    completionTokens: count(usage.completion_tokens) ?? count(usage.output_tokens),
    reasoningTokens: count(details('completion_tokens_details').reasoning_tokens) ?? count(details('output_tokens_details').reasoning_tokens),
  };
}
