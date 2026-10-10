import { describe, expect, it } from 'vitest';
import { AGENT_TOOL_DEFINITIONS } from '../packages/core/agent/tool-definitions';
import { verifyOpenClawToolEnvelope } from '../packages/core/agent/context';

describe('OpenClaw plugin contract', () => {
  it('ships tool schemas generated from the canonical PolyMate declarations', async () => {
    const definitions = JSON.parse(await (await import('node:fs/promises')).readFile(
      new URL('../integrations/openclaw-agent-plugin/moodle-tool-definitions.json', import.meta.url), 'utf8')) as unknown;
    expect(definitions).toEqual(AGENT_TOOL_DEFINITIONS);
    const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../integrations/openclaw-agent-plugin/openclaw.plugin.json', import.meta.url), 'utf8'));
    expect(manifest.contracts.tools).toEqual(AGENT_TOOL_DEFINITIONS.map(tool => tool.name));
  });

  it('signs the exact callback body without adding an owner argument', async () => {
    const { signedRequestBody } = await import('../integrations/openclaw-agent-plugin/bridge.mjs');
    const secret = 'bridge-test-secret-long-enough-for-hmac-validation';
    const signed = signedRequestBody('agent:main:pm.abc', 'polymate_check_connections', {}, secret, Date.now(), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(JSON.parse(signed.rawBody)).toEqual({ sessionKey: 'agent:main:pm.abc', name: 'polymate_check_connections', arguments: {} });
    expect(verifyOpenClawToolEnvelope({ rawBody: signed.rawBody, timestamp: signed.timestamp, nonce: signed.nonce, suppliedSignature: signed.signature, secret })).toBe(true);
  });
});
