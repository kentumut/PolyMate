import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { resolveOwner } from '../packages/core/src/identity';
import { GET, POST } from '../apps/web/app/api/calendar/events/route';
import { PATCH, DELETE } from '../apps/web/app/api/calendar/events/[id]/route';
import { POST as complete } from '../apps/web/app/api/calendar/events/[id]/complete/route';
import { GET as csrf } from '../apps/web/app/api/calendar/csrf/route';

const mocks = vi.hoisted(() => ({ token: vi.fn(), begin: vi.fn(), finish: vi.fn() }));
vi.mock('../packages/db/src/google-oauth', () => ({ getValidAccessToken: mocks.token }));
vi.mock('../packages/db/src/calendar-operations', () => ({ calendarOperationStore: {
  withOwnerLock: async (_owner: string, run: () => Promise<unknown>) => run(),
  begin: mocks.begin, finish: mocks.finish,
} }));

const origin = 'https://polymate.test';
const operationId = '00000000-0000-4000-8000-000000000001';
const block = { title: 'Sheet 3', startAt: '2026-10-12T10:00:00.000Z', endAt: '2026-10-12T10:50:00.000Z' };
const headers = { 'x-user-id': 'student@example.test', origin, 'content-type': 'application/json',
  cookie: 'polymate_calendar_csrf=nonce', 'x-csrf-token': 'nonce' };
const request = (method: string, body: unknown, changes: Record<string, string> = {}) => new NextRequest(`${origin}/api/calendar/events`, {
  method, headers: { ...headers, ...changes }, body: JSON.stringify(body),
});
const context = { params: Promise.resolve({ id: 'personal' }) };

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('AUTH_MODE', 'managed-proxy');
  vi.stubEnv('MANAGED_PROXY_ONLY', 'true');
  vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('GOOGLE_ENABLED', 'true');
  mocks.token.mockReset().mockResolvedValue('owner-access-token');
  mocks.begin.mockReset().mockResolvedValue(null);
  mocks.finish.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('authenticated calendar API', () => {
  it('requires identity, the application origin, and a matching CSRF token before accessing Google', async () => {
    for (const [change, status] of [
      [{ 'x-user-id': '' }, 401], [{ origin: 'https://other.test' }, 403],
      [{ cookie: '' }, 403], [{ 'x-csrf-token': 'wrong' }, 403],
    ] as const) {
      const response = await POST(request('POST', { operationId, block }, change));
      expect(response.status).toBe(status);
    }
    expect(mocks.token).not.toHaveBeenCalled();
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied owner and invalid intervals before logging a write', async () => {
    for (const body of [{ operationId, block, ownerId: 'other' }, { operationId, block: { ...block, endAt: block.startAt } }]) {
      expect((await POST(request('POST', body))).status).toBe(422);
    }
    expect(mocks.begin).not.toHaveBeenCalled();
  });

  it('uses only the resolved owner token and records that owner for a create', async () => {
    const fetcher = vi.fn(async (_url, init) => init.method === 'GET'
      ? Response.json({ items: [] }) : Response.json({ ...JSON.parse(init.body), etag: '"new"' }));
    vi.stubGlobal('fetch', fetcher);
    const response = await POST(request('POST', { operationId, block }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ operationId, status: 'synced', event: { source: 'polymate' } });
    const owner = resolveOwner(new Headers(headers));
    expect(mocks.token).toHaveBeenCalledWith(owner);
    expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({ ownerId: owner.userId }));
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toContain('/calendars/primary/events');
      expect(init.headers.authorization).toBe('Bearer owner-access-token');
    }
  });

  it('rejects personal-event update, complete and delete without a Google write', async () => {
    const fetcher = vi.fn(async () => Response.json({ id: 'personal', etag: '"old"', summary: 'Lecture',
      start: { dateTime: block.startAt }, end: { dateTime: block.endAt } }));
    vi.stubGlobal('fetch', fetcher);
    const action = { operationId, expectedEtag: '"old"' };
    for (const response of [
      await PATCH(request('PATCH', { ...action, changes: { title: 'Changed' } }), context),
      await complete(request('POST', action), context),
      await DELETE(request('DELETE', action), context),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ status: 'failed', error: { code: 'forbidden' } });
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const call of fetcher.mock.calls as unknown as [URL, RequestInit][]) expect(call[1].method).toBe('GET');
  });

  it('returns 202 when a write is uncertain, with no-store headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      if (init.method === 'POST') throw new TypeError('timeout');
      if (String(_url).includes('/events/')) return Response.json({}, { status: 404 });
      return Response.json({ items: [] });
    }));
    const response = await POST(request('POST', { operationId, block }));
    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ operationId, status: 'unknown' });
  });

  it('validates read ranges and issues an HttpOnly CSRF cookie', async () => {
    const badRange = await GET(new NextRequest(`${origin}/api/calendar/events?from=invalid`, { headers }));
    expect(badRange.status).toBe(422);
    const response = await csrf(new NextRequest(`${origin}/api/calendar/csrf`, { headers }));
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
