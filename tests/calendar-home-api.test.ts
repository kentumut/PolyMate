import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { GET as listEvents, POST as createEvent } from '../apps/web/app/api/calendar/events/route';
import { GET as readHome, POST as changeHome } from '../apps/web/app/api/calendar/home/route';
import { POST as disconnect } from '../apps/web/app/api/integrations/google/disconnect/route';
import { beginAgentTurn, endAgentTurn } from '../apps/web/lib/agent-runtime';
import { resolveOwner } from '../packages/core/src/identity';
import type { GoogleEvent } from '../packages/core/calendar/google-api';
import type { CalendarEvent } from '@polymate/contracts/calendar';

const mocks = vi.hoisted(() => ({
  status: vi.fn(), setHome: vi.fn(), disconnect: vi.fn(), unresolved: vi.fn(), begin: vi.fn(),
  list: vi.fn(), create: vi.fn(), put: vi.fn(), remove: vi.fn(),
}));
vi.mock('../packages/db/src/google-oauth', () => ({
  getConnectionStatus: mocks.status, setCalendarHome: mocks.setHome, disconnectGoogle: mocks.disconnect,
  getValidAccessToken: async () => 'owner-access-token', ensureUser: async () => undefined,
}));
vi.mock('../packages/db/src/calendar-events', () => ({
  listStandaloneCalendarEvents: mocks.list, findStandaloneCalendarEvent: async () => null, createStandaloneCalendarEvent: mocks.create,
  updateStandaloneCalendarEvent: vi.fn(), completeStandaloneCalendarEvent: vi.fn(), deleteStandaloneCalendarEvent: vi.fn(),
  putStandaloneCalendarEvent: mocks.put, removeStandaloneCalendarEvent: mocks.remove,
}));
vi.mock('../packages/db/src/study-progress', () => ({ observeStudyCalendarChange: vi.fn(), syncStudyCalendarRead: vi.fn(), studyProgressStore: {} }));
vi.mock('../packages/db/src/calendar-operations', () => ({
  calendarOperationStore: { withOwnerLock: (_owner: string, run: () => Promise<unknown>) => run(), begin: mocks.begin, finish: async () => undefined },
  listUnresolvedCalendarOperations: mocks.unresolved, findCalendarOperation: async () => null,
}));

