import { readFileSync } from 'node:fs';

export const OPENCLAW_VERSION = '2026.9.9';
export const DEFAULT_MODEL = 'openai/gpt-5.6-terra';

/** No provider or operator secrets are serialized into this configuration. */
export function gatewayConfiguration({ model = DEFAULT_MODEL, pluginPath, workspace, bind = 'loopback', port = 18789 }) {
  if (!/^openai\/[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Choose an openai/<model-id> model.');
  const manifest = JSON.parse(readFileSync(new URL('../integrations/openclaw-agent-plugin/openclaw.plugin.json', import.meta.url), 'utf8'));
  const tools = manifest.contracts.tools;
  return {
    gateway: { mode: 'local', bind, port, auth: { mode: 'token' },
      http: { endpoints: { chatCompletions: { enabled: true } } }, tools: { allow: ['cron'] } },
    agents: {
      ownership: 'explicit',
      defaults: { model: { primary: model }, models: { [model]: { agentRuntime: { id: 'openclaw' } } },
        workspace, skipBootstrap: true, userTimezone: 'Europe/Zurich', skills: [], heartbeat: { every: '0m' } },
      entries: { main: { tools: { allow: tools } }, 'polymate-scheduler': { tools: { allow: ['cron'] } } },
    },
    tools: { allow: [...tools, 'cron'] },
    plugins: { allow: ['polymate-agent'], slots: { memory: 'none' }, load: { paths: [pluginPath] },
      entries: { 'polymate-agent': { enabled: true } } },
    browser: { enabled: false },
  };
}
