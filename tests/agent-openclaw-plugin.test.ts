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

  it('documents the exact timestamp format on every date argument the runtime parses', () => {
    const fields: Array<[string, Record<string, unknown>]> = [];
    const visit = (tool: string, schema: unknown) => {
      if (!schema || typeof schema !== 'object') return;
      for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
        if (['from', 'to', 'startAt', 'endAt'].includes(key) && value && typeof value === 'object' && (value as { type?: unknown }).type === 'string') fields.push([`${tool}.${key}`, value as Record<string, unknown>]);
        visit(tool, value);
      }
    };
    for (const tool of AGENT_TOOL_DEFINITIONS) visit(tool.name, tool.parameters);
    expect(fields.map(([name]) => name)).toEqual(expect.arrayContaining(['polymate_get_calendar.from', 'polymate_get_calendar.to', 'moodle_plan_assignment_timeline.startAt', 'polymate_create_study_block.startAt', 'polymate_move_study_block.endAt']));
    for (const [, schema] of fields) {
      expect(schema.description).toContain('+02:00');
      const pattern = new RegExp(String(schema.pattern));
      expect(pattern.test('2026-10-12T14:00:00+02:00')).toBe(true);
      expect(pattern.test('2026-10-12')).toBe(false);
      expect(pattern.test('2026-10-12T14:00:00')).toBe(false);
    }
  });

  it('signs the exact callback body without adding an owner argument', async () => {
    const { signedRequestBody } = await import('../integrations/openclaw-agent-plugin/bridge.mjs');
    const secret = 'bridge-test-secret-long-enough-for-hmac-validation';
    const signed = signedRequestBody('agent:main:pm.abc', 'polymate_check_connections', {}, secret, Date.now(), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(JSON.parse(signed.rawBody)).toEqual({ sessionKey: 'agent:main:pm.abc', name: 'polymate_check_connections', arguments: {} });
    expect(verifyOpenClawToolEnvelope({ rawBody: signed.rawBody, timestamp: signed.timestamp, nonce: signed.nonce, suppliedSignature: signed.signature, secret })).toBe(true);
  });
});
