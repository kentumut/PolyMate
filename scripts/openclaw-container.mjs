import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { gatewayConfiguration, DEFAULT_MODEL, DEFAULT_THINKING } from './openclaw-config.mjs';

for (const key of ['OPENAI_API_KEY', 'OPENCLAW_GATEWAY_TOKEN', 'OPENCLAW_AGENT_BRIDGE_SECRET']) {
  if (Buffer.byteLength(process.env[key] || '') < 32) throw new Error(`${key} must be configured privately before starting OpenClaw.`);
}
const state = process.env.OPENCLAW_STATE_DIR || '/home/node/.openclaw';
mkdirSync(state, { recursive: true, mode: 0o700 });
const configPath = `${state}/openclaw.json`;
writeFileSync(configPath, JSON.stringify(gatewayConfiguration({ model: process.env.POLYMATE_LLM_MODEL || DEFAULT_MODEL,
  thinking: process.env.POLYMATE_LLM_THINKING || DEFAULT_THINKING, fastMode: process.env.POLYMATE_LLM_FAST === 'true',
  pluginPath: '/opt/openclaw/node_modules/@polymate/openclaw-agent-plugin', workspace: `${state}/workspace`, bind: 'lan' }), null, 2), { mode: 0o600 });
const child = spawn(process.execPath, ['/opt/openclaw/node_modules/openclaw/openclaw.mjs', 'gateway', 'run'], {
  stdio: 'inherit', env: { ...process.env, OPENCLAW_CONFIG_PATH: configPath },
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
