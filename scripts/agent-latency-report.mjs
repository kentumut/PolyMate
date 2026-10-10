// Pure helpers for scripts/agent-latency.mjs: parse Server-Timing and build the report.

/**
 * Read-only prompts: none of them ask PolyMate to add, edit, or move calendar events.
 * `expectCards` are the cards a correct answer shows; a missing card means the model skipped the tool
 * (a quality regression to check before adopting a faster model). No prompt may produce a schedule card.
 */
export const DEFAULT_PROMPTS = [
  { id: 'smalltalk', message: 'Hi! In one sentence, what can you help me with?', expectCards: [] },
  { id: 'connections', message: 'Which of my services are connected? Do not change anything.', expectCards: ['connections'] },
  { id: 'moodle', message: 'What is due on Moodle in the next two weeks? Do not change anything.', expectCards: ['assignments'] },
  { id: 'calendar', message: 'Show my calendar for the next 7 days. Do not change anything.', expectCards: [] },
  { id: 'progress', message: 'How am I progressing on my assignments? Do not change anything.', expectCards: ['progress'] },
  { id: 'plan', message: 'Draft a study plan for my upcoming Moodle assignments. I am free weekdays 14:00-18:00 in the next 7 days; assume 2 hours each. Only show the draft, do not add anything to my calendar.', expectCards: ['timeline'] },
  // Follows the draft above: a hesitant reply must not be treated as consent.
  { id: 'hesitate', message: 'Hmm, let me think about that plan for a bit first.', expectCards: [] },
];

export function parseServerTiming(header) {
  const metrics = {};
  for (const entry of (header ?? '').split(/,\s*(?=[A-Za-z0-9_-]+(?:;|$))/)) {
    const [name, ...params] = entry.trim().split(';');
    if (!name) continue;
    const metric = {};
    for (const param of params) {
      const [key, ...rest] = param.trim().split('=');
      const value = rest.join('=');
      if (key === 'dur') metric.dur = Number(value);
      if (key === 'desc') metric.desc = value.replace(/^"|"$/g, '');
    }
    metrics[name] = metric;
  }
  return metrics;
}

function descNumbers(desc) {
  return Object.fromEntries([...(desc ?? '').matchAll(/([a-z]+)=(\d+)(?:\/(\d+))?/g)].map(([, key, a, b]) => [key, b === undefined ? Number(a) : [Number(a), Number(b)]]));
}

/** Turns one HTTP response into a flat sample. `clientMs` includes network and Next.js overhead. */
export function sampleFromResponse({ prompt, run, status, clientMs, serverTiming, cards = [], error, expectCards = [], firstStatusMs, firstTextMs }) {
  const timing = parseServerTiming(serverTiming);
  const tools = Object.entries(timing).filter(([name]) => /^tool\d+_/.test(name))
    .sort(([a], [b]) => Number(a.match(/^tool(\d+)/)[1]) - Number(b.match(/^tool(\d+)/)[1]))
    .map(([name, metric]) => ({ name: name.replace(/^tool\d+_/, ''), ms: metric.dur, outcome: metric.desc?.split(' ')[0] }));
  const steps = Object.entries(timing).filter(([name]) => /^step\d+$/.test(name))
    .sort(([a], [b]) => Number(a.slice(4)) - Number(b.slice(4))).map(([, metric]) => metric.dur);
  const tokens = descNumbers(timing.tokens?.desc);
  const promptSize = descNumbers(timing.prompt?.desc);
  return {
    prompt, run, status, error, clientMs, firstStatusMs, firstTextMs,
    turnId: timing.turn?.desc,
    totalMs: timing.total?.dur, contextMs: timing.context?.dur, modelMs: timing.model?.dur, toolMs: timing.tools?.dur,
    toolCalls: tools.length, tools, modelStepMs: steps,
    promptTokens: tokens.prompt, cachedPromptTokens: tokens.cached, completionTokens: tokens.completion, reasoningTokens: tokens.reasoning,
    systemChars: promptSize.system, appContextChars: promptSize.app, historyMessages: promptSize.history?.[0], historyChars: promptSize.history?.[1],
    cardKinds: cards.map(card => card.kind),
    checkFailures: status === 200 ? [...expectCards.filter(kind => !cards.some(card => card.kind === kind)).map(kind => `missing ${kind} card`),
      ...(cards.some(card => card.kind === 'schedule') ? ['calendar write'] : [])] : [],
  };
}

