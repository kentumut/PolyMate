import { describe, expect, it } from 'vitest';
import { agentSessionKey, ownerIdFromAgentSessionKey, signOpenClawToolEnvelope, verifyOpenClawToolEnvelope } from '../packages/core/agent/context';

const secret = 'test-agent-context-secret-with-at-least-32-bytes';
const first = '11111111-1111-5111-8111-111111111111';
const second = '22222222-2222-5222-8222-222222222222';

describe('signed agent ownership context', () => {
  it('round-trips a stable owner claim and rejects a forged or cross-owner key', () => {
    const key = agentSessionKey(first, secret);
    expect(ownerIdFromAgentSessionKey(`agent:main:${key}`, secret)).toBe(first);
    expect(() => ownerIdFromAgentSessionKey(key.replace(first, second), secret)).toThrow('not authorized');
    expect(() => ownerIdFromAgentSessionKey(agentSessionKey(second, secret), secret)).not.toThrow();
  });

  it('authenticates raw bridge bytes and enforces the timestamp window', () => {
    const rawBody = JSON.stringify({ sessionKey: agentSessionKey(first, secret), name: 'polymate_check_connections', arguments: {} });
    const timestamp = String(Date.now());
    const nonce = '11111111-aaaa-4aaa-8aaa-111111111111';
    const signature = signOpenClawToolEnvelope(rawBody, timestamp, nonce, secret);
    expect(verifyOpenClawToolEnvelope({ rawBody, timestamp, nonce, suppliedSignature: signature, secret })).toBe(true);
    expect(verifyOpenClawToolEnvelope({ rawBody: `${rawBody} `, timestamp, nonce, suppliedSignature: signature, secret })).toBe(false);
    expect(verifyOpenClawToolEnvelope({ rawBody, timestamp: String(Date.now() - 60_000), nonce, suppliedSignature: signature, secret })).toBe(false);
  });
});
