import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import type { CalendarEvent, OperationResult } from '@polymate/contracts/calendar';
import type { OperationRecord } from '../packages/core/calendar/operations';
import type { GoogleEvent } from '../packages/core/calendar/google-api';
import { POST as create } from '../apps/web/app/api/calendar/study-blocks/route';
import { PATCH as update, DELETE as remove } from '../apps/web/app/api/calendar/study-blocks/[id]/route';
import { POST as complete } from '../apps/web/app/api/calendar/study-blocks/[id]/complete/route';
import { GET as list } from '../apps/web/app/api/calendar/events/route';
import { GET as operations } from '../apps/web/app/api/calendar/operations/route';
import { POST as reconcile } from '../apps/web/app/api/calendar/operations/[id]/reconcile/route';
import { GET as csrf } from '../apps/web/app/api/calendar/csrf/route';
import { createStudyCalendarClient } from '../apps/web/components/study/study-calendar-client';
import { resolveOwner } from '../packages/core/src/identity';
import { eventIdForOperation } from '../packages/core/calendar/mapping';

const mocks = vi.hoisted(() => ({ token: vi.fn(), connection: vi.fn(), ensureUser: vi.fn(), begin: vi.fn(), finish: vi.fn(), find: vi.fn(), list: vi.fn(),
  listEvents: vi.fn(), findEvent: vi.fn(), createEvent: vi.fn(), updateEvent: vi.fn(), completeEvent: vi.fn(), deleteEvent: vi.fn() }));
vi.mock('../packages/db/src/google-oauth', () => ({ getValidAccessToken: mocks.token, getConnectionStatus: mocks.connection, ensureUser: mocks.ensureUser }));
vi.mock('../packages/db/src/calendar-events', () => ({
  listStandaloneCalendarEvents: mocks.listEvents, findStandaloneCalendarEvent: mocks.findEvent,
  createStandaloneCalendarEvent: mocks.createEvent, updateStandaloneCalendarEvent: mocks.updateEvent,
  completeStandaloneCalendarEvent: mocks.completeEvent, deleteStandaloneCalendarEvent: mocks.deleteEvent,
}));
vi.mock('../packages/db/src/study-progress', () => ({ observeStudyCalendarChange: vi.fn(), syncStudyCalendarRead: vi.fn(), reserveBlockAssignment: vi.fn() }));
vi.mock('../packages/db/src/calendar-operations', () => ({
  calendarOperationStore: { withOwnerLock: (_owner: string, run: () => Promise<unknown>) => run(), begin: mocks.begin, finish: mocks.finish },
  findCalendarOperation: mocks.find, listUnresolvedCalendarOperations: mocks.list,
}));

const origin = 'https://polymate.test';
const identity = 'student@example.test';
const input = { title: 'Attempt questions 1–2', startAt: '2026-10-12T09:00:00.000Z', endAt: '2026-10-12T09:50:00.000Z', timezone: 'Europe/Zurich' as const };
let ledger: Map<string, { record: OperationRecord; result: OperationResult | null }>;
let events: Map<string, CalendarEvent>;
let googleEvents: Map<string, GoogleEvent>;
let cookie: string;
let version: number;
let unavailableReadback: boolean;

const google = vi.fn<typeof fetch>(async (url, init) => {
  const path = new URL(String(url)).pathname;
  const id = decodeURIComponent(path.split('/events/')[1] ?? '');
  const method = init?.method ?? 'GET';
  if (method === 'GET' && id) {
    if (unavailableReadback) return Response.json({ error: { message: 'Read unavailable' } }, { status: 503 });
    return googleEvents.has(id) ? Response.json(googleEvents.get(id)) : Response.json({}, { status: 404 });
  }
  if (method === 'GET') return Response.json({ items: [...googleEvents.values()] });
  if (method === 'POST') throw new Error('Google is a read-only overlay.');
  const saved = googleEvents.get(id);
  if (!saved) return Response.json({}, { status: 404 });
  if (new Headers(init?.headers).get('if-match') !== saved.etag) return Response.json({}, { status: 412 });
  if (method === 'DELETE') { googleEvents.delete(id); return new Response(null, { status: 204 }); }
  const next = { ...saved, ...JSON.parse(init!.body as string), etag: `"v${++version}"` };
  googleEvents.set(id, next);
  return Response.json(next);
});

