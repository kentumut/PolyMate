import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarOperationStore, findCalendarOperation, listUnresolvedCalendarOperations } from '../packages/db/src/calendar-operations';

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), poolQuery: vi.fn(), release: vi.fn() }));
vi.mock('../packages/db/src/connection', () => ({ getPool: () => ({ connect: mocks.connect, query: mocks.poolQuery }) }));
const record = { ownerId: 'owner-a', operationId: 'op-a', kind: 'create' as const, targetEventId: 'event-a', expectedEtag: null, intendedChange: { title: 'Sheet' } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
});

describe('durable calendar operation store', () => {
  it('holds an owner lock and commits the pending log before running Google work', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ locked: true }] }).mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rows: [] });
    await calendarOperationStore.withOwnerLock(record.ownerId, async () => {
      expect(await calendarOperationStore.begin(record)).toBeNull();
      expect(mocks.query.mock.calls[1][0]).toContain('INSERT INTO calendar_operations');
      // No transaction: a process crash after sending must leave the pending record durable.
      expect(mocks.query.mock.calls.some(([sql]) => sql === 'BEGIN')).toBe(false);
      await calendarOperationStore.finish(record.ownerId, { operationId: record.operationId, status: 'unknown' });
    });
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.query.mock.calls[0][1]).toEqual([record.ownerId]);
    expect(mocks.query.mock.calls[2][0]).toContain('WHERE operation_id = $1 AND owner_id = $2');
    expect(mocks.query.mock.calls[3][0]).toContain('pg_advisory_unlock');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('rejects lock contention before invoking the mutation and releases the connection', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ locked: false }] });
    const run = vi.fn();
    await expect(calendarOperationStore.withOwnerLock(record.ownerId, run)).rejects.toThrow('in progress');
    expect(run).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('unlocks after a callback error and discards a connection if unlocking fails', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ locked: true }] }).mockRejectedValueOnce(new Error('lost connection'));
    await expect(calendarOperationStore.withOwnerLock(record.ownerId, async () => { throw new Error('callback'); }))
      .rejects.toThrow('lost connection');
    expect(mocks.release).toHaveBeenCalledWith(true);
  });

  it('never selects another owner’s operation when a global operation ID collides', async () => {
    mocks.poolQuery.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rows: [] });
    const prior = await calendarOperationStore.begin(record);
    expect(mocks.poolQuery.mock.calls[1]).toEqual([
      expect.stringContaining('WHERE operation_id = $1 AND owner_id = $2'), [record.operationId, record.ownerId],
    ]);
    expect(prior?.record.ownerId).toBe('');
    expect(prior?.result).toBeNull();
  });

  it('scopes recovery reads to the authenticated owner and only lists unresolved statuses', async () => {
    mocks.poolQuery.mockResolvedValueOnce({ rows: [{ operation_id: 'op-a', status: 'pending', result: null }] });
    expect(await listUnresolvedCalendarOperations('owner-a')).toEqual([{ operationId: 'op-a', status: 'pending' }]);
    expect(mocks.poolQuery.mock.calls[0]).toEqual([
      expect.stringContaining("WHERE owner_id = $1 AND status IN ('pending', 'unknown')"), ['owner-a'],
    ]);
    mocks.poolQuery.mockResolvedValueOnce({ rows: [] });
    expect(await findCalendarOperation('owner-b', 'op-a')).toBeNull();
    expect(mocks.poolQuery.mock.calls[1]).toEqual([
      expect.stringContaining('WHERE operation_id = $1 AND owner_id = $2'), ['op-a', 'owner-b'],
    ]);
  });
});
