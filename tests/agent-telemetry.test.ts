import { describe, expect, it } from 'vitest';
import { createTurnTelemetry, recordToolSpan, serverTimingHeader, summarizeTurn, usageMetrics } from '../apps/web/lib/agent-telemetry';

function turnWithTools(spans: Array<[name: string, start: number, end: number, outcome?: 'ok' | 'error']>) {
  const telemetry = createTurnTelemetry(10_000);
  for (const [name, start, end, outcome = 'ok'] of spans) recordToolSpan(telemetry, { name, outcome, resultBytes: 100, startedAt: 10_000 + start, endedAt: 10_000 + end });
  return telemetry;
}

describe('agent turn telemetry', () => {
  it('splits a sequential turn into model steps around each tool', () => {
    const telemetry = turnWithTools([['polymate_check_connections', 2_000, 2_100], ['moodle_get_calendar_events', 4_100, 5_600], ['moodle_plan_assignment_timeline', 8_000, 8_300]]);
    const summary = summarizeTurn(telemetry, { endedAt: 10_000 + 12_000, outcome: 'ok', cards: 3 });
    expect(summary).toMatchObject({ event: 'agent_turn', outcome: 'ok', totalMs: 12_000, toolMs: 1_900, modelMs: 10_100, toolCalls: 3, toolErrors: 0,
      modelSteps: 4, modelStepMs: [2_000, 2_000, 2_400, 3_700], cards: 3 });
    expect(summary.totalMs).toBe(summary.modelMs + summary.toolMs);
    expect(summary.tools.map(tool => tool.ms)).toEqual([100, 1_500, 300]);
  });

  it('treats a turn without tools as a single model step', () => {
    const summary = summarizeTurn(createTurnTelemetry(0), { endedAt: 4_200, outcome: 'ok' });
    expect(summary).toMatchObject({ totalMs: 4_200, modelMs: 4_200, toolMs: 0, toolCalls: 0, modelSteps: 1, modelStepMs: [4_200] });
  });

  it('orders spans by start time and counts failed tools', () => {
    const telemetry = turnWithTools([['moodle_get_calendar_events', 3_000, 3_500, 'error'], ['polymate_check_connections', 1_000, 1_200]]);
    const summary = summarizeTurn(telemetry, { endedAt: 10_000 + 6_000, outcome: 'timeout', status: 504 });
    expect(summary.tools.map(tool => tool.name)).toEqual(['polymate_check_connections', 'moodle_get_calendar_events']);
    expect(summary).toMatchObject({ outcome: 'timeout', status: 504, toolErrors: 1, modelStepMs: [1_000, 1_800, 2_500] });
  });

  it('formats a Server-Timing header that the latency benchmark can parse', () => {
    const telemetry = turnWithTools([['moodle_get_calendar_events', 1_000, 1_400]]);
    Object.assign(telemetry.gateway, { promptTokens: 5_000, cachedPromptTokens: 4_096, completionTokens: 90, reasoningTokens: 30, systemChars: 3_200, historyMessages: 4, historyChars: 900, draftChars: 0, messageChars: 20 });
    const header = serverTimingHeader(summarizeTurn(telemetry, { endedAt: 10_000 + 3_000, outcome: 'ok' }));
    expect(header).toContain('total;dur=3000');
    expect(header).toContain('model;dur=2600;desc="2 steps"');
    expect(header).toContain('tools;dur=400;desc="1 calls"');
    expect(header).toContain('step1;dur=1000, step2;dur=1600');
    expect(header).toContain('tool1_moodle_get_calendar_events;dur=400;desc="ok 100B"');
    expect(header).toContain('tokens;desc="prompt=5000 cached=4096 completion=90 reasoning=30"');
    expect(header).toContain('prompt;desc="system=3200 history=4/900 draft=0 message=20"');
    expect(header).toContain(`turn;desc="${telemetry.turnId}"`);
  });

  it('reads Chat Completions and Responses style usage, and ignores missing usage', () => {
    expect(usageMetrics({ usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 8 } } }))
      .toEqual({ promptTokens: 10, cachedPromptTokens: 8, completionTokens: 2, reasoningTokens: undefined });
    expect(usageMetrics({ usage: { input_tokens: 11, output_tokens: 3, output_tokens_details: { reasoning_tokens: 1 } } }))
      .toEqual({ promptTokens: 11, cachedPromptTokens: undefined, completionTokens: 3, reasoningTokens: 1 });
    expect(usageMetrics({ choices: [] })).toEqual({});
    expect(usageMetrics(null)).toEqual({});
  });
});
