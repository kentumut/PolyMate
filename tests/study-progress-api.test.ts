import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { POST as report } from '../apps/web/app/api/study-progress/reports/route';
import { POST as link } from '../apps/web/app/api/study-progress/links/route';
import { GET as state } from '../apps/web/app/api/study-progress/route';
import { GET as activity } from '../apps/web/app/api/study-progress/activity/route';
import { GET as csrf } from '../apps/web/app/api/study-progress/csrf/route';
import { POST as reschedule } from '../apps/web/app/api/study-progress/reschedule/route';
import { StudyProgressService } from '../packages/core/progress/service';
import { MemoryStudyProgressStore } from '../packages/core/progress/memory';
import { FakeCalendarClient } from '../packages/core/calendar/fake-client';
import type { Assignment } from '@polymate/contracts/assignments';
import { resolveOwner } from '../packages/core/src/identity';
import { createProgressClient } from '../apps/web/components/study/progress-client';

const mocks = vi.hoisted(() => ({ state: vi.fn(), link: vi.fn(), record: vi.fn(), attempt: vi.fn(), calendarResult: vi.fn(), activity: vi.fn(), calendar: vi.fn() }));
vi.mock('../packages/db/src/study-progress', () => ({ studyProgressStore: mocks, listStudyActivity: mocks.activity, observeStudyCalendarChange: vi.fn() }));
vi.mock('../packages/db/src/calendar-operations', () => ({ findCalendarOperation: vi.fn(async () => null), calendarOperationStore: {} }));
vi.mock('../apps/web/lib/calendar-route', async original => ({ ...await original<typeof import('../apps/web/lib/calendar-route')>(), calendarServiceFor: mocks.calendar }));
const origin = 'https://polymate.test';
const assignmentId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const headers = { 'x-user-id': 'student@example.test', origin, cookie: 'polymate_progress_csrf=nonce', 'x-csrf-token': 'nonce', 'content-type': 'application/json' };
const linkInput = { eventId: 'study1', assignmentId, expectedAssignmentVersion: 1, expectedEtag: '"1"' };
const reportInput = { ...linkInput, clientRequestId: requestId, expectedSessionRevision: 1, action: 'partly_done', remainingMinutes: 100 };
const request = (path: string, body: unknown, changes: Record<string,string> = {}) => new NextRequest(`${origin}/api/study-progress/${path}`, { method: 'POST', headers: { ...headers, ...changes }, body: JSON.stringify(body) });
let assignment: Assignment;
let cookie = headers.cookie;

