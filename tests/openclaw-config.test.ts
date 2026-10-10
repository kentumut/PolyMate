import { describe, expect, it } from 'vitest';
// @ts-expect-error The setup scripts are plain Node modules.
import { gatewayConfiguration } from '../scripts/openclaw-config.mjs';
import { AGENT_TOOL_NAMES } from '../packages/core/agent/contracts';

describe('gateway deployment policy', () => {
  it('allows the canonical tools while isolating the scheduler and disabling ambient tools', () => {
    const config = gatewayConfiguration({ pluginPath: '/plugin', workspace: '/workspace' });
    expect([...config.agents.entries.main.tools.allow].sort()).toEqual([...AGENT_TOOL_NAMES].sort());
    expect(config.agents.entries['polymate-scheduler'].tools.allow).toEqual(['cron']);
    expect([...config.tools.allow].sort()).toEqual([...AGENT_TOOL_NAMES, 'cron'].sort());
    expect(config.gateway.auth.mode).toBe('token');
    expect(config.gateway.bind).toBe('loopback');
    expect(config.agents.defaults.skills).toEqual([]);
    expect(config.browser.enabled).toBe(false);
    expect(config.plugins.slots.memory).toBe('none');
  });
  it('uses the chosen OpenAI model in the embedded tool runtime', () => {
    const config = gatewayConfiguration({ model: 'openai/gpt-5.5', pluginPath: '/plugin', workspace: '/workspace' });
    expect(config.agents.defaults.model.primary).toBe('openai/gpt-5.5');
    expect(config.agents.defaults.models['openai/gpt-5.5'].agentRuntime.id).toBe('openclaw');
    expect(() => gatewayConfiguration({ model: 'openai/../../secret' })).toThrow();
  });
  it('defaults to low thinking without priority processing, and validates overrides', () => {
    const config = gatewayConfiguration({ pluginPath: '/plugin', workspace: '/workspace' });
    expect(config.agents.defaults.thinkingDefault).toBe('low');
    expect(config.agents.defaults.fastModeDefault).toBe(false);
    const tuned = gatewayConfiguration({ thinking: 'minimal', fastMode: true, pluginPath: '/plugin', workspace: '/workspace' });
    expect(tuned.agents.defaults.thinkingDefault).toBe('minimal');
    expect(tuned.agents.defaults.fastModeDefault).toBe(true);
    expect(() => gatewayConfiguration({ thinking: 'ultra', pluginPath: '/plugin', workspace: '/workspace' })).toThrow();
    expect(() => gatewayConfiguration({ fastMode: 'true', pluginPath: '/plugin', workspace: '/workspace' })).toThrow();
  });
});
