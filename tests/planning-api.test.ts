import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { DEFAULT_STUDY_PREFERENCES, type StoredStudyPlan } from '../packages/contracts/src/planning';
import type { Assignment } from '../packages/contracts/src/assignments';
import type { CalendarEvent } from '../packages/contracts/src/calendar';
import { GET, POST } from '../apps/web/app/api/assignments/plan/route';
import { executePlanning } from '../apps/web/lib/planning';
import { FakeCalendarClient } from '../packages/core/calendar/fake-client';

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), latest: vi.fn(), preferences: vi.fn(), save: vi.fn(), update: vi.fn(),
  links: vi.fn(), unresolved: vi.fn(), operation: vi.fn(), calendar: vi.fn(), lock: vi.fn() }));
vi.mock('../packages/db/src/assignments', () => ({ listAssignments: mocks.list, AssignmentRequestConflict: class extends Error {} }));
vi.mock('../packages/db/src/planning', () => ({ getStudyPlan: mocks.get, getStudyPreferences: mocks.preferences, saveStudyPlan: mocks.save,
  updateStudyPlan: mocks.update, linkedStudyBlocks: mocks.links, withPlanningLock: mocks.lock }));
vi.mock('../packages/db/src/calendar-operations', () => ({ findCalendarOperation: mocks.operation, listUnresolvedCalendarOperations: mocks.unresolved }));
vi.mock('../packages/db/src/study-progress', () => ({ observeStudyCalendarChange: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../apps/web/lib/calendar-route', async original => ({ ...await original<typeof import('../apps/web/lib/calendar-route')>(), calendarServiceFor: mocks.calendar }));

const origin = 'https://polymate.test';
const headers = { 'x-user-id': 'student@example.test', origin, cookie: 'polymate_assignments_csrf=nonce', 'x-csrf-token': 'nonce', 'content-type': 'application/json' };
const now = new Date('2026-10-12T06:00:00Z');
const owner = { userId: '00000000-0000-4000-8000-000000000010', externalId: 'student@example.test', displayName: 'Student' };
const assignment: Assignment = { id: '00000000-0000-4000-8000-000000000001', title: 'Algorithms', dueAt: '2026-10-13T16:00:00Z',
  estimatedMinutes: 100, remainingMinutes: 100, status: 'open', version: 1 };
let saved: StoredStudyPlan | null;
let calendar: FakeCalendarClient & { listBusy: FakeCalendarClient['listWeek']; getStudyBlock: ReturnType<typeof vi.fn> };
const request = (body: unknown, changes = {}) => new NextRequest(`${origin}/api/assignments/plan`, { method: 'POST', headers: { ...headers, ...changes }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('AUTH_MODE', 'managed-proxy'); vi.stubEnv('MANAGED_PROXY_ONLY', 'true'); vi.stubEnv('APP_ORIGIN', origin);
  saved = null;
  const fake = new FakeCalendarClient([]);
  calendar = Object.assign(fake, { listBusy: fake.listWeek.bind(fake), getStudyBlock: vi.fn().mockResolvedValue(null) });
  mocks.calendar.mockReturnValue(calendar); mocks.list.mockResolvedValue([assignment]); mocks.preferences.mockResolvedValue(null);
  mocks.links.mockResolvedValue([]); mocks.unresolved.mockResolvedValue([]); mocks.operation.mockResolvedValue(null);
  mocks.lock.mockImplementation((_owner, run) => run());
  mocks.get.mockImplementation((_owner, id) => saved && (!id || id === saved.plan.id) ? structuredClone(saved) : null);
  mocks.save.mockImplementation((_owner, snapshot) => { saved = structuredClone(snapshot); });
  mocks.update.mockImplementation((_owner, snapshot) => { saved = structuredClone(snapshot); });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('manual assignment planning journey', () => {
  it('previews without writing, persists preferences, applies only the saved draft, and safely retries', async () => {
    const create = vi.spyOn(calendar, 'createStudyBlock');
    const generated = await POST(request({ action: 'generate', preferences: DEFAULT_STUDY_PREFERENCES }));
    expect(generated.status).toBe(200);
    const preview = await generated.json();
    expect(preview.plan.blocks).toHaveLength(2); expect(create).not.toHaveBeenCalled();
    expect(mocks.save.mock.calls[0][1].assignments).toEqual([assignment]);
    const response = await POST(request({ action: 'apply', planId: preview.plan.id, allowPartial: false }));
    expect(response.status).toBe(200);
    const applied = await response.json();
    expect(applied.results.map((item: { status: string }) => item.status)).toEqual(['synced', 'synced']);
    mocks.operation.mockImplementation(async (_owner, id) => ({ result: saved?.results.find(result => result.operationId === id) }));
    const retry = await POST(request({ action: 'apply', planId: preview.plan.id, allowPartial: false }));
    expect(retry.status).toBe(200);
    expect(await calendar.listWeek(preview.plan.horizon)).toHaveLength(2);
    const reloaded = await GET(new NextRequest(`${origin}/api/assignments/plan`, { headers }));
    expect((await reloaded.json()).plan.id).toBe(preview.plan.id);
    expect(reloaded.headers.get('cache-control')).toBe('no-store');
  });

  it('requires identity, origin, assignment CSRF and an exact action before any service call', async () => {
    for (const [changes, status] of [[{ 'x-user-id': '' }, 401], [{ origin: 'https://other.test' }, 403], [{ 'x-csrf-token': 'wrong' }, 403]] as const) {
      expect((await POST(request({ action: 'generate', preferences: DEFAULT_STUDY_PREFERENCES }, changes))).status).toBe(status);
    }
    expect((await POST(request({ action: 'apply', planId: crypto.randomUUID(), allowPartial: false, ownerId: 'other' }))).status).toBe(422);
    expect(mocks.lock).not.toHaveBeenCalled();
    expect((await GET(new NextRequest(`${origin}/api/assignments/plan`))).status).toBe(401);
  });

  it('rejects expired previews, changed assignments, fresh conflicts, and foreign plan IDs', async () => {
    const generated = await executePlanning(owner, { action: 'generate', preferences: DEFAULT_STUDY_PREFERENCES });
    const action = { action: 'apply' as const, planId: generated.plan!.id, allowPartial: false };
    await expect(executePlanning(owner, { ...action, planId: crypto.randomUUID() })).rejects.toThrow('unavailable');
    mocks.list.mockResolvedValue([{ ...assignment, remainingMinutes: 50, version: 2 }]);
    await expect(executePlanning(owner, action)).rejects.toThrow('Assignments changed');
    mocks.list.mockResolvedValue([assignment]);
    vi.spyOn(calendar, 'listBusy').mockResolvedValue([{ ...generated.plan!.blocks[0], id: 'personal', source: 'google-personal' } as CalendarEvent]);
    await expect(executePlanning(owner, action)).rejects.toThrow('commitments changed');
    vi.setSystemTime(new Date(now.getTime() + 31 * 60000));
    await expect(executePlanning(owner, action)).rejects.toThrow('expired');
  });

  it('requires separate partial approval and stops after the first uncertain write', async () => {
    const preview = await executePlanning(owner, { action: 'generate', preferences: { ...DEFAULT_STUDY_PREFERENCES, weeklyMinutes: 50 } });
    expect(preview.plan!.unscheduled[0].remainingMinutes).toBe(50);
    const action = { action: 'apply' as const, planId: preview.plan!.id, allowPartial: false };
    await expect(executePlanning(owner, action)).rejects.toThrow('Explicitly choose');
    const create = vi.spyOn(calendar, 'createStudyBlock').mockImplementation(async (_input, operationId) => ({ operationId, status: 'unknown' }));
    const applied = await executePlanning(owner, { ...action, allowPartial: true });
    expect(applied.results[0].status).toBe('unknown'); expect(create).toHaveBeenCalledTimes(1);
    expect(saved?.approved).toBe(true);
    mocks.unresolved.mockResolvedValue([{ operationId: preview.plan!.blocks[0].operationId, status: 'unknown' }]);
    await expect(executePlanning(owner, { action: 'generate', preferences: DEFAULT_STUDY_PREFERENCES })).rejects.toThrow('pending calendar');
  });

  it('preserves current linked Google blocks on the next plan and rejects moved links on apply', async () => {
    const existing: CalendarEvent = { id: 'linked', title: assignment.title, source: 'polymate', editable: true, etag: 'v1', completion: 'open',
      timezone: 'Europe/Zurich', allDay: false, startAt: '2026-10-12T07:00:00Z', endAt: '2026-10-12T07:50:00Z' };
    mocks.links.mockResolvedValue([{ assignmentId: assignment.id, eventId: existing.id }]);
    calendar.getStudyBlock.mockResolvedValue(existing); vi.spyOn(calendar, 'listBusy').mockResolvedValue([existing]);
    const preview = await executePlanning(owner, { action: 'generate', preferences: DEFAULT_STUDY_PREFERENCES });
    expect(preview.plan!.blocks).toHaveLength(1); expect(preview.plan!.preservedMinutes).toBe(50);
    calendar.getStudyBlock.mockResolvedValue({ ...existing, etag: 'v2' });
    await expect(executePlanning(owner, { action: 'apply', planId: preview.plan!.id, allowPartial: false })).rejects.toThrow('Existing study blocks changed');
  });

  it('allows an expired fully dispatched draft to reconcile using its original operation IDs', async () => {
    const preview = await executePlanning(owner, { action: 'generate', preferences: DEFAULT_STUDY_PREFERENCES });
    const action = { action: 'apply' as const, planId: preview.plan!.id, allowPartial: false };
    await executePlanning(owner, action);
    mocks.operation.mockImplementation(async (_owner, id) => ({ result: saved!.results.find(result => result.operationId === id) }));
    vi.setSystemTime(new Date(now.getTime() + 60 * 60000));
    const retry = await executePlanning(owner, action);
    expect(retry.results.every(result => result.status === 'synced')).toBe(true);
    expect(await calendar.listWeek(preview.plan!.horizon)).toHaveLength(2);
  });

  it('reconciles attempted blocks of an expired partial dispatch without starting unsent blocks', async () => {
    const preview = await executePlanning(owner, { action: 'generate', preferences: DEFAULT_STUDY_PREFERENCES });
    const action = { action: 'apply' as const, planId: preview.plan!.id, allowPartial: false };
    const create = vi.spyOn(calendar, 'createStudyBlock').mockImplementation(async (_input, operationId) => ({ operationId, status: 'unknown' }));
    await executePlanning(owner, action);
    expect(create).toHaveBeenCalledTimes(1);
    const attemptedId = preview.plan!.blocks[0].operationId;
    mocks.operation.mockImplementation(async (_owner, id) => id === attemptedId ? { result: { operationId: id, status: 'unknown' } } : null);
    create.mockImplementation(async (_input, operationId) => ({ operationId, status: 'synced' }));
    vi.setSystemTime(new Date(now.getTime() + 60 * 60000));
    const retry = await executePlanning(owner, action);
    expect(retry.results).toEqual([{ operationId: attemptedId, status: 'synced' }]);
    expect(retry.warning).toContain('expired');
    expect(create.mock.calls.map(([, id]) => id)).toEqual([attemptedId, attemptedId]);
  });
});
