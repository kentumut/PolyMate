import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import type { OperationResult } from '@polymate/contracts/calendar';
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

const mocks = vi.hoisted(() => ({ token: vi.fn(), begin: vi.fn(), finish: vi.fn(), find: vi.fn(), list: vi.fn() }));
vi.mock('../packages/db/src/google-oauth', () => ({ getValidAccessToken: mocks.token }));
vi.mock('../packages/db/src/calendar-operations', () => ({
  calendarOperationStore: { withOwnerLock: (_owner: string, run: () => Promise<unknown>) => run(), begin: mocks.begin, finish: mocks.finish },
  findCalendarOperation: mocks.find, listUnresolvedCalendarOperations: mocks.list,
}));

const origin = 'https://polymate.test';
const identity = 'student@example.test';
const input = { title: 'Attempt questions 1–2', startAt: '2026-10-12T09:00:00.000Z', endAt: '2026-10-12T09:50:00.000Z', timezone: 'Europe/Zurich' as const };
let ledger: Map<string, { record: OperationRecord; result: OperationResult | null }>;
let events: Map<string, GoogleEvent>;
let cookie: string;
let version: number;
let loseInsertReply: boolean;
let unavailableReadback: boolean;

const google = vi.fn<typeof fetch>(async (url, init) => {
  const path = new URL(String(url)).pathname;
  const id = decodeURIComponent(path.split('/events/')[1] ?? '');
  const method = init?.method ?? 'GET';
  if (method === 'GET' && id) {
    if (unavailableReadback) return Response.json({ error: { message: 'Read unavailable' } }, { status: 503 });
    return events.has(id) ? Response.json(events.get(id)) : Response.json({}, { status: 404 });
  }
  if (method === 'GET') return Response.json({ items: [...events.values()] });
  if (method === 'POST') {
    const event = { ...JSON.parse(init!.body as string), etag: `"v${++version}"` } as GoogleEvent;
    events.set(event.id!, event);
    if (loseInsertReply) throw new TypeError('Reply lost after Google applied the insert.');
    return Response.json(event);
  }
  const saved = events.get(id);
  if (!saved) return Response.json({}, { status: 404 });
  if (new Headers(init?.headers).get('if-match') !== saved.etag) return Response.json({}, { status: 412 });
  if (method === 'DELETE') { events.delete(id); return new Response(null, { status: 204 }); }
  const next = { ...saved, ...JSON.parse(init!.body as string), etag: `"v${++version}"` };
  events.set(id, next);
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
  cookie = 'polymate_calendar_csrf=nonce'; version = 1; loseInsertReply = false; unavailableReadback = false;
  events = new Map([['personal', { id: 'personal', etag: '"p1"', summary: 'Lecture', start: { dateTime: '2026-10-12T15:00:00Z' }, end: { dateTime: '2026-10-12T16:00:00Z' } }]]);
  ledger = new Map(); google.mockClear(); vi.stubGlobal('fetch', google);
  mocks.token.mockReset().mockResolvedValue('test-access-token');
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

describe('dialog adapter → authenticated routes → Google service (stubbed transport)', () => {
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
    expect(events.has('personal')).toBe(true);
  });

  it('protects personal events and rejects stale ETags', async () => {
    const client = createStudyCalendarClient({ fetcher: routeFetcher });
    expect((await client.onUpdate('personal', input, '"p1"')).error?.code).toBe('forbidden');
    expect((await client.onComplete('personal', '"p1"')).error?.code).toBe('forbidden');
    expect((await client.onDelete('personal', '"p1"')).error?.code).toBe('forbidden');
    const created = await client.onCreate(input);
    const stale = await client.onUpdate(created.event!.id, { ...input, title: 'Changed' }, '"outdated"');
    expect(stale.error?.code).toBe('conflict');
    expect(events.get(created.event!.id)?.summary).toBe(input.title);
  });

  it('retries a definite overlap failure with a new attempt ID after availability changes', async () => {
    const client = createStudyCalendarClient({ fetcher: routeFetcher });
    const conflict = { ...input, startAt: '2026-10-12T15:00:00Z', endAt: '2026-10-12T15:50:00Z' };
    const failed = await client.onCreate(conflict);
    expect(failed.error?.code).toBe('overlap');
    events.delete('personal');
    const retried = await client.retryFailed(failed.operationId);
    expect(retried.status).toBe('synced');
    expect(retried.operationId).not.toBe(failed.operationId);
  });

  it('recovers an uncertain insert after page reload and reconciles using reads, without a second insert', async () => {
    loseInsertReply = true; unavailableReadback = true;
    const first = createStudyCalendarClient({ fetcher: routeFetcher });
    const unknown = await first.onCreate(input);
    expect(unknown.status).toBe('unknown');
    const reloaded = createStudyCalendarClient({ fetcher: routeFetcher });
    expect(await reloaded.loadUnresolved()).toEqual([expect.objectContaining({ operationId: unknown.operationId, status: 'unknown' })]);
    expect((await reloaded.onDelete('personal', '"p1"')).status).toBe('unknown');
    unavailableReadback = false;
    const confirmed = await reloaded.reconcile(unknown.operationId);
    expect(confirmed.status).toBe('synced');
    expect(reloaded.getBlockingOperation()).toBeNull();
    expect(google.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
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

  it('rejects missing CSRF, client-selected owners, and unsupported timezones before Google writes', async () => {
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
