import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import type { Assignment, AssignmentCreateRequest } from '@polymate/contracts/assignments';
import type { OwnerContext } from '../packages/core/src/identity';
import { AssignmentRequestConflict } from '../packages/db/src/assignments';
import { GET, POST } from '../apps/web/app/api/assignments/route';
import { GET as csrf } from '../apps/web/app/api/assignments/csrf/route';
import { createAssignmentClient } from '../apps/web/components/study/assignment-client';

const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn() }));
vi.mock('../packages/db/src/assignments', async importOriginal => ({
  ...await importOriginal<typeof import('../packages/db/src/assignments')>(), createAssignment: mocks.create, listAssignments: mocks.list,
}));

const origin = 'https://polymate.test';
const input = { title: 'Algorithms sheet 4', dueAt: '2026-10-16T16:00:00.000Z', estimatedMinutes: 150 };
const clientRequestId = '00000000-0000-4000-8000-000000000001';
const headers = { 'x-user-id': 'student@example.test', origin, cookie: 'polymate_assignments_csrf=nonce', 'x-csrf-token': 'nonce', 'content-type': 'application/json' };
let cookie: string;
let rows: Map<string, { ownerId: string; request: AssignmentCreateRequest; assignment: Assignment }>;

const fetcher: typeof fetch = async (path, init) => {
  const requestHeaders = new Headers(init?.headers);
  requestHeaders.set('x-user-id', headers['x-user-id']); requestHeaders.set('origin', origin); requestHeaders.set('cookie', cookie);
  const request = new NextRequest(new URL(String(path), origin), { ...init, headers: requestHeaders });
  const response = String(path).endsWith('/csrf') ? await csrf(request) : init?.method === 'POST' ? await POST(request) : await GET(request);
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  return response;
};

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test'); vi.stubEnv('AUTH_MODE', 'managed-proxy'); vi.stubEnv('MANAGED_PROXY_ONLY', 'true'); vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('GOOGLE_ENABLED', 'false'); cookie = headers.cookie; rows = new Map();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Assignment API must not call Google.'); }));
  mocks.create.mockReset().mockImplementation(async (owner: OwnerContext, request: AssignmentCreateRequest) => {
    const key = `${owner.userId}:${request.clientRequestId}`;
    const prior = rows.get(key);
    if (prior) {
      if (JSON.stringify(prior.request) !== JSON.stringify(request)) throw new AssignmentRequestConflict();
      return { assignment: prior.assignment, created: false };
    }
    const values = { title: request.title, dueAt: request.dueAt, estimatedMinutes: request.estimatedMinutes };
    const assignment: Assignment = { ...values, id: crypto.randomUUID(), remainingMinutes: values.estimatedMinutes, status: 'open', version: 1 };
    rows.set(key, { ownerId: owner.userId, request, assignment }); return { assignment, created: true };
  });
  mocks.list.mockReset().mockImplementation(async ownerId => [...rows.values()].filter(row => row.ownerId === ownerId).map(row => row.assignment));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('authenticated assignments API and client journey', () => {
  it('creates and reloads an assignment with Google disabled, with complete initial state', async () => {
    const client = createAssignmentClient({ fetcher, createRequestId: () => clientRequestId });
    const assignment = await client.createAssignment(input);
    expect(assignment).toMatchObject({ ...input, remainingMinutes: 150, status: 'open', version: 1 });
    expect(await createAssignmentClient({ fetcher }).listAssignments()).toEqual([assignment]);
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ externalId: 'student@example.test' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('retries a lost post-commit reply using the same request ID and creates only one row', async () => {
    let loseReply = true;
    const transport: typeof fetch = async (path, init) => {
      const response = await fetcher(path, init);
      if (init?.method === 'POST' && loseReply) { loseReply = false; throw new TypeError('Response lost after save.'); }
      return response;
    };
    const client = createAssignmentClient({ fetcher: transport, createRequestId: () => clientRequestId });
    await expect(client.createAssignment(input)).rejects.toMatchObject({ kind: 'unknown' });
    const assignment = await client.createAssignment(input);
    expect(rows.size).toBe(1);
    expect(await createAssignmentClient({ fetcher }).listAssignments()).toEqual([assignment]);
    expect(mocks.create.mock.calls.map(([, request]) => request.clientRequestId)).toEqual([clientRequestId, clientRequestId]);
  });

  it('rejects changed payloads for a previously used request ID with 409', async () => {
    const request = (title: string) => new NextRequest(`${origin}/api/assignments`, { method: 'POST', headers, body: JSON.stringify({ ...input, title, clientRequestId }) });
    expect((await POST(request(input.title))).status).toBe(201);
    expect((await POST(request(input.title))).status).toBe(200);
    expect((await POST(request('Different assignment'))).status).toBe(409);
    expect(rows.size).toBe(1);
  });

  it('requires identity, application origin, and assignment-scoped CSRF before saving', async () => {
    for (const [changes, status] of [
      [{ 'x-user-id': '' }, 401], [{ origin: 'https://other.test' }, 403],
      [{ cookie: 'polymate_calendar_csrf=nonce' }, 403], [{ 'x-csrf-token': 'wrong' }, 403],
    ] as const) {
      const request = new NextRequest(`${origin}/api/assignments`, { method: 'POST', headers: { ...headers, ...changes }, body: JSON.stringify({ ...input, clientRequestId }) });
      expect((await POST(request)).status).toBe(status);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects invalid input, invented progress, and caller-selected owners before persistence', async () => {
    for (const body of [{ ...input, estimatedMinutes: 0 }, { ...input, ownerId: 'other' }, { ...input, status: 'completed' }, { ...input, dueAt: '2026-02-30T10:00:00Z' }]) {
      const request = new NextRequest(`${origin}/api/assignments`, { method: 'POST', headers, body: JSON.stringify({ ...body, clientRequestId }) });
      expect((await POST(request)).status).toBe(422);
    }
    const invalidJson = new NextRequest(`${origin}/api/assignments`, { method: 'POST', headers, body: '{not-json' });
    expect((await POST(invalidJson)).status).toBe(422);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('never lists another student’s records even when a query attempts to choose the owner', async () => {
    const client = createAssignmentClient({ fetcher }); await client.createAssignment(input);
    const response = await GET(new NextRequest(`${origin}/api/assignments?ownerId=student@example.test`, { headers: { 'x-user-id': 'other@example.test' } }));
    expect(await response.json()).toEqual({ assignments: [] });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await GET(new NextRequest(`${origin}/api/assignments`))).status).toBe(401);
  });

  it('issues a protected assignment-specific cookie and sanitizes database errors', async () => {
    const token = await csrf(new NextRequest(`${origin}/api/assignments/csrf`, { headers }));
    expect(token.headers.get('set-cookie')).toContain('Path=/api/assignments');
    expect(token.headers.get('set-cookie')).toContain('HttpOnly'); expect(token.headers.get('set-cookie')).toContain('Secure');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.create.mockRejectedValue(new Error('database-password-must-not-leak'));
    const response = await POST(new NextRequest(`${origin}/api/assignments`, { method: 'POST', headers, body: JSON.stringify({ ...input, clientRequestId }) }));
    expect(response.status).toBe(500); expect(await response.text()).not.toContain('database-password-must-not-leak');
    expect(log).toHaveBeenCalledWith('Assignment request failed.', 'Error');
  });
});