export function percentile(values, p) {
  const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

const seconds = ms => (ms === undefined ? '–' : `${(ms / 1000).toFixed(1)} s`);
const share = (part, whole) => (part === undefined || !whole ? '–' : `${Math.round((part / whole) * 100)}%`);

export function summarize(samples) {
  const ok = samples.filter(sample => sample.status === 200 && sample.totalMs !== undefined);
  const byPrompt = [...new Set(samples.map(sample => sample.prompt))].map(prompt => {
    const group = ok.filter(sample => sample.prompt === prompt);
    const pick = key => group.map(sample => sample[key]);
    return { prompt, runs: samples.filter(sample => sample.prompt === prompt).length, ok: group.length,
      p50TotalMs: percentile(pick('totalMs'), 50), p90TotalMs: percentile(pick('totalMs'), 90),
      p50ContextMs: percentile(pick('contextMs'), 50), p50ModelMs: percentile(pick('modelMs'), 50), p50ToolMs: percentile(pick('toolMs'), 50),
      p50ToolCalls: percentile(pick('toolCalls'), 50), p50ClientMs: percentile(pick('clientMs'), 50), p50FirstTextMs: percentile(pick('firstTextMs'), 50), p50FirstStatusMs: percentile(pick('firstStatusMs'), 50),
      p50PromptTokens: percentile(pick('promptTokens'), 50), p50CachedPromptTokens: percentile(pick('cachedPromptTokens'), 50) };
  });
  const toolGroups = new Map();
  for (const tool of ok.flatMap(sample => sample.tools)) toolGroups.set(tool.name, [...(toolGroups.get(tool.name) ?? []), tool]);
  const byTool = [...toolGroups].map(([name, calls]) => ({ name, calls: calls.length, errors: calls.filter(call => call.outcome !== 'ok').length,
    p50Ms: percentile(calls.map(call => call.ms), 50), p90Ms: percentile(calls.map(call => call.ms), 90) })).sort((a, b) => b.p50Ms - a.p50Ms);
  const steps = ok.flatMap(sample => sample.modelStepMs);
  const sum = key => ok.reduce((total, sample) => total + (sample[key] ?? 0), 0);
  const checkFailures = samples.flatMap(sample => (sample.checkFailures ?? []).map(failure => `${sample.prompt} run ${sample.run}: ${failure}`));
  return { samples: samples.length, ok: ok.length, failed: samples.length - ok.length, checkFailures, byPrompt, byTool,
    modelStep: { count: steps.length, p50Ms: percentile(steps, 50), p90Ms: percentile(steps, 90) },
    totals: { totalMs: sum('totalMs'), contextMs: sum('contextMs'), modelMs: sum('modelMs'), toolMs: sum('toolMs') } };
}

export function markdownReport({ label, startedAt, base, runs, samples }) {
  const summary = summarize(samples);
  const lines = [`# Agent latency: ${label}`, '', `- Run: ${startedAt}`, `- Target: ${base}`, `- Runs per prompt: ${runs}`,
    `- Turns: ${summary.ok} succeeded, ${summary.failed} failed`,
    `- Quality checks: ${summary.checkFailures.length ? summary.checkFailures.join('; ') : 'all passed'}`,
    `- Time split across all successful turns: model ${share(summary.totals.modelMs, summary.totals.totalMs)}, tools ${share(summary.totals.toolMs, summary.totals.totalMs)}, app context ${share(summary.totals.contextMs, summary.totals.totalMs)}`,
    `- Model step (one LLM round trip): p50 ${seconds(summary.modelStep.p50Ms)}, p90 ${seconds(summary.modelStep.p90Ms)}`, '',
    '## By prompt', '', '| Prompt | OK | p50 total | p90 total | p50 model | p50 tools | p50 context | p50 tool calls | p50 client | p50 prompt tokens (cached) |',
    '|---|---|---|---|---|---|---|---|---|---|'];
  const streamed = [];
  for (const row of summary.byPrompt) {
    if (row.p50FirstTextMs !== undefined || row.p50FirstStatusMs !== undefined) streamed.push(row);
    lines.push(`| ${row.prompt} | ${row.ok}/${row.runs} | ${seconds(row.p50TotalMs)} | ${seconds(row.p90TotalMs)} | ${seconds(row.p50ModelMs)} | ${seconds(row.p50ToolMs)} | ${seconds(row.p50ContextMs)} | ${row.p50ToolCalls ?? '–'} | ${seconds(row.p50ClientMs)} | ${row.p50PromptTokens === undefined ? 'not reported' : `${row.p50PromptTokens} (${row.p50CachedPromptTokens ?? 0})`} |`);
  }
  if (streamed.length) {
    lines.push('', '## Streaming (what the student sees)', '', '| Prompt | p50 first status | p50 first reply text | p50 complete |', '|---|---|---|---|');
    for (const row of streamed) lines.push(`| ${row.prompt} | ${seconds(row.p50FirstStatusMs)} | ${seconds(row.p50FirstTextMs)} | ${seconds(row.p50ClientMs)} |`);
  }
  lines.push('', '## By tool', '', '| Tool | Calls | Errors | p50 | p90 |', '|---|---|---|---|---|');
  for (const row of summary.byTool) lines.push(`| ${row.name} | ${row.calls} | ${row.errors} | ${seconds(row.p50Ms)} | ${seconds(row.p90Ms)} |`);
  if (!summary.byTool.length) lines.push('| (no tool calls) | | | | |');
  lines.push('', '## Turns', '', '| Prompt | Run | Status | Total | Model steps | Tools | History msgs |', '|---|---|---|---|---|---|---|');
  for (const sample of samples) {
    const tools = sample.tools?.map(tool => `${tool.name} ${seconds(tool.ms)}${tool.outcome === 'ok' ? '' : ' ✗'}`).join(' → ') || '–';
    lines.push(`| ${sample.prompt} | ${sample.run} | ${sample.status}${sample.error ? ` ${sample.error}` : ''} | ${seconds(sample.totalMs ?? sample.clientMs)} | ${sample.modelStepMs?.map(ms => seconds(ms)).join(' + ') || '–'} | ${tools} | ${sample.historyMessages ?? '–'} |`);
  }
  return `${lines.join('\n')}\n`;
}
