import type { OperationResult } from '@polymate/contracts/calendar';

export type OperationKind = 'create' | 'update' | 'complete' | 'delete';

export type OperationRecord = Readonly<{
  operationId: string;
  ownerId: string;
  kind: OperationKind;
  targetEventId: string | null;
  expectedEtag: string | null;
  intendedChange: Record<string, unknown>;
}>;

/** Durable log of calendar writes, so retries and uncertain outcomes can be reconciled. */
export interface OperationStore {
  /**
   * Records a new pending operation. Returns null when it was inserted, or the earlier record and
   * its last result when this owner already used the operationId.
   */
  begin(record: OperationRecord): Promise<{ record: OperationRecord; result: OperationResult | null } | null>;
  finish(ownerId: string, result: OperationResult): Promise<void>;
}

export class MemoryOperationStore implements OperationStore {
  private readonly rows = new Map<string, { record: OperationRecord; result: OperationResult | null }>();

  async begin(record: OperationRecord) {
    const existing = this.rows.get(record.operationId);
    if (existing) return existing;
    this.rows.set(record.operationId, { record, result: null });
    return null;
  }

  async finish(ownerId: string, result: OperationResult) {
    const row = this.rows.get(result.operationId);
    if (row && row.record.ownerId === ownerId) row.result = result;
  }
}
