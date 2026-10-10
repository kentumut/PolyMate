import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { gatewayConfiguration, OPENCLAW_VERSION, DEFAULT_MODEL, DEFAULT_THINKING } from './openclaw-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = resolve(root, '.local/openclaw');
const runtime = resolve(local, 'runtime');
const state = resolve(local, 'state');
const providerPath = resolve(local, 'provider.env');
const webPath = resolve(root, 'apps/web/.env.local');
const command = process.argv[2] ?? 'setup';
const readEnv = path => existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
function run(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
mkdirSync(local, { recursive: true, mode: 0o700 });
if (!existsSync(providerPath)) writeFileSync(providerPath, `# Private; never commit or paste into chat.\nOPENAI_API_KEY=\nPOLYMATE_LLM_MODEL=${DEFAULT_MODEL}\n`, { mode: 0o600 });
chmodSync(providerPath, 0o600);
const provider = readEnv(providerPath);
const web = readEnv(webPath);
const cli = resolve(runtime, 'node_modules/openclaw/openclaw.mjs');
const pluginPath = resolve(runtime, 'node_modules/@polymate/openclaw-agent-plugin');
const env = { ...process.env, ...provider, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: resolve(state, 'openclaw.json'),
  OPENCLAW_GATEWAY_TOKEN: web.OPENCLAW_GATEWAY_TOKEN, OPENCLAW_AGENT_BRIDGE_SECRET: web.OPENCLAW_AGENT_BRIDGE_SECRET,
  POLYMATE_AGENT_TOOL_URL: `${web.APP_ORIGIN || 'http://127.0.0.1:3000'}/api/internal/agent/tools` };

if (command === 'setup') {
  if (!existsSync(webPath)) throw new Error('Create apps/web/.env.local with your database configuration first.');
  const installed = resolve(runtime, 'node_modules/openclaw/package.json');
  if (!existsSync(installed) || JSON.parse(readFileSync(installed)).version !== OPENCLAW_VERSION) {
    mkdirSync(runtime, { recursive: true });
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const npm = spawnSync(npmCommand, ['install', '--prefix', runtime, '--no-audit', '--no-fund', `openclaw@${OPENCLAW_VERSION}`], { stdio: 'inherit', shell: process.platform === 'win32' });
    if (npm.error) throw npm.error;
    if (npm.status !== 0) process.exit(npm.status ?? 1);
  }
  cpSync(resolve(root, 'integrations/openclaw-agent-plugin'), pluginPath, { recursive: true });
  run([cli, 'plugins', 'build', '--root', pluginPath, '--entry', './index.mjs']);
  run([cli, 'plugins', 'validate', '--root', pluginPath, '--entry', './index.mjs']);
  let contents = readFileSync(webPath, 'utf8');
  const settings = { OPENCLAW_GATEWAY_HTTP_URL: 'http://127.0.0.1:18789', OPENCLAW_AGENT_ID: 'main', OPENCLAW_SCHEDULER_AGENT_ID: 'polymate-scheduler' };
  for (const key of ['AGENT_CONTEXT_SECRET', 'OPENCLAW_GATEWAY_TOKEN', 'OPENCLAW_AGENT_BRIDGE_SECRET']) settings[key] = web[key] || randomBytes(32).toString('hex');
  for (const [key, value] of Object.entries(settings)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    contents = pattern.test(contents) ? contents.replace(pattern, () => line) : `${contents.trimEnd()}\n${line}\n`;
  }
  writeFileSync(webPath, contents, { mode: 0o600 });
  chmodSync(webPath, 0o600);
  mkdirSync(state, { recursive: true, mode: 0o700 });
  writeFileSync(env.OPENCLAW_CONFIG_PATH, JSON.stringify(gatewayConfiguration({ model: provider.POLYMATE_LLM_MODEL || DEFAULT_MODEL,
    thinking: provider.POLYMATE_LLM_THINKING || DEFAULT_THINKING, fastMode: provider.POLYMATE_LLM_FAST === 'true',
    pluginPath, workspace: resolve(state, 'workspace') }), null, 2) + '\n', { mode: 0o600 });
  console.log('Local gateway configured. Add your key in .local/openclaw/provider.env, run pnpm agent:start, and restart pnpm dev.');
} else if (command === 'start' || command === 'validate') {
  if (!provider.OPENAI_API_KEY?.trim()) throw new Error('Add OPENAI_API_KEY privately in .local/openclaw/provider.env first.');
  if (!existsSync(env.OPENCLAW_CONFIG_PATH)) throw new Error('Run pnpm agent:setup first.');
  run([cli, ...(command === 'start' ? ['gateway', 'run'] : ['config', 'validate'])], env);
} else throw new Error('Usage: node scripts/openclaw-local.mjs setup|start|validate');
