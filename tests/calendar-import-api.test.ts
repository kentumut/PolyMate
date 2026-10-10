import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { POST } from '../apps/web/app/api/assignments/import/preview/route';
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../packages/db/src/imports', () => ({ saveImportPreview: mocks.save }));

const origin = 'https://polymate.test';
const raw = 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:one\nDTSTART:20261016T140000Z\nSUMMARY:Sheet\nEND:VEVENT\nEND:VCALENDAR';
const headers = { 'x-user-id': 'student@example.test', origin, cookie: 'polymate_assignments_csrf=nonce', 'x-csrf-token': 'nonce', 'content-type': 'text/calendar' };
const request = (body = raw, changes = {}, query = '?source=moodle') => new NextRequest(`${origin}/api/assignments/import/preview${query}`, { method: 'POST', headers: { ...headers, ...changes }, body });
beforeEach(() => {
  mocks.save.mockReset().mockImplementation(async (_owner, parsed) => ({ ...parsed, id: crypto.randomUUID() }));
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('AUTH_MODE', 'managed-proxy'); vi.stubEnv('MANAGED_PROXY_ONLY', 'true'); vi.stubEnv('APP_ORIGIN', origin);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Preview must not contact an external service.'); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('authenticated, bounded import preview route', () => {
  it('parses privately and saves an owner-bound preview without Google or Moodle HTTP', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ source: 'moodle', events: [{ uid: 'one', title: 'Sheet' }] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(mocks.save.mock.calls[0][2]).toEqual({ name: 'My Moodle calendar' });
  });
  it('keeps development fixture parsing stateless and rejects fixtures in production', async () => {
    expect((await POST(request(raw, {}, '?source=moodle&fixture=true'))).status).toBe(200);
    expect(mocks.save).not.toHaveBeenCalled();
    vi.stubEnv('NODE_ENV', 'production');
    expect((await POST(request(raw, {}, '?source=moodle&fixture=true'))).status).toBe(422);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('reimports only into a validated existing collection, without accepting caller-selected ownership', async () => {
    const collectionId = crypto.randomUUID();
    expect((await POST(request(raw, {}, `?source=moodle&collectionId=${collectionId}`))).status).toBe(200);
    expect(mocks.save.mock.calls[0][2]).toEqual({ collectionId });
    expect((await POST(request(raw, {}, `?source=moodle&collectionId=${collectionId}&name=Other`))).status).toBe(422);
  });
  it('enforces login, same Origin and assignment-scoped CSRF', async () => {
    for (const [change, status] of [[{ 'x-user-id': '' }, 401], [{ origin: 'https://other.test' }, 403], [{ 'x-csrf-token': '' }, 403], [{ cookie: 'polymate_calendar_csrf=nonce' }, 403]] as const) {
      expect((await POST(request(raw, change))).status).toBe(status);
    }
  });
  it('rejects bad sources, extra/duplicate query fields, MIME types and excessive bodies', async () => {
    for (const query of ['?source=unknown', '?source=moodle&ownerId=other', '?source=moodle&source=mystudies']) expect((await POST(request(raw, {}, query))).status).toBe(422);
    expect((await POST(request(raw, { 'content-type': 'application/json' }))).status).toBe(422);
    expect((await POST(request('x'.repeat(1_000_001)))).status).toBe(422);
    expect((await POST(request('broken'))).status).toBe(422);
  });
});
