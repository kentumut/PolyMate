import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { GET, POST, DELETE } from '../apps/web/app/api/integrations/moodle/connection/route';
import { GET as read, POST as refresh } from '../apps/web/app/api/integrations/moodle/calendar/route';
import { executeMoodleTool } from '../apps/web/lib/moodle';
import { decryptSecret, encryptSecret } from '../packages/core/integrations/google-auth/crypto';
import { resolveOwner } from '../packages/core/src/identity';
import type { MoodleCalendarSubscription } from '../packages/db/src/moodle-calendar';
import type { MoodleSnapshot } from '../packages/contracts/src/moodle';

const state = vi.hoisted(() => ({ rows: new Map<string, MoodleCalendarSubscription>(), listWeek: vi.fn(), createStudyBlock: vi.fn() }));
vi.mock('../apps/web/lib/moodle-calendar-store', () => ({
  findCalendarSubscription: async (ownerId: string) => state.rows.get(ownerId) ?? null,
  saveCalendarSubscription: async (owner: { userId: string }, input: { site: string; url: string; snapshot: MoodleSnapshot }) => {
    state.rows.set(owner.userId, { connectionId: crypto.randomUUID(), site: input.site, urlCiphertext: encryptSecret(input.url), snapshot: input.snapshot, lastSyncedAt: input.snapshot.fetchedAt });
  },
  updateCalendarSnapshot: async (ownerId: string, connectionId: string, snapshot: MoodleSnapshot) => {
    const row = state.rows.get(ownerId);
    if (row?.connectionId === connectionId) { row.snapshot = snapshot; row.lastSyncedAt = snapshot.fetchedAt; }
  },
  deleteCalendarSubscription: async (ownerId: string) => { state.rows.delete(ownerId); },
}));
vi.mock('../apps/web/lib/calendar-route', async importOriginal => ({
  ...await importOriginal<typeof import('../apps/web/lib/calendar-route')>(),
  calendarServiceFor: () => state,
}));
const origin = 'https://polymate.test';
const site = 'https://moodle.test';
const secret = 'b'.repeat(32);
const subscriptionUrl = `${site}/calendar/export_execute.php?userid=7&authtoken=${secret}&preset_what=courses&preset_time=recentupcoming`;
const request = (method: string, body?: unknown, overrides: Record<string, string> = {}) => new NextRequest(`${origin}/api/integrations/moodle/connection`, {
  method, headers: { 'x-user-id': 'student@example.test', origin, 'content-type': 'application/json', ...overrides },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const ownerId = () => resolveOwner(request('GET').headers).userId;
const stamp = (value: number) => new Date(value).toISOString().replace(/[-:]/g, '').replace('.000', '');
const feed = (due = Date.now() + 5 * 3600_000, extra = '') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Moodle//EN\r\nBEGIN:VEVENT\r\nUID:42@moodle.test\r\nDTSTART:${stamp(due)}\r\nDTEND:${stamp(due)}\r\nSUMMARY:Sheet\r\nCATEGORIES:Analysis\r\nEND:VEVENT\r\n${extra}END:VCALENDAR`;
const fetchFeed = (raw = feed()) => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(raw)); vi.stubGlobal('fetch', fetcher); return fetcher;
};
const connect = () => POST(request('POST', { subscriptionUrl }));
const plan = async () => {
  const snapshot = state.rows.get(ownerId())!.snapshot;
  return await executeMoodleTool(request('POST'), 'moodle_plan_assignment_timeline', {
    work: [{ assignmentId: snapshot.calendarEvents![0].id, estimatedMinutes: 100 }],
    availability: [{ startAt: new Date(Date.now() + 3600_000).toISOString(), endAt: new Date(Date.now() + 4 * 3600_000).toISOString() }],
  }) as { planToken: string; timeline: { blocks: { operationId: string }[] } };
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T08:00:00Z'));
  vi.stubEnv('AUTH_MODE', 'managed-proxy'); vi.stubEnv('MANAGED_PROXY_ONLY', 'true'); vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('MOODLE_SITE_URL', site); vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  state.rows.clear(); state.listWeek.mockReset().mockResolvedValue([]);
  state.createStudyBlock.mockReset().mockImplementation(async (_input, operationId) => ({ operationId, status: 'synced' }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Moodle subscription API and planner', () => {
  it('checks identity, origin and site before fetching or storing the private URL', async () => {
    const fetcher = fetchFeed();
    expect((await POST(request('POST', { subscriptionUrl }, { origin: 'https://evil.test' }))).status).toBe(403);
    expect((await POST(request('POST', { subscriptionUrl }, { 'x-user-id': '' }))).status).toBe(401);
    expect((await POST(request('POST', { subscriptionUrl: subscriptionUrl.replace(site, 'https://evil.test') }))).status).toBe(422);
    expect(fetcher).not.toHaveBeenCalled(); expect(state.rows.size).toBe(0);
  });
  it('validates a feed before storing, returns only sanitized events and isolates owners', async () => {
    fetchFeed('<html>Log in</html>'); expect((await connect()).status).toBe(502); expect(state.rows.size).toBe(0);
    fetchFeed(); const response = await connect(); expect(response.status).toBe(200); expect(await response.text()).not.toContain(secret);
    const stored = state.rows.get(ownerId())!; expect(stored.urlCiphertext).not.toContain(secret); expect(decryptSecret(stored.urlCiphertext)).toBe(subscriptionUrl);
    const status = await GET(request('GET')); expect(await status.json()).toMatchObject({ connected: true, mode: 'calendar-subscription', eventCount: 1 });
    expect((await read(request('GET', undefined, { 'x-user-id': 'other@example.test' }))).status).toBe(409);
  });
  it('serves a five-minute cache, refreshes changed and removed dates, and disconnects', async () => {
    const fetcher = fetchFeed(); await connect();
    expect((await read(request('GET'))).status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(1);
    const oldId = state.rows.get(ownerId())!.snapshot.calendarEvents![0].id;
    fetcher.mockImplementation(async () => new Response(feed(Date.now() + 2 * 3600_000)));
    expect((await refresh(request('POST'))).status).toBe(200);
    expect(state.rows.get(ownerId())!.snapshot.calendarEvents![0].id).toBe(oldId);
    fetcher.mockImplementation(async () => new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR'));
    vi.setSystemTime(new Date(Date.now() + 5 * 60_000));
    expect((await (await read(request('GET'))).json()).snapshot.calendarEvents).toEqual([]);
    expect((await DELETE(request('DELETE'))).status).toBe(200); expect(state.rows.size).toBe(0);
    expect((await read(request('GET'))).status).toBe(409);
  });
  it('rejects cross-origin refreshes and reports failures without overwriting the last successful snapshot', async () => {
    const fetcher = fetchFeed(); await connect(); const snapshot = state.rows.get(ownerId())!.snapshot;
    expect((await refresh(request('POST', undefined, { origin: 'https://evil.test' }))).status).toBe(403);
    fetcher.mockRejectedValue(new Error(subscriptionUrl));
    const failed = await refresh(request('POST')); expect(failed.status).toBe(502); expect(await failed.text()).not.toContain(secret);
    expect(state.rows.get(ownerId())!.snapshot).toBe(snapshot);
  });
  it('rejects plans after replacing the feed, and rechecks changed dates before writing', async () => {
    const fetcher = fetchFeed(); await connect(); const first = await plan();
    await connect();
    await expect(executeMoodleTool(request('POST'), 'moodle_schedule_assignment_timeline', { planToken: first.planToken })).rejects.toThrow('different calendar connection');
    const next = await plan(); fetcher.mockImplementation(async () => new Response(feed(Date.now() + 30 * 60_000)));
    await expect(executeMoodleTool(request('POST'), 'moodle_schedule_assignment_timeline', { planToken: next.planToken })).rejects.toThrow('changed');
    expect(state.createStudyBlock).not.toHaveBeenCalled();
  });
  it('avoids Moodle event conflicts and retries uncertain writes with the same operation IDs', async () => {
    const lecture = `BEGIN:VEVENT\r\nUID:lecture\r\nDTSTART:20261010T090000Z\r\nDTEND:20261010T100000Z\r\nSUMMARY:Lecture\r\nEND:VEVENT\r\n`;
    fetchFeed(feed(undefined, lecture)); await connect();
    const snapshot = state.rows.get(ownerId())!.snapshot;
    snapshot.calendarEvents!.sort((a, b) => a.title.localeCompare(b.title)); // Select Sheet, not Lecture, below.
    const sheet = snapshot.calendarEvents!.find(event => event.title === 'Sheet')!;
    const draft = await executeMoodleTool(request('POST'), 'moodle_plan_assignment_timeline', {
      work: [{ assignmentId: sheet.id, estimatedMinutes: 100 }], availability: [{ startAt: '2026-10-10T09:00:00Z', endAt: '2026-10-10T12:00:00Z' }],
    }) as { planToken: string; timeline: { blocks: { startAt: string; operationId: string }[]; warnings: string[] } };
    expect(draft.timeline.blocks[0].startAt).toBe('2026-10-10T10:00:00.000Z');
    expect(draft.timeline.warnings.join(' ')).toContain('unknown');
    state.createStudyBlock.mockResolvedValueOnce({ status: 'unknown', operationId: draft.timeline.blocks[0].operationId });
    const first = await executeMoodleTool(request('POST'), 'moodle_schedule_assignment_timeline', { planToken: draft.planToken });
    expect(first).toMatchObject({ complete: false }); expect(state.createStudyBlock).toHaveBeenCalledTimes(1);
    const retry = await executeMoodleTool(request('POST'), 'moodle_schedule_assignment_timeline', { planToken: draft.planToken });
    expect(retry).toMatchObject({ complete: true });
    expect(state.createStudyBlock.mock.calls[1][1]).toBe(state.createStudyBlock.mock.calls[0][1]);
  });
  it('rejects a draft when a refreshed Moodle event occupies its study time', async () => {
    const fetcher = fetchFeed(); await connect(); const draft = await plan();
    const lecture = 'BEGIN:VEVENT\r\nUID:new-lecture\r\nDTSTART:20261010T090000Z\r\nDTEND:20261010T100000Z\r\nSUMMARY:Lecture\r\nEND:VEVENT\r\n';
    fetcher.mockImplementation(async () => new Response(feed(undefined, lecture)));
    await expect(executeMoodleTool(request('POST'), 'moodle_schedule_assignment_timeline', { planToken: draft.planToken })).rejects.toThrow('now conflict');
    expect(state.createStudyBlock).not.toHaveBeenCalled();
  });
});
