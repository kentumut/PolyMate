// Measures real agent turns against a running PolyMate and writes JSON + Markdown reports.
// Read-only prompts only; stops if any response reports a calendar write, and flags missing expected cards.
//
//   node scripts/agent-latency.mjs [--runs 3] [--label thinking-low] [--prompts file.json] [--only moodle,plan] [--out dir] [--stream]
// --stream uses the chat UI's NDJSON stream and also records time to first status and first reply text.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_PROMPTS, markdownReport, sampleFromResponse, summarize } from './agent-latency-report.mjs';

const { values: args } = parseArgs({ options: {
  runs: { type: 'string', default: '3' }, label: { type: 'string', default: 'baseline' },
  prompts: { type: 'string' }, only: { type: 'string' }, out: { type: 'string', default: '.local/agent-latency' },
  stream: { type: 'boolean', default: false },
} });
const runs = Number(args.runs);
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('--runs must be 1-20.');
if (!/^[A-Za-z0-9._-]{1,60}$/.test(args.label)) throw new Error('--label may contain letters, digits, dot, dash, underscore.');

const origin = process.env.AGENT_LATENCY_ORIGIN || process.env.AGENT_SMOKE_ORIGIN || process.env.APP_ORIGIN || 'http://127.0.0.1:3000';
const base = process.env.AGENT_LATENCY_BASE || process.env.AGENT_SMOKE_BASE || origin;
const headers = { 'Content-Type': 'application/json', Origin: origin };
// Same rule as agent-smoke: only inside the trusted production network, never a public-header auth bypass.
const user = process.env.AGENT_LATENCY_USER || process.env.AGENT_SMOKE_USER;
if (user) headers['X-User-Id'] = user;

let prompts = args.prompts ? JSON.parse(readFileSync(args.prompts, 'utf8')) : DEFAULT_PROMPTS;
if (args.only) { const only = new Set(args.only.split(',')); prompts = prompts.filter(prompt => only.has(prompt.id)); }
if (!prompts.length) throw new Error('No prompts selected.');

async function turn(prompt, run) {
  for (let attempt = 0; ; attempt++) {
    const startedAt = performance.now();
    try {
      const response = await fetch(`${base}/api/agent/chat`, { method: 'POST', headers: args.stream ? { ...headers, Accept: 'application/x-ndjson' } : headers,
        body: JSON.stringify({ message: prompt.message }), signal: AbortSignal.timeout(130_000) });
      // 409: the previous turn is still releasing its lock.
      if (response.status === 409 && attempt < 3) { await response.body?.cancel(); await new Promise(done => setTimeout(done, 2_000)); continue; }
      const elapsed = () => Math.round(performance.now() - startedAt);
      if (args.stream && response.ok && response.headers.get('content-type')?.includes('application/x-ndjson')) {
        let firstStatusMs, firstTextMs, final;
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let newline;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            const event = JSON.parse(line);
            if (event.type === 'status') firstStatusMs ??= elapsed();
            if (event.type === 'delta') firstTextMs ??= elapsed();
            if (event.type === 'done' || event.type === 'error') final = event;
          }
        }
        const failed = !final || final.type === 'error';
        return sampleFromResponse({ prompt: prompt.id, run, status: failed ? final?.status ?? 0 : 200, clientMs: elapsed(), serverTiming: failed ? null : final.timing,
          cards: failed ? [] : final.cards ?? [], expectCards: prompt.expectCards, firstStatusMs, firstTextMs, error: failed ? final?.error?.message?.slice(0, 120) ?? 'stream ended early' : undefined });
      }
      const body = await response.json().catch(() => ({}));
      return sampleFromResponse({ prompt: prompt.id, run, status: response.status, clientMs: elapsed(), serverTiming: response.headers.get('server-timing'),
        cards: Array.isArray(body.cards) ? body.cards : [], expectCards: prompt.expectCards, error: response.ok ? undefined : body.error?.message?.slice(0, 120) });
    } catch (error) {
      return sampleFromResponse({ prompt: prompt.id, run, status: 0, clientMs: Math.round(performance.now() - startedAt), error: error?.cause?.code ?? error?.name ?? 'error' });
    }
  }
}

const startedAt = new Date().toISOString();
const samples = [];
console.log(`Measuring ${prompts.length} prompts × ${runs} runs against ${base} (${args.label}${args.stream ? ', streaming' : ''})`);
// Runs are interleaved so cache warm-up and gateway drift spread across prompts instead of favouring one.
for (let run = 1; run <= runs; run++) {
  for (const prompt of prompts) {
    const sample = await turn(prompt, run);
    samples.push(sample);
    const tools = sample.tools.map(tool => `${tool.name}=${tool.ms}ms`).join(' ') || 'no tools';
    console.log(`[${run}/${runs}] ${prompt.id.padEnd(12)} ${String(sample.status).padEnd(3)} total=${sample.totalMs ?? sample.clientMs}ms${sample.firstTextMs !== undefined ? ` firstText=${sample.firstTextMs}ms` : ''} model=${sample.modelMs ?? '?'}ms tools=${sample.toolMs ?? '?'}ms (${tools})${sample.error ? ` error=${sample.error}` : ''}${sample.checkFailures.length ? ` CHECK FAILED: ${sample.checkFailures.join(', ')}` : ''}`);
    if (sample.cardKinds.includes('schedule')) {
      console.error('A response reported a calendar write. Stopping; inspect the calendar and the prompt set.');
      process.exitCode = 2;
      break;
    }
  }
  if (process.exitCode) break;
}

const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const stamp = startedAt.replace(/[:.]/g, '-');
const report = { label: args.label, startedAt, base, runs, stream: args.stream, prompts: prompts.map(prompt => prompt.id), summary: summarize(samples), samples };
writeFileSync(resolve(out, `${stamp}-${args.label}.json`), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(resolve(out, `${stamp}-${args.label}.md`), markdownReport({ label: args.label, startedAt, base, runs, samples }));
console.log(`\nReports: ${out}/${stamp}-${args.label}.{json,md}`);
if (report.summary.checkFailures.length) { console.error(`Quality checks failed: ${report.summary.checkFailures.join('; ')}`); process.exitCode ||= 3; }
if (report.summary.ok === 0) { console.error('No successful turns: check that the app and OpenClaw gateway are running.'); process.exitCode ||= 1; }
