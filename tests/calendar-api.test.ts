import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { resolveOwner } from '../packages/core/src/identity';
import { GET, POST } from '../apps/web/app/api/calendar/events/route';
import { PATCH, DELETE } from '../apps/web/app/api/calendar/events/[id]/route';
import { POST as complete } from '../apps/web/app/api/calendar/events/[id]/complete/route';
import { GET as csrf } from '../apps/web/app/api/calendar/csrf/route';
import { CalendarBusyError } from '../packages/core/calendar/operations';
import { syncStudyCalendarRead } from '../packages/db/src/study-progress';
import type { CalendarEvent } from '@polymate/contracts/calendar';

const mocks = vi.hoisted(() => ({ token: vi.fn(), connection: vi.fn(), ensureUser: vi.fn(), begin: vi.fn(), finish: vi.fn(), lock: vi.fn(),
  listEvents: vi.fn(), findEvent: vi.fn(), createEvent: vi.fn(), updateEvent: vi.fn(), completeEvent: vi.fn(), deleteEvent: vi.fn() }));
vi.mock('../packages/db/src/google-oauth', () => ({ getValidAccessToken: mocks.token, getConnectionStatus: mocks.connection, ensureUser: mocks.ensureUser }));
vi.mock('../packages/db/src/calendar-events', () => ({
  listStandaloneCalendarEvents: mocks.listEvents, findStandaloneCalendarEvent: mocks.findEvent,
  createStandaloneCalendarEvent: mocks.createEvent, updateStandaloneCalendarEvent: mocks.updateEvent,
  completeStandaloneCalendarEvent: mocks.completeEvent, deleteStandaloneCalendarEvent: mocks.deleteEvent,
}));
vi.mock('../packages/db/src/study-progress', () => ({ observeStudyCalendarChange: vi.fn(), syncStudyCalendarRead: vi.fn(), reserveBlockAssignment: vi.fn() }));
vi.mock('../packages/db/src/calendar-operations', () => ({ calendarOperationStore: {
  withOwnerLock: (owner: string, run: () => Promise<unknown>) => mocks.lock(owner, run),
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
let localEvents: Map<string, CalendarEvent>;

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('AUTH_MODE', 'managed-proxy');
  vi.stubEnv('MANAGED_PROXY_ONLY', 'true');
  vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('GOOGLE_ENABLED', 'true');
  localEvents = new Map();
  mocks.token.mockReset().mockResolvedValue('owner-access-token');
  mocks.connection.mockReset().mockResolvedValue({ connected: true });
  mocks.ensureUser.mockReset().mockResolvedValue(undefined);
  mocks.listEvents.mockReset().mockImplementation(async (_ownerId, range) => [...localEvents.values()].filter(event => event.startAt < range.to && event.endAt > range.from));
  mocks.findEvent.mockReset().mockImplementation(async (_ownerId, id) => localEvents.get(id) ?? null);
  mocks.createEvent.mockReset().mockImplementation(async (_owner, id, value) => {
    const event: CalendarEvent = { id, ...value, timezone: 'Europe/Zurich', allDay: false, source: 'polymate', editable: true, completion: 'open', etag: '"1"' };
    localEvents.set(id, event); return event;
  });
  mocks.updateEvent.mockReset().mockImplementation(async (_ownerId, id, changes, expectedVersion) => {
    const current = localEvents.get(id); if (!current || current.etag !== `"${expectedVersion}"`) return null;
    const event = { ...current, ...changes, etag: `"${expectedVersion + 1}"` }; localEvents.set(id, event); return event;
  });
  mocks.completeEvent.mockReset().mockImplementation(async (_ownerId, id, expectedVersion) => {
    const current = localEvents.get(id); if (!current || current.etag !== `"${expectedVersion}"`) return null;
    const event = { ...current, completion: 'done' as const, etag: `"${expectedVersion + 1}"` }; localEvents.set(id, event); return event;
  });
  mocks.deleteEvent.mockReset().mockImplementation(async (_ownerId, id, expectedVersion) => {
    const current = localEvents.get(id); if (!current || current.etag !== `"${expectedVersion}"`) return false;
    return localEvents.delete(id);
  });
  mocks.begin.mockReset().mockResolvedValue(null);
  mocks.finish.mockReset().mockResolvedValue(undefined);
  mocks.lock.mockReset().mockImplementation((_owner: string, run: () => Promise<unknown>) => run());
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

  it('uses the resolved owner and records that owner for a create', async () => {
    const fetcher = vi.fn(async (_url, init) => init.method === 'GET'
      ? Response.json({ items: [] }) : Response.json({ ...JSON.parse(init.body), etag: '"new"' }));
    vi.stubGlobal('fetch', fetcher);
    const response = await POST(request('POST', { operationId, block }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ operationId, status: 'synced', event: { source: 'polymate' } });
    const owner = resolveOwner(new Headers(headers));
    expect(mocks.ensureUser).toHaveBeenCalledWith(owner);
    expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({ ownerId: owner.userId }));
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toContain('/calendars/primary/events');
      expect(init.headers.authorization).toBe('Bearer owner-access-token');
      expect(init.method).toBe('GET');
    }
  });

  it('rejects non-PolyMate event mutations without an external write', async () => {
    const fetcher = vi.fn(async () => Response.json({ id: 'personal', etag: '"old"', summary: 'Lecture',
      start: { dateTime: block.startAt }, end: { dateTime: block.endAt } }));
    vi.stubGlobal('fetch', fetcher);
    const action = { operationId, expectedEtag: '"old"' };
    for (const response of [
      await PATCH(request('PATCH', { ...action, changes: { title: 'Changed' } }), context),
      await complete(request('POST', action), context),
      await DELETE(request('DELETE', action), context),
    ]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ status: 'failed', error: { code: 'not_found' } });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports a held owner lock as a retryable 409 without logging or writing', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    mocks.lock.mockRejectedValue(new CalendarBusyError());
    const response = await POST(request('POST', { operationId, block }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'busy' } });
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns a no-store failure when local persistence fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [] })));
    mocks.createEvent.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await POST(request('POST', { operationId, block }));
    expect(response.status).toBe(500);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ operationId, status: 'failed', error: { code: 'unknown' } });
  });

  it('still lists Google events when progress metadata sync fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [] })));
    vi.mocked(syncStudyCalendarRead).mockRejectedValueOnce(new Error('relation "assignment_block_links" does not exist'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await GET(new NextRequest(`${origin}/api/calendar/events?from=2026-10-12T00:00:00Z&to=2026-10-19T00:00:00Z`, { headers }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ events: [] });
    expect(logged).toHaveBeenCalledWith('Study progress calendar sync failed.', expect.stringContaining('assignment_block_links'));
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
