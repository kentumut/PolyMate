import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { GET, POST, DELETE } from '../apps/web/app/api/integrations/moodle/connection/route';
import { POST as run } from '../apps/web/app/api/integrations/moodle/tools/route';
import { MOODLE_FUNCTIONS } from '../packages/core/integrations/moodle/client';
import { decryptSecret, encryptSecret } from '../packages/core/integrations/google-auth/crypto';
import { resolveOwner } from '../packages/core/src/identity';

const calendar = vi.hoisted(() => ({ listWeek: vi.fn(), createStudyBlock: vi.fn() }));
vi.mock('../apps/web/lib/calendar-route', async importOriginal => ({
  ...await importOriginal<typeof import('../apps/web/lib/calendar-route')>(),
  calendarServiceFor: () => calendar,
}));

const origin = 'https://polymate.test';
const token = 'a'.repeat(32);
const request = (method: string, body?: unknown, changes: Record<string, string> = {}) => new NextRequest(`${origin}/api/integrations/moodle/connection`, {
  method, headers: { 'x-user-id': 'student@example.test', origin, 'content-type': 'application/json', ...changes },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const ownerId = () => resolveOwner(new Headers({ 'x-user-id': 'student@example.test' })).userId;
const cookie = () => `polymate_moodle=${encryptSecret(JSON.stringify({ ownerId: ownerId(), site: 'https://moodle.test', token, expiresAt: Date.now() + 60000 }))}`;

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('AUTH_MODE', 'managed-proxy'); vi.stubEnv('MANAGED_PROXY_ONLY', 'true');
  vi.stubEnv('APP_ORIGIN', origin); vi.stubEnv('MOODLE_SITE_URL', 'https://moodle.test');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64')); vi.stubEnv('GOOGLE_ENABLED', 'true');
  calendar.listWeek.mockReset().mockResolvedValue([]);
  calendar.createStudyBlock.mockReset().mockImplementation(async (_input, operationId) => ({ operationId, status: 'synced' }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Moodle authenticated connection and agent API', () => {
  it('requires same-origin requests and identity before transmitting a token', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await POST(request('POST', { token }, { origin: 'https://evil.test' }))).status).toBe(403);
    expect((await POST(request('POST', { token }, { 'x-user-id': '' }))).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('validates access and stores an encrypted owner-bound HttpOnly cookie without returning the token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ userid: 7, functions: MOODLE_FUNCTIONS.map(name => ({ name })) })));
    const response = await POST(request('POST', { token }));
    expect(response.status).toBe(200);
    const header = response.headers.get('set-cookie')!;
    expect(header).toContain('HttpOnly'); expect(header).toContain('Secure'); expect(header).toContain('SameSite=strict');
    expect(header).not.toContain(token);
    expect(await response.text()).not.toContain(token);
    const encrypted = header.split(';')[0].split('=')[1];
    expect(JSON.parse(decryptSecret(encrypted)).ownerId).toBe(ownerId());
    const status = await GET(request('GET', undefined, { cookie: `polymate_moodle=${encrypted}` }));
    expect(await status.json()).toMatchObject({ connected: true });
    expect(await (await GET(request('GET', undefined, { cookie: `polymate_moodle=${encrypted}`, 'x-user-id': 'other@example.test' }))).json()).toEqual({ connected: false });
    expect((await DELETE(request('DELETE'))).headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('refuses missing assignment permissions and accepts degraded announcement access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ userid: 7, functions: [{ name: 'core_webservice_get_site_info' }] })));
    expect((await POST(request('POST', { token }))).status).toBe(403);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => Response.json({ userid: 7, functions: MOODLE_FUNCTIONS.filter(name => !name.startsWith('mod_forum')).map(name => ({ name })) })));
    const response = await POST(request('POST', { token }));
    expect(response.status).toBe(200);
    expect((await response.json()).missingFunctions).toHaveLength(2);
  });

  it('rejects missing, tampered and cross-owner connections before retrieving Moodle data', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const body = { name: 'moodle_get_assignments_and_announcements', arguments: {} };
    expect((await run(request('POST', body))).status).toBe(409);
    expect((await run(request('POST', body, { cookie: 'polymate_moodle=invalid' }))).status).toBe(409);
    expect((await run(request('POST', body, { cookie: cookie(), 'x-user-id': 'other@example.test' }))).status).toBe(409);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects fabricated and cross-owner timeline tokens before any calendar writes', async () => {
    const response = await run(request('POST', { name: 'moodle_schedule_assignment_timeline', arguments: { planToken: 'invented' } }, { cookie: cookie() }));
    expect(response.status).toBe(422);
    const planToken = encryptSecret(JSON.stringify({ ownerId: 'different-owner', site: 'https://moodle.test', expiresAt: Date.now() + 60000, timeline: {} }));
    expect((await run(request('POST', { name: 'moodle_schedule_assignment_timeline', arguments: { planToken } }, { cookie: cookie() }))).status).toBe(403);
    expect(calendar.createStudyBlock).not.toHaveBeenCalled();
  });

  it('retrieves assignments, creates a sealed timeline and dispatches the exact draft to the calendar', async () => {
    const startAt = new Date(Date.now() + 3600000).toISOString();
    const endAt = new Date(Date.now() + 3 * 3600000).toISOString();
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const name = new URLSearchParams(String(init.body)).get('wsfunction');
      const data: Record<string, unknown> = {
        core_webservice_get_site_info: { userid: 7, functions: MOODLE_FUNCTIONS.map(name => ({ name })) },
        core_enrol_get_users_courses: [{ id: 3, fullname: 'Analysis' }],
        mod_assign_get_assignments: { courses: [{ id: 3, assignments: [{ id: 9, cmid: 12, name: 'Sheet', intro: 'Prove theorem', duedate: Math.floor(Date.parse(endAt) / 1000) + 3600, allowsubmissionsfromdate: 0 }] }], warnings: [] },
        mod_forum_get_forums_by_courses: [],
        mod_assign_get_submission_status: { lastattempt: { submission: { status: 'draft' }, extensionduedate: 0 } },
      };
      return Response.json(data[name!]);
    }));
    const connection = cookie();
    const read = await run(request('POST', { name: 'moodle_get_assignments_and_announcements', arguments: {} }, { cookie: connection }));
    expect((await read.json()).assignments[0].id).toBe(9);
    const preview = await run(request('POST', { name: 'moodle_plan_assignment_timeline', arguments: {
      work: [{ assignmentId: 9, estimatedMinutes: 100 }], availability: [{ startAt, endAt }],
    } }, { cookie: connection }));
    expect(preview.status).toBe(200);
    const { timeline, planToken } = await preview.json();
    expect(timeline.blocks).toHaveLength(2);
    const result = await run(request('POST', { name: 'moodle_schedule_assignment_timeline', arguments: { planToken } }, { cookie: connection }));
    expect(result.status).toBe(200);
    expect((await result.json()).complete).toBe(true);
    expect(calendar.createStudyBlock).toHaveBeenCalledTimes(2);
    expect(calendar.createStudyBlock).toHaveBeenNthCalledWith(1, {
      title: timeline.blocks[0].title, startAt: timeline.blocks[0].startAt, endAt: timeline.blocks[0].endAt,
    }, timeline.blocks[0].operationId);
  });
});
