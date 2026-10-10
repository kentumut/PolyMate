import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { POST } from '../apps/web/app/api/assignments/import/confirm/route';
import { GET } from '../apps/web/app/api/assignments/import/route';
import { ImportStoreError, parseImportSaveRequest } from '../packages/contracts/src/imports';
import { createPersistentImportClient } from '../apps/web/components/study/calendar-import-client';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), state: vi.fn() }));
vi.mock('../packages/db/src/imports', () => ({ confirmCalendarImport: mocks.confirm, readImportState: mocks.state }));
const origin = 'https://polymate.test';
const headers = { 'x-user-id': 'student@example.test', origin, cookie: 'polymate_assignments_csrf=nonce', 'x-csrf-token': 'nonce', 'content-type': 'application/json' };
const requestId = '00000000-0000-4000-8000-000000000001';
const input = { title: 'Sheet', dueAt: '2026-10-20T15:00:00.000Z', estimatedMinutes: 100 };
const payload = { requestId, previewId: requestId, selections: [{ key: 'a'.repeat(64), kind: 'assignment', input }] };
const receipt = { requestId, previewId: requestId, collectionId: '00000000-0000-4000-8000-000000000002', created: 1, updated: 0, unchanged: 0,
  commitments: 0, savedAt: '2026-10-10T08:00:00.000Z', assignments: [{ ...input, id: '00000000-0000-4000-8000-000000000003', remainingMinutes: 100, status: 'open', version: 1 }] };
const request = (body: unknown = payload, change = {}) => new NextRequest(`${origin}/api/assignments/import/confirm`, { method: 'POST', headers: { ...headers, ...change }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('AUTH_MODE', 'managed-proxy'); vi.stubEnv('MANAGED_PROXY_ONLY', 'true'); vi.stubEnv('APP_ORIGIN', origin);
  mocks.confirm.mockReset().mockResolvedValue(receipt); mocks.state.mockReset().mockResolvedValue({ collections: [], preview: null, result: null });
});
afterEach(() => { vi.unstubAllEnvs(); });
describe('real import confirmation and recovery API', () => {
  it('requires identity, Origin and assignment CSRF before calling persistence', async () => {
    for (const [changes, status] of [[{ 'x-user-id': '' }, 401], [{ origin: 'https://other.test' }, 403], [{ 'x-csrf-token': 'wrong' }, 403]] as const) expect((await POST(request(payload, changes))).status).toBe(status);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('accepts references and reviewed input, rejecting caller ownership and substituted source events', async () => {
    expect((await POST(request())).status).toBe(200);
    for (const body of [{ ...payload, ownerId: 'other' }, { ...payload, selections: [{ ...payload.selections[0], event: { uid: 'invented' } }] }, { ...payload, selections: [payload.selections[0], payload.selections[0]] }]) expect((await POST(request(body))).status).toBe(422);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm.mock.calls[0][1]).toEqual(parseImportSaveRequest(payload));
  });
  it('reports stale/deleted/expired previews distinctly without exposing internal failures', async () => {
    for (const [code, status] of [['conflict', 409], ['expired', 409], ['not_found', 404]] as const) {
      mocks.confirm.mockRejectedValueOnce(new ImportStoreError(code, 'Review another preview.'));
      expect((await POST(request())).status).toBe(status);
    }
    const invalid = new NextRequest(`${origin}/api/assignments/import/confirm`, { method: 'POST', headers, body: 'x'.repeat(512001) });
    expect((await POST(invalid)).status).toBe(422);
  });
  it('recovers an exact owner-scoped preview and saved result after reload', async () => {
    mocks.state.mockResolvedValueOnce({ collections: [], preview: { id: requestId }, result: receipt });
    const response = await GET(new NextRequest(`${origin}/api/assignments/import?previewId=${requestId}`, { headers }));
    expect((await response.json()).result).toEqual(receipt);
    expect(mocks.state.mock.calls[0].slice(1)).toEqual([undefined, requestId]);
    expect((await GET(new NextRequest(`${origin}/api/assignments/import`, { headers: {} }))).status).toBe(401);
  });
  it('client retries a lost post-commit response with exactly the same request and distinguishes conflicts', async () => {
    let loseReply = true;
    const transport: typeof fetch = async (path, init) => {
      if (String(path).endsWith('/csrf')) return Response.json({ csrfToken: 'nonce' });
      const response = await POST(new NextRequest(new URL(String(path), origin), { ...init, headers }));
      if (loseReply) { loseReply = false; throw new TypeError('Reply lost.'); }
      return response;
    };
    const client = createPersistentImportClient(transport);
    await expect(client.confirm(payload as Parameters<typeof client.confirm>[0])).rejects.toMatchObject({ kind: 'unknown' });
    expect(await client.confirm(payload as Parameters<typeof client.confirm>[0])).toEqual(receipt);
    expect(mocks.confirm.mock.calls.map(call => call[1])).toEqual([parseImportSaveRequest(payload), parseImportSaveRequest(payload)]);
    mocks.confirm.mockRejectedValueOnce(new ImportStoreError('conflict', 'Assignment changed.'));
    await expect(client.confirm(payload as Parameters<typeof client.confirm>[0])).rejects.toMatchObject({ kind: 'conflict' });
  });
  it('client suppresses a concurrent confirmation and treats malformed success as unconfirmed', async () => {
    let release!: (response: Response) => void;
    const csrf = new Promise<Response>(resolve => { release = resolve; });
    const transport = vi.fn<typeof fetch>().mockImplementation(async path => String(path).endsWith('/csrf') ? csrf : Response.json(receipt));
    const client = createPersistentImportClient(transport);
    const pending = client.confirm(payload as Parameters<typeof client.confirm>[0]);
    await expect(client.confirm(payload as Parameters<typeof client.confirm>[0])).rejects.toThrow('already running');
    release(Response.json({ csrfToken: 'nonce' }));
    expect(await pending).toEqual(receipt);
    expect(transport.mock.calls.filter(call => String(call[0]).endsWith('/confirm'))).toHaveLength(1);
    const malformed = createPersistentImportClient(async path => Response.json(String(path).endsWith('/csrf') ? { csrfToken: 'nonce' } : { ...receipt, savedAt: 'invalid date' }));
    await expect(malformed.confirm(payload as Parameters<typeof client.confirm>[0])).rejects.toMatchObject({ kind: 'unknown' });
  });
});
