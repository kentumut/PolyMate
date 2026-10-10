import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPTS, markdownReport, parseServerTiming, percentile, sampleFromResponse, summarize } from '../scripts/agent-latency-report.mjs';
import { createTurnTelemetry, recordToolSpan, serverTimingHeader, summarizeTurn } from '../apps/web/lib/agent-telemetry';
import { isExplicitCalendarConsent, isExplicitEditConsent, isExplicitMoveConsent, isExplicitPartialConsent } from '../packages/core/agent/contracts';

function header(tools: Array<[string, number, number]>, endedAt: number, gateway = {}) {
  const telemetry = createTurnTelemetry(0);
  for (const [name, start, end] of tools) recordToolSpan(telemetry, { name, outcome: 'ok', resultBytes: 10, startedAt: start, endedAt: end });
  Object.assign(telemetry.gateway, gateway);
  return serverTimingHeader(summarizeTurn(telemetry, { endedAt, outcome: 'ok' }));
}

describe('agent latency report', () => {
  it('round-trips the server header into a sample', () => {
    const serverTiming = header([['polymate_check_connections', 1_000, 1_100], ['moodle_get_calendar_events', 3_000, 4_000]], 6_000,
      { promptTokens: 4_000, cachedPromptTokens: 2_048, completionTokens: 80, reasoningTokens: 10, systemChars: 3_000, historyMessages: 2, historyChars: 300 });
    expect(parseServerTiming(serverTiming).total).toEqual({ dur: 6_000 });
    expect(sampleFromResponse({ prompt: 'moodle', run: 1, status: 200, clientMs: 6_050, serverTiming, cards: [{ kind: 'assignments' }] })).toMatchObject({
      totalMs: 6_000, modelMs: 4_900, toolMs: 1_100, toolCalls: 2, modelStepMs: [1_000, 1_900, 2_000],
      tools: [{ name: 'polymate_check_connections', ms: 100, outcome: 'ok' }, { name: 'moodle_get_calendar_events', ms: 1_000, outcome: 'ok' }],
      promptTokens: 4_000, cachedPromptTokens: 2_048, completionTokens: 80, reasoningTokens: 10, systemChars: 3_000, historyMessages: 2, historyChars: 300,
      cardKinds: ['assignments'],
    });
  });

  it('flags missing expected cards and any calendar write as quality failures', () => {
    const ok = sampleFromResponse({ prompt: 'plan', run: 1, status: 200, clientMs: 1, serverTiming: header([], 1_000), cards: [{ kind: 'timeline' }], expectCards: ['timeline'] });
    const skipped = sampleFromResponse({ prompt: 'plan', run: 2, status: 200, clientMs: 1, serverTiming: header([], 1_000), cards: [{ kind: 'schedule' }], expectCards: ['timeline'] });
    expect(ok.checkFailures).toEqual([]);
    expect(skipped.checkFailures).toEqual(['missing timeline card', 'calendar write']);
    expect(summarize([ok, skipped]).checkFailures).toEqual(['plan run 2: missing timeline card', 'plan run 2: calendar write']);
    expect(markdownReport({ label: 'x', startedAt: 'now', base: 'http://local', runs: 2, samples: [ok, skipped] })).toContain('- Quality checks: plan run 2: missing timeline card; plan run 2: calendar write');
  });

  it('reports what a student sees when the reply streams', () => {
    const sample = sampleFromResponse({ prompt: 'plan', run: 1, status: 200, clientMs: 9_000, serverTiming: header([], 9_000), firstStatusMs: 2_000, firstTextMs: 6_500 });
    expect(summarize([sample]).byPrompt[0]).toMatchObject({ p50FirstStatusMs: 2_000, p50FirstTextMs: 6_500 });
    expect(markdownReport({ label: 's', startedAt: 'now', base: 'http://local', runs: 1, samples: [sample] })).toContain('| plan | 2.0 s | 6.5 s | 9.0 s |');
  });

  it('keeps failed requests in the report without timing data', () => {
    const sample = sampleFromResponse({ prompt: 'plan', run: 2, status: 503, clientMs: 300, serverTiming: null, error: 'unavailable' });
    expect(sample).toMatchObject({ status: 503, totalMs: undefined, toolCalls: 0 });
    const summary = summarize([sample]);
    expect(summary).toMatchObject({ ok: 0, failed: 1 });
    expect(markdownReport({ label: 'x', startedAt: 'now', base: 'http://local', runs: 1, samples: [sample] })).toContain('| plan | 2 | 503 unavailable |');
  });

  it('aggregates per prompt and per tool with nearest-rank percentiles', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 90)).toBe(5);
    expect(percentile([], 50)).toBeUndefined();
    const samples = [1, 2, 3].map(run => sampleFromResponse({ prompt: 'moodle', run, status: 200, clientMs: 0,
      serverTiming: header([['moodle_get_calendar_events', 1_000, 1_000 + run * 500]], 5_000 + run * 1_000) }));
    const summary = summarize(samples);
    expect(summary.byPrompt).toEqual([expect.objectContaining({ prompt: 'moodle', runs: 3, ok: 3, p50TotalMs: 7_000, p90TotalMs: 8_000, p50ToolCalls: 1 })]);
    expect(summary.byTool).toEqual([{ name: 'moodle_get_calendar_events', calls: 3, errors: 0, p50Ms: 1_000, p90Ms: 1_500 }]);
    expect(summary.modelStep.count).toBe(6);
    const report = markdownReport({ label: 'baseline', startedAt: 'now', base: 'http://local', runs: 3, samples });
    expect(report).toContain('# Agent latency: baseline');
    expect(report).toContain('| moodle | 3/3 | 7.0 s | 8.0 s |');
  });

  it('ships only prompts that the runtime never treats as calendar-write consent', () => {
    for (const { message } of DEFAULT_PROMPTS) {
      for (const consent of [isExplicitCalendarConsent, isExplicitEditConsent, isExplicitMoveConsent, isExplicitPartialConsent]) expect(consent(message), message).toBe(false);
    }
    expect(new Set(DEFAULT_PROMPTS.map(prompt => prompt.id)).size).toBe(DEFAULT_PROMPTS.length);
  });
});