beforeEach(() => {
  vi.clearAllMocks(); cookie = headers.cookie;
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('AUTH_MODE', 'managed-proxy'); vi.stubEnv('MANAGED_PROXY_ONLY', 'true'); vi.stubEnv('APP_ORIGIN', origin);
  assignment = { id: assignmentId, title: 'Sheet 4', dueAt: '2026-10-16T16:00:00Z', estimatedMinutes: 150, remainingMinutes: 150, status: 'open', version: 1 };
  const owner = resolveOwner(new Headers(headers));
  const store = new MemoryStudyProgressStore(owner.userId, async () => [assignment], next => { assignment = next; });
  for (const method of ['state','link','record','attempt','calendarResult'] as const) mocks[method].mockImplementation(store[method].bind(store));
  const calendar = new FakeCalendarClient([{ id: 'study1', title: 'Questions', startAt: '2026-10-12T09:00:00.000Z', endAt: '2026-10-12T09:50:00.000Z', allDay: false, timezone: 'Europe/Zurich', source: 'polymate', editable: true, completion: 'open', etag: '"1"' }]);
  mocks.calendar.mockReturnValue(calendar);
  mocks.activity.mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('authenticated progress API', () => {
  it('links a block, records progress, and reloads persisted state through a fresh client', async () => {
    const transport: typeof fetch = async (url, init) => {
      const path = String(url);
      const h = new Headers(init?.headers); h.set('x-user-id', headers['x-user-id']); h.set('origin', origin); h.set('cookie', cookie);
      const req = new NextRequest(new URL(path, origin), { ...init, headers: h });
      const response = path.endsWith('/csrf') ? await csrf(req) : path.endsWith('/links') ? await link(req) : path.endsWith('/reports') ? await report(req) : await state(req);
      const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0]; return response;
    };
    const client = createProgressClient({ fetcher: transport, createRequestId: () => requestId });
    await client.link(linkInput);
    const saved = await client.record({ ...reportInput, action: 'partly_done' });
    expect(saved.assignment.remainingMinutes).toBe(100);
    const reloaded = await createProgressClient({ fetcher: transport }).state();
    expect(reloaded.reports).toHaveLength(1); expect(reloaded.assignments[0].remainingMinutes).toBe(100);
    const replay = await report(request('reports', reportInput)); expect(replay.status).toBe(200); expect(assignment.version).toBe(2);
  });
  it('checks identity, origin and a progress-specific CSRF token before executing tools', async () => {
    for (const [change, code] of [[{ 'x-user-id': '' },401], [{ origin: 'https://other.test' },403], [{ cookie: 'polymate_calendar_csrf=nonce' },403], [{ 'x-csrf-token': 'wrong' },403]] as const) {
      expect((await report(request('reports', reportInput, change))).status).toBe(code);
      expect((await link(request('links', linkInput, change))).status).toBe(code);
    }
    expect(mocks.calendar).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled();
  });
  it('rejects model/browser-selected owners, malformed progress, and stale versions', async () => {
    await link(request('links', linkInput));
    expect((await report(request('reports', { ...reportInput, ownerId: 'other' }))).status).toBe(422);
    expect((await report(request('reports', { ...reportInput, action: 'stuck', note: '' }))).status).toBe(422);
    expect((await report(request('reports', { ...reportInput, expectedAssignmentVersion: 2 }))).status).toBe(409);
    expect(assignment.version).toBe(1);
  });
  it('binds state and activity reads to the resolved student and validates cursors', async () => {
    await state(new NextRequest(`${origin}/api/study-progress?ownerId=other`, { headers }));
    expect(mocks.state).toHaveBeenCalledWith(resolveOwner(new Headers(headers)).userId);
    expect((await activity(new NextRequest(`${origin}/api/study-progress/activity?after=-1`, { headers }))).status).toBe(422);
    const response = await activity(new NextRequest(`${origin}/api/study-progress/activity?after=12`, { headers }));
    expect(await response.json()).toEqual({ events: [], nextCursor: '12' });
    expect(mocks.activity).toHaveBeenCalledWith(resolveOwner(new Headers(headers)).userId, '12');
    expect((await state(new NextRequest(`${origin}/api/study-progress`))).status).toBe(401);
  });
  it('sets HttpOnly no-store progress-scoped credentials', async () => {
    const response = await csrf(new NextRequest(`${origin}/api/study-progress/csrf`, { headers }));
    expect(response.headers.get('set-cookie')).toContain('Path=/api/study-progress');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly'); expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('keeps the same service usable for a server-bound agent context', async () => {
    const owner = resolveOwner(new Headers(headers));
    const service = new StudyProgressService(owner.userId, mocks.calendar(), mocks);
    await service.link(linkInput);
    expect((await service.record({ ...reportInput, action: 'stuck', note: 'Question 2' })).report.note).toBe('Question 2');
  });
  it('reschedules the existing linked block through the calendar service and rejects stale revisions', async () => {
    await link(request('links', linkInput));
    const move = { eventId: 'study1', operationId: crypto.randomUUID(), expectedEtag: '"1"', expectedSessionRevision: 1,
      startAt: '2026-10-13T09:00:00.000Z', endAt: '2026-10-13T09:50:00.000Z' };
    expect((await reschedule(request('reschedule', { ...move, expectedSessionRevision: 2 }))).status).toBe(409);
    const response = await reschedule(request('reschedule', move));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'synced', event: { id: 'study1', startAt: move.startAt } });
    expect(assignment.remainingMinutes).toBe(150);
  });
});
