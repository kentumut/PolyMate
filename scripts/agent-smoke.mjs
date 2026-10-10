// One real model turn and one read-only app callback; never schedules calendar work.
const origin = process.env.AGENT_SMOKE_ORIGIN || process.env.APP_ORIGIN || 'http://127.0.0.1:3000';
const headers = { 'Content-Type': 'application/json', Origin: origin };
// Use only inside the trusted production network, never a public-header auth bypass.
if (process.env.AGENT_SMOKE_USER) headers['X-User-Id'] = process.env.AGENT_SMOKE_USER;
const base = process.env.AGENT_SMOKE_BASE || origin;
const response = await fetch(`${base}/api/agent/chat`, {
  method: 'POST', headers,
  body: JSON.stringify({ message: 'Use polymate_check_connections to check my connected services. Do not change anything.' }),
  signal: AbortSignal.timeout(110_000),
});
const result = await response.json();
if (!response.ok || !result.reply || !result.cards?.some(card => card.kind === 'connections')) {
  console.error(`Agent smoke failed (HTTP ${response.status}); inspect the private gateway logs. A real connection-status tool card is required.`);
  process.exitCode = 1;
} else console.log('Agent smoke passed: OpenAI replied and the signed read-only PolyMate tool callback succeeded.');
