import type { OperationResult } from '@polymate/contracts/calendar';
import { CalendarBusyError, type OperationKind, type OperationRecord, type OperationStore } from '@polymate/core/calendar/operations';
import { getPool } from './connection';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';

const session = new AsyncLocalStorage<PoolClient>();
const queries = () => session.getStore() ?? getPool();
export function calendarOperationSessionClient(): PoolClient | undefined { return session.getStore(); }

type Row = {
  operation_id: string;
  owner_id: string;
  operation_kind: OperationKind;
  target_event_id: string | null;
  expected_etag: string | null;
  intended_change: Record<string, unknown>;
  status: OperationResult['status'];
  result: OperationResult | null;
};

function storedOperation(row: Row) {
  return {
    record: {
      operationId: row.operation_id, ownerId: row.owner_id, kind: row.operation_kind,
      targetEventId: row.target_event_id, expectedEtag: row.expected_etag, intendedChange: row.intended_change,
    } satisfies OperationRecord,
    result: row.status === 'pending' ? null : row.result,
  };
}

export async function findCalendarOperation(ownerId: string, operationId: string) {
  const result = await queries().query<Row>(
    `SELECT operation_id, owner_id, operation_kind, target_event_id, expected_etag, intended_change, status, result
     FROM calendar_operations WHERE operation_id = $1 AND owner_id = $2`, [operationId, ownerId],
  );
  return result.rows[0] ? storedOperation(result.rows[0]) : null;
}

export async function listUnresolvedCalendarOperations(ownerId: string): Promise<OperationResult[]> {
  const result = await queries().query<Row>(
    `SELECT operation_id, status, result FROM calendar_operations
     WHERE owner_id = $1 AND status IN ('pending', 'unknown') ORDER BY created_at, operation_id`, [ownerId],
  );
  // Recovery returns only operation identity/status, never a different student's payload.
  return result.rows.map(row => ({ operationId: row.operation_id, status: row.status, ...(row.result?.error ? { error: row.result.error } : {}) }));
}

/** calendar_operations-backed log (migration 0001). Rows are always scoped to the resolved owner. */
export const calendarOperationStore: OperationStore = {
  async withOwnerLock<T>(ownerId: string, run: () => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [ownerId],
      );
      locked = result.rows[0].locked;
      if (!locked) throw new CalendarBusyError();
      // Autocommit the pending record BEFORE Google is called. Reuse this connection
      // for log queries so parallel requests cannot exhaust the pool while holding locks.
      return await session.run(client, run);
    } finally {
      try {
        if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [ownerId]);
        client.release();
      } catch (error) {
        client.release(true);
        throw error;
      }
    }
  },
  async begin(record: OperationRecord) {
    const inserted = await queries().query(
      `INSERT INTO calendar_operations (operation_id, owner_id, operation_kind, target_event_id, expected_etag, intended_change)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (operation_id) DO NOTHING`,
      [record.operationId, record.ownerId, record.kind, record.targetEventId, record.expectedEtag, record.intendedChange],
    );
    if (inserted.rowCount === 1) return null;
    const existing = await queries().query<Row>(
      `SELECT operation_id, owner_id, operation_kind, target_event_id, expected_etag, intended_change, status, result
       FROM calendar_operations WHERE operation_id = $1 AND owner_id = $2`,
      [record.operationId, record.ownerId],
    );
    const row = existing.rows[0];
    // An ID collision with another owner must not read or expose that owner's record.
    if (!row) return { record: { ...record, ownerId: '' }, result: null };
    return storedOperation(row);
  },

  async finish(ownerId: string, result: OperationResult) {
    await queries().query(
      `UPDATE calendar_operations SET status = $3, result = $4, error_code = $5, updated_at = now()
       WHERE operation_id = $1 AND owner_id = $2`,
      [result.operationId, ownerId, result.status, result, result.error?.code ?? null],
    );
  },
};