const routeFetcher: typeof fetch = async (path, init) => {
  const url = new URL(String(path), origin);
  const headers = new Headers(init?.headers);
  headers.set('x-user-id', identity);
  headers.set('origin', origin);
  headers.set('cookie', cookie);
  const request = new NextRequest(url, { ...init, headers });
  const action = url.pathname.match(/^\/api\/calendar\/study-blocks\/([^/]+)(\/complete)?$/);
  const recovery = url.pathname.match(/^\/api\/calendar\/operations\/([^/]+)\/reconcile$/);
  let response: Response;
  if (url.pathname === '/api/calendar/csrf') response = await csrf(request);
  else if (url.pathname === '/api/calendar/operations') response = await operations(request);
  else if (recovery) response = await reconcile(request, { params: Promise.resolve({ id: recovery[1] }) });
  else if (url.pathname === '/api/calendar/events') response = await list(request);
  else if (url.pathname === '/api/calendar/study-blocks') response = await create(request);
  else if (action) {
    const context = { params: Promise.resolve({ id: decodeURIComponent(action[1]) }) };
    response = action[2] ? await complete(request, context) : init?.method === 'PATCH' ? await update(request, context) : await remove(request, context);
  } else throw new Error(`Unexpected route ${url.pathname}`);
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return response;
};

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('AUTH_MODE', 'managed-proxy'); vi.stubEnv('MANAGED_PROXY_ONLY', 'true');
  vi.stubEnv('APP_ORIGIN', origin); vi.stubEnv('GOOGLE_ENABLED', 'true');
  cookie = 'polymate_calendar_csrf=nonce'; version = 1; unavailableReadback = false;
  events = new Map();
  googleEvents = new Map([['personal', { id: 'personal', etag: '"p1"', summary: 'Lecture', start: { dateTime: '2026-10-12T15:00:00Z' }, end: { dateTime: '2026-10-12T16:00:00Z' } }]]);
  ledger = new Map(); google.mockClear(); vi.stubGlobal('fetch', google);
  mocks.token.mockReset().mockResolvedValue('test-access-token');
  mocks.connection.mockReset().mockResolvedValue({ connected: true });
  mocks.ensureUser.mockReset().mockResolvedValue(undefined);
  mocks.listEvents.mockReset().mockImplementation(async (_ownerId, range) => [...events.values()].filter(event => event.startAt < range.to && event.endAt > range.from));
  mocks.findEvent.mockReset().mockImplementation(async (_ownerId, id) => events.get(id) ?? null);
  mocks.createEvent.mockReset().mockImplementation(async (_owner, id, value) => {
    const event: CalendarEvent = { id, ...value, timezone: 'Europe/Zurich', allDay: false, source: 'polymate', editable: true, completion: 'open', etag: '"1"' };
    events.set(id, event); return event;
  });
  mocks.updateEvent.mockReset().mockImplementation(async (_ownerId, id, changes, expectedVersion) => {
    const current = events.get(id); if (!current || current.etag !== `"${expectedVersion}"`) return null;
    const event = { ...current, ...changes, etag: `"${expectedVersion + 1}"` }; events.set(id, event); return event;
  });
  mocks.completeEvent.mockReset().mockImplementation(async (_ownerId, id, expectedVersion) => {
    const current = events.get(id); if (!current || current.etag !== `"${expectedVersion}"`) return null;
    const event = { ...current, completion: 'done' as const, etag: `"${expectedVersion + 1}"` }; events.set(id, event); return event;
  });
  mocks.deleteEvent.mockReset().mockImplementation(async (_ownerId, id, expectedVersion) => {
    const current = events.get(id); if (!current || current.etag !== `"${expectedVersion}"`) return false;
    return events.delete(id);
  });
  mocks.begin.mockReset().mockImplementation(async record => {
    const prior = ledger.get(record.operationId);
    if (prior) return prior;
    ledger.set(record.operationId, { record, result: null }); return null;
  });
  mocks.finish.mockReset().mockImplementation(async (ownerId, result) => {
    const row = ledger.get(result.operationId);
    if (row?.record.ownerId === ownerId) row.result = result;
  });
  mocks.find.mockReset().mockImplementation(async (ownerId, operationId) => {
    const row = ledger.get(operationId); return row?.record.ownerId === ownerId ? row : null;
  });
  mocks.list.mockReset().mockImplementation(async ownerId => [...ledger.values()]
    .filter(row => row.record.ownerId === ownerId && (!row.result || ['pending', 'unknown'].includes(row.result.status)))
    .map(row => row.result ?? { operationId: row.record.operationId, status: 'pending' }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('dialog adapter → authenticated routes → standalone calendar service', () => {
  it('creates, moves, completes, reloads, and deletes through the decided flat contract', async () => {
    const client = createStudyCalendarClient({ fetcher: routeFetcher });
    expect(await client.loadUnresolved()).toEqual([]);
    const created = await client.onCreate(input);
    expect(created).toMatchObject({ status: 'synced', event: { title: input.title, source: 'polymate' } });
    const moved = await client.onUpdate(created.event!.id, { ...input, startAt: '2026-10-12T11:00:00Z', endAt: '2026-10-12T11:50:00Z' }, created.event!.etag);
    expect(moved.status).toBe('synced');
    const done = await client.onComplete(moved.event!.id, moved.event!.etag);
    expect(done.event?.completion).toBe('done');
    const reloaded = await routeFetcher('/api/calendar/events?from=2026-10-12T00:00:00Z&to=2026-10-19T00:00:00Z').then(response => response.json());
    expect(reloaded.events).toEqual(expect.arrayContaining([expect.objectContaining({ id: done.event!.id, completion: 'done' })]));
    expect((await client.onDelete(done.event!.id, done.event!.etag)).status).toBe('synced');
    expect(events.has(done.event!.id)).toBe(false);
    expect(googleEvents.has('personal')).toBe(true);
  });

  it('protects personal events and rejects stale ETags', async () => {
    const client = createStudyCalendarClient({ fetcher: routeFetcher });
    expect((await client.onUpdate('google_personal', input, '"p1"')).error?.code).toBe('not_found');
    expect((await client.onComplete('google_personal', '"p1"')).error?.code).toBe('not_found');
    expect((await client.onDelete('google_personal', '"p1"')).error?.code).toBe('not_found');
    const created = await client.onCreate(input);
    const stale = await client.onUpdate(created.event!.id, { ...input, title: 'Changed' }, '"outdated"');
    expect(stale.error?.code).toBe('conflict');
    expect(events.get(created.event!.id)?.title).toBe(input.title);
  });

  it('retries a definite overlap failure with a new attempt ID after availability changes', async () => {
    const client = createStudyCalendarClient({ fetcher: routeFetcher });
    const conflict = { ...input, startAt: '2026-10-12T15:00:00Z', endAt: '2026-10-12T15:50:00Z' };
    const failed = await client.onCreate(conflict);
    expect(failed.error?.code).toBe('overlap');
    googleEvents.delete('personal');
    const retried = await client.retryFailed(failed.operationId);
    expect(retried.status).toBe('synced');
    expect(retried.operationId).not.toBe(failed.operationId);
  });

  it('recovers a pending local create from durable event state without a second insert', async () => {
    const operationId = '00000000-0000-4000-8000-000000000001';
    const owner = resolveOwner(new Headers({ 'x-user-id': identity }));
    const id = eventIdForOperation(operationId);
    events.set(id, { id, title: input.title, startAt: input.startAt, endAt: input.endAt, timezone: 'Europe/Zurich', allDay: false,
      source: 'polymate', editable: true, completion: 'open', etag: '"1"' });
    ledger.set(operationId, { record: { operationId, ownerId: owner.userId, kind: 'create', targetEventId: id, expectedEtag: null,
      intendedChange: { title: input.title, startAt: input.startAt, endAt: input.endAt } }, result: null });
    const createCount = mocks.createEvent.mock.calls.length;
    const reloaded = createStudyCalendarClient({ fetcher: routeFetcher });
    expect(await reloaded.loadUnresolved()).toEqual([expect.objectContaining({ operationId, status: 'pending' })]);
    const confirmed = await reloaded.reconcile(operationId);
    expect(confirmed.status).toBe('synced');
    expect(reloaded.getBlockingOperation()).toBeNull();
    expect(mocks.createEvent).toHaveBeenCalledTimes(createCount);
  });

  it('never exposes another student’s operation or writes while reconciling a crashed pending record', async () => {
    const operationId = '00000000-0000-4000-8000-000000000001';
    const owner = resolveOwner(new Headers({ 'x-user-id': identity }));
    ledger.set(operationId, { record: { operationId, ownerId: owner.userId, kind: 'create', targetEventId: eventIdForOperation(operationId), expectedEtag: null, intendedChange: { title: input.title, startAt: input.startAt, endAt: input.endAt } }, result: null });
    const other = new NextRequest(`${origin}/api/calendar/operations`, { headers: { 'x-user-id': 'other@example.test' } });
    expect(await (await operations(other)).json()).toEqual({ operations: [] });
    const otherRequest = new NextRequest(`${origin}/api/calendar/operations/${operationId}/reconcile`, { method: 'POST', headers: { 'x-user-id': 'other@example.test', origin, cookie, 'x-csrf-token': 'nonce' } });
    expect((await reconcile(otherRequest, { params: Promise.resolve({ id: operationId }) })).status).toBe(404);
    expect(google).not.toHaveBeenCalled();
    const client = createStudyCalendarClient({ fetcher: routeFetcher });
    await client.loadUnresolved();
    expect((await client.reconcile(operationId)).status).toBe('unknown');
    expect(google.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('rejects missing CSRF, client-selected owners, and unsupported timezones before calendar writes', async () => {
    const operationId = '00000000-0000-4000-8000-000000000001';
    const headers = { 'x-user-id': identity, origin, cookie, 'content-type': 'application/json', 'x-csrf-token': 'nonce' };
    for (const [body, changes, status] of [
      [{ ...input, operationId }, { 'x-csrf-token': 'wrong' }, 403],
      [{ ...input, operationId, ownerId: 'someone-else' }, {}, 422],
      [{ ...input, operationId, timezone: 'UTC' }, {}, 422],
    ] as const) {
      const request = new NextRequest(`${origin}/api/calendar/study-blocks`, { method: 'POST', headers: { ...headers, ...changes }, body: JSON.stringify(body) });
      expect((await create(request)).status).toBe(status);
    }
    expect(google).not.toHaveBeenCalled();
  });

  it('authenticates and checks origin/CSRF before looking up a recovery record', async () => {
    const operationId = '00000000-0000-4000-8000-000000000001';
    const headers = { 'x-user-id': identity, origin, cookie, 'x-csrf-token': 'nonce' };
    for (const [change, status] of [
      [{ 'x-user-id': '' }, 401], [{ origin: 'https://other.test' }, 403], [{ 'x-csrf-token': 'wrong' }, 403],
    ] as const) {
      const request = new NextRequest(`${origin}/api/calendar/operations/${operationId}/reconcile`, { method: 'POST', headers: { ...headers, ...change } });
      expect((await reconcile(request, { params: Promise.resolve({ id: operationId }) })).status).toBe(status);
    }
    expect(mocks.find).not.toHaveBeenCalled();
    expect(google).not.toHaveBeenCalled();
  });
});
