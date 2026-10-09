import type { OperationResult } from '@polymate/contracts/calendar';
import type { OperationKind, OperationRecord, OperationStore } from '@polymate/core/calendar/operations';
import { getPool } from './connection';

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

/** calendar_operations-backed log (migration 0001). Rows are always scoped to the resolved owner. */
export const calendarOperationStore: OperationStore = {
  async begin(record: OperationRecord) {
    const inserted = await getPool().query(
      `INSERT INTO calendar_operations (operation_id, owner_id, operation_kind, target_event_id, expected_etag, intended_change)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (operation_id) DO NOTHING`,
      [record.operationId, record.ownerId, record.kind, record.targetEventId, record.expectedEtag, record.intendedChange],
    );
    if (inserted.rowCount === 1) return null;
    const existing = await getPool().query<Row>(
      `SELECT operation_id, owner_id, operation_kind, target_event_id, expected_etag, intended_change, status, result
       FROM calendar_operations WHERE operation_id = $1`,
      [record.operationId],
    );
    const row = existing.rows[0];
    if (!row) throw new Error('Calendar operation could not be recorded.');
    // Another owner's operation: report a mismatch without exposing its contents.
    if (row.owner_id !== record.ownerId) {
      return { record: { ...record, ownerId: row.owner_id, kind: row.operation_kind }, result: null };
    }
    return {
      record: {
        operationId: row.operation_id, ownerId: row.owner_id, kind: row.operation_kind,
        targetEventId: row.target_event_id, expectedEtag: row.expected_etag, intendedChange: row.intended_change,
      },
      result: row.status === 'pending' ? null : row.result,
    };
  },

  async finish(ownerId: string, result: OperationResult) {
    await getPool().query(
      `UPDATE calendar_operations SET status = $3, result = $4, error_code = $5, updated_at = now()
       WHERE operation_id = $1 AND owner_id = $2`,
      [result.operationId, ownerId, result.status, result, result.error?.code ?? null],
    );
  },
};
