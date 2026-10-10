import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';

const mocks = vi.hoisted(() => ({ state: vi.fn(), complete: vi.fn() }));
vi.mock('../packages/db/src/onboarding', () => ({ getOnboardingState: mocks.state, completeOnboarding: mocks.complete }));

import { GET, POST } from '../apps/web/app/api/onboarding/route';

const origin = 'https://polymate.test';
const headers = { 'x-user-id': 'student@example.test', origin, 'content-type': 'application/json' };
const request = (method: 'GET' | 'POST', body?: unknown, changes: Record<string, string> = {}) => new NextRequest(`${origin}/api/onboarding`, {
  method, headers: { ...headers, ...changes }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const profile = { goal: 'deadline', sessionMinutes: 50, coachCadence: 'proactive' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AUTH_MODE', 'managed-proxy'); vi.stubEnv('MANAGED_PROXY_ONLY', 'true'); vi.stubEnv('APP_ORIGIN', origin);
  mocks.state.mockResolvedValue({ completed: false, profile: null });
  mocks.complete.mockResolvedValue({ completed: true, profile });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('onboarding API', () => {
  it('returns whether the signed-in student completed setup', async () => {
    const response = await GET(request('GET'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ completed: false, profile: null });
    expect(mocks.state).toHaveBeenCalledOnce();
  });

  it('saves validated choices only from the application origin', async () => {
    expect((await POST(request('POST', profile))).status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'student@example.test' }), profile);
    expect((await POST(request('POST', profile, { origin: 'https://attacker.example' }))).status).toBe(403);
    expect((await POST(request('POST', { ...profile, sessionMinutes: 45 }))).status).toBe(422);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });

  it('requires managed identity', async () => {
    expect((await GET(request('GET', undefined, { 'x-user-id': '' }))).status).toBe(401);
  });
});
