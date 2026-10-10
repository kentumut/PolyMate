import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentRequestConflict, createAssignment, listAssignments } from '../packages/db/src/assignments';

const mocks = vi.hoisted(() => ({ query: vi.fn(), ensureUser: vi.fn() }));
vi.mock('../packages/db/src/connection', () => ({ getPool: () => ({ query: mocks.query }) }));
vi.mock('../packages/db/src/google-oauth', () => ({ ensureUser: mocks.ensureUser }));

const owner = { userId: '00000000-0000-4000-8000-000000000010', externalId: 'student@example.test', displayName: 'Student' };
const input = { title: 'Algorithms sheet 4', dueAt: '2026-10-16T16:00:00.000Z', estimatedMinutes: 150 };
const request = { ...input, clientRequestId: '00000000-0000-4000-8000-000000000001' };
const row = { id: '00000000-0000-4000-8000-000000000002', title: input.title, due_at: new Date(input.dueAt), estimated_minutes: 150,
  remaining_minutes: 150, status: 'open', version: 1, creation_input: input };

beforeEach(() => { vi.resetAllMocks(); mocks.ensureUser.mockResolvedValue(undefined); });

describe('assignment persistence and idempotency', () => {
  it('creates the authenticated user without OAuth and atomically sets initial remaining effort', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [row] });
    expect(await createAssignment(owner, request)).toMatchObject({ created: true, assignment: { ...input, remainingMinutes: 150, status: 'open', version: 1 } });
    expect(mocks.ensureUser).toHaveBeenCalledWith(owner);
    expect(mocks.query.mock.calls[0][0]).toContain('VALUES ($1, $2, $3, $4, $4, $5, $6)');
    expect(mocks.query.mock.calls[0][0]).toContain('ON CONFLICT (owner_id, client_request_id) DO NOTHING');
    expect(mocks.query.mock.calls[0][1]).toEqual([owner.userId, input.title, input.dueAt, 150, request.clientRequestId, input]);
  });

  it('replays a previously committed save scoped to the same owner without resetting later progress', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ ...row, remaining_minutes: 75, status: 'in_progress', version: 2 }] });
    expect(await createAssignment(owner, request)).toMatchObject({ created: false, assignment: { remainingMinutes: 75, status: 'in_progress', version: 2 } });
    expect(mocks.query.mock.calls[1]).toEqual([
      expect.stringContaining('WHERE owner_id = $1 AND client_request_id = $2'), [owner.userId, request.clientRequestId],
    ]);
  });

  it('rejects a reused request ID with changed details rather than overwriting the saved assignment', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [row] });
    await expect(createAssignment(owner, { ...request, estimatedMinutes: 200 })).rejects.toBeInstanceOf(AssignmentRequestConflict);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.query.mock.calls.every(([sql]) => !String(sql).startsWith('UPDATE'))).toBe(true);
  });

  it('lists only the authenticated owner and removes private creation metadata from replies', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [row] });
    const assignments = await listAssignments(owner.userId);
    expect(mocks.query.mock.calls[0]).toEqual([expect.stringContaining('WHERE owner_id = $1 ORDER BY due_at, id'), [owner.userId]]);
    expect(assignments[0]).not.toHaveProperty('creation_input');
    expect(assignments[0]).not.toHaveProperty('clientRequestId');
    expect(assignments[0]).not.toHaveProperty('ownerId');
  });

  it('validates the request before creating users or running queries', async () => {
    await expect(createAssignment(owner, { ...request, estimatedMinutes: 0 })).rejects.toThrow('positive whole number');
    expect(mocks.ensureUser).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
  });
});