const origin = 'https://polymate.test';
const headers = { 'x-user-id': 'student@example.test', origin, 'content-type': 'application/json', cookie: 'polymate_calendar_csrf=nonce; polymate_google_csrf=nonce', 'x-csrf-token': 'nonce' };
const owner = () => resolveOwner(new Headers(headers));
const operationId = '00000000-0000-4000-8000-000000000001';
const block = { title: 'Sheet 3', startAt: '2026-10-12T10:00:00.000Z', endAt: '2026-10-12T10:50:00.000Z' };
const local = (id: string): CalendarEvent => ({ id, ...block, timezone: 'Europe/Zurich', allDay: false, source: 'polymate', editable: true, completion: 'open', etag: '"1"' });
const post = (path: string, body?: unknown, change: Record<string, string> = {}) => new NextRequest(`${origin}${path}`, {
  method: 'POST', headers: { ...headers, ...change }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
let google: Map<string, GoogleEvent>;
let googleWrites: string[];

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('AUTH_MODE', 'managed-proxy');
  vi.stubEnv('MANAGED_PROXY_ONLY', 'true');
  vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('GOOGLE_ENABLED', 'true');
  vi.stubEnv('AGENT_CONTEXT_SECRET', 'a'.repeat(64));
  google = new Map();
  googleWrites = [];
  mocks.status.mockReset().mockResolvedValue({ connected: true, calendarHome: 'polymate' });
  mocks.setHome.mockReset().mockResolvedValue(undefined);
  mocks.disconnect.mockReset().mockResolvedValue(undefined);
  mocks.unresolved.mockReset().mockResolvedValue([]);
  mocks.begin.mockReset().mockResolvedValue(null);
  mocks.list.mockReset().mockResolvedValue([]);
  mocks.create.mockReset().mockImplementation(async (_owner, id, input) => ({ ...local(id), ...input }));
  mocks.put.mockReset().mockResolvedValue(undefined);
  mocks.remove.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init: RequestInit) => {
    const url = new URL(String(input));
    const id = decodeURIComponent(url.pathname.split('/events/')[1] ?? '');
    const method = init.method ?? 'GET';
    if (method !== 'GET') googleWrites.push(`${method} ${id}`);
    if (method === 'GET' && !id) return Response.json({ items: [...google.values()] });
    if (method === 'POST') {
      const event = { ...JSON.parse(String(init.body)), etag: '"g1"' } as GoogleEvent;
      google.set(event.id, event);
      return Response.json(event);
    }
    const current = google.get(id);
    if (!current) return Response.json({ error: { errors: [{ reason: 'notFound' }] } }, { status: 404 });
    if (method === 'DELETE') { google.delete(id); return new Response(null, { status: 204 }); }
    return Response.json(current);
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('study-block home routing', () => {
  it('keeps blocks in PolyMate by default and never writes to Google', async () => {
    const response = await createEvent(post('/api/calendar/events', { operationId, block }));
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(googleWrites).toEqual([]);
  });

  it('writes to Google when the student chose Google, and shows those blocks in PolyMate', async () => {
    mocks.status.mockResolvedValue({ connected: true, calendarHome: 'google' });
    const response = await createEvent(post('/api/calendar/events', { operationId, block }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'synced', event: { source: 'polymate', editable: true, title: 'Sheet 3' } });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(googleWrites).toEqual(['POST ']);
    const list = await listEvents(new NextRequest(`${origin}/api/calendar/events?from=2026-10-12T00:00:00Z&to=2026-10-19T00:00:00Z`, { headers }));
    expect((await list.json()).events).toEqual([expect.objectContaining({ title: 'Sheet 3', source: 'polymate', editable: true })]);
  });

  it('does not fall back to PolyMate when Google is unreachable', async () => {
    mocks.status.mockResolvedValue({ connected: false, calendarHome: 'google' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { errors: [{ reason: 'authError' }] } }, { status: 401 })));
    const response = await listEvents(new NextRequest(`${origin}/api/calendar/events?from=2026-10-12T00:00:00Z&to=2026-10-19T00:00:00Z`, { headers }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'not_connected' } });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('uses PolyMate for everyone while Google is not configured', async () => {
    vi.stubEnv('GOOGLE_ENABLED', 'false');
    mocks.status.mockResolvedValue({ connected: true, calendarHome: 'google' });
    expect(await (await readHome(new NextRequest(`${origin}/api/calendar/home`, { headers }))).json()).toEqual({ home: 'polymate', googleEnabled: false, googleConnected: false });
  });
});

describe('switching the study-block home', () => {
  it('requires the calendar CSRF token and a supported home', async () => {
    expect((await changeHome(post('/api/calendar/home', { home: 'google' }, { 'x-csrf-token': 'wrong' }))).status).toBe(403);
    expect((await changeHome(post('/api/calendar/home', { home: 'outlook' }))).status).toBe(422);
    expect((await changeHome(post('/api/calendar/home', { home: 'google', ownerId: 'other' }))).status).toBe(422);
    expect(mocks.setHome).not.toHaveBeenCalled();
  });

  it('previews how many upcoming blocks would move without changing anything', async () => {
    mocks.list.mockResolvedValue([local('pm00000000000000000000000000000001'), local('pm00000000000000000000000000000002')]);
    const response = await changeHome(post('/api/calendar/home', { home: 'google' }));
    expect(await response.json()).toEqual({ home: 'polymate', upcomingBlocks: 2 });
    expect(googleWrites).toEqual([]);
    expect(mocks.setHome).not.toHaveBeenCalled();
  });

  it('moves upcoming blocks to Google under the same IDs, then records the choice', async () => {
    const ids = ['pm00000000000000000000000000000001', 'pm00000000000000000000000000000002'];
    mocks.list.mockResolvedValue(ids.map(local));
    const response = await changeHome(post('/api/calendar/home', { home: 'google', confirm: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ home: 'google', total: 2, moved: 2, complete: true });
    expect([...google.keys()]).toEqual(ids);
    expect(mocks.remove.mock.calls.map(call => call[1])).toEqual(ids);
    expect(mocks.setHome).toHaveBeenCalledWith(owner().userId, 'google');
  });

  it('keeps the old choice and the uncopied blocks when Google fails mid-move', async () => {
    mocks.list.mockResolvedValue([local('pm00000000000000000000000000000001'), local('pm00000000000000000000000000000002')]);
    const fetcher = vi.mocked(fetch);
    const original = fetcher.getMockImplementation()!;
    let posts = 0;
    fetcher.mockImplementation(async (input, init) => init?.method === 'POST' && ++posts === 2
      ? Response.json({ error: { errors: [{ reason: 'backendError' }] } }, { status: 503 }) : original(input, init));
    const response = await changeHome(post('/api/calendar/home', { home: 'google', confirm: true }));
    expect(response.status).toBe(503);
    expect((await response.json()).error.message).toContain('Moved 1 of 2');
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.setHome).not.toHaveBeenCalled();
  });

  it('moves Google blocks back to PolyMate', async () => {
    mocks.status.mockResolvedValue({ connected: true, calendarHome: 'google' });
    await createEvent(post('/api/calendar/events', { operationId, block: { ...block, startAt: '2027-01-12T10:00:00.000Z', endAt: '2027-01-12T10:50:00.000Z' } }));
    const [id] = google.keys();
    const response = await changeHome(post('/api/calendar/home', { home: 'polymate', confirm: true }));
    expect(await response.json()).toMatchObject({ home: 'polymate', moved: 1, complete: true });
    expect(mocks.put).toHaveBeenCalledWith(owner(), expect.objectContaining({ id, title: 'Sheet 3', completion: 'open' }));
    expect(google.size).toBe(0);
    expect(mocks.setHome).toHaveBeenCalledWith(owner().userId, 'polymate');
  });

  it('refuses Google without a connection, and while a calendar change is unconfirmed', async () => {
    mocks.status.mockResolvedValue({ connected: false, calendarHome: 'polymate' });
    expect(await (await changeHome(post('/api/calendar/home', { home: 'google', confirm: true }))).json()).toMatchObject({ error: { code: 'not_connected' } });
    mocks.status.mockResolvedValue({ connected: true, calendarHome: 'polymate' });
    mocks.unresolved.mockResolvedValue([{ operationId, status: 'unknown' }]);
    const response = await changeHome(post('/api/calendar/home', { home: 'google', confirm: true }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'pending_operations' } });
    expect(mocks.setHome).not.toHaveBeenCalled();
    expect(googleWrites).toEqual([]);
  });

  it('waits for an active chat turn instead of switching under it', async () => {
    const { turn } = beginAgentTurn(post('/api/agent/chat', { message: 'Hi' }), owner(), { message: 'Hi' });
    try {
      const response = await changeHome(post('/api/calendar/home', { home: 'google', confirm: true }));
      expect(response.status).toBe(409);
      expect(mocks.setHome).not.toHaveBeenCalled();
    } finally { endAgentTurn(turn.sessionKey); }
  });

  it('blocks disconnecting Google while study blocks live there', async () => {
    mocks.disconnect.mockRejectedValue(Object.assign(new Error('Your study blocks are saved in Google Calendar.'), { name: 'CalendarHomeInUseError' }));
    const response = await disconnect(post('/api/integrations/google/disconnect'));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'calendar_home_in_use' } });
  });
});
