import { describe, expect, it } from 'vitest';
import { assertSameOrigin, resolveOwner } from '../packages/core/src/identity';

const production = { NODE_ENV: 'production', AUTH_MODE: 'managed-proxy', MANAGED_PROXY_ONLY: 'true' };
describe('managed identity boundary', () => {
  it('refuses production development identities', () => {
    expect(() => resolveOwner(new Headers(), { ...production, AUTH_MODE: 'development' })).toThrow('disabled');
  });
  it('fails closed until the ingress boundary is explicitly configured', () => {
    expect(() => resolveOwner(new Headers({ 'x-user-id': 'kent@ethz.ch' }), { ...production, MANAGED_PROXY_ONLY: 'false' })).toThrow('trust boundary');
  });
  it('rejects missing or multiple forwarded identities', () => {
    for (const value of ['', 'a@ethz.ch,b@ethz.ch', 'bad', 'a@ethz.ch\tother']) {
      expect(() => resolveOwner(new Headers({ 'x-user-id': value }), production)).toThrow();
    }
  });
  it('provides stable, isolated owners and decodes display names', () => {
    const a = resolveOwner(new Headers({ 'x-user-id': 'Kent@ethz.ch', 'x-user-name': 'Kent%20%C3%9Cmut' }), production);
    const same = resolveOwner(new Headers({ 'x-user-id': 'kent@ethz.ch' }), production);
    const other = resolveOwner(new Headers({ 'x-user-id': 'other@ethz.ch' }), production);
    expect(a.userId).toBe(same.userId);
    expect(a.userId).not.toBe(other.userId);
    expect(a.displayName).toBe('Kent Ümut');
    expect(a.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('ignores caller-supplied identities in local development', () => {
    const env = { NODE_ENV: 'development', AUTH_MODE: 'development' };
    expect(resolveOwner(new Headers(), env).userId).toBe(resolveOwner(new Headers({ 'x-user-id': 'victim@ethz.ch' }), env).userId);
  });
});

describe('browser mutation origin', () => {
  const env = { APP_ORIGIN: 'https://07.hackathon.ethz.ch' };
  it('accepts only the configured origin', () => {
    const request = (origin: string) => new Request(`${env.APP_ORIGIN}/api/action`, { method: 'POST', headers: { origin } });
    expect(() => assertSameOrigin(request(env.APP_ORIGIN), env)).not.toThrow();
    expect(() => assertSameOrigin(request('https://attacker.invalid'), env)).toThrow();
    expect(() => assertSameOrigin(new Request(`${env.APP_ORIGIN}/api/action`), env)).toThrow();
  });
  it('allows the local preview origin only in development', () => {
    const request = new Request('http://127.0.0.1:3000/api/action', { headers: { origin: 'http://127.0.0.1:3000' } });
    expect(() => assertSameOrigin(request, { NODE_ENV: 'development' })).not.toThrow();
    expect(() => assertSameOrigin(request, { NODE_ENV: 'production' })).toThrow('not configured');
  });
});
