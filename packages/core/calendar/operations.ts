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

/** Another change for this owner holds the lock. Nothing was recorded or sent; retry shortly. */
export class CalendarBusyError extends Error {
  constructor() {
    super('Another calendar change is still in progress. Try again in a moment.');
    this.name = 'CalendarBusyError';
  }
}

/** Durable log of calendar writes, so retries and uncertain outcomes can be reconciled. */
export interface OperationStore {
  /** Serialize the availability check and write across requests for this owner. */
  withOwnerLock<T>(ownerId: string, run: () => Promise<T>): Promise<T>;
  /**
   * Records a new pending operation. Returns null when it was inserted, or the earlier record and
   * its last result when this owner already used the operationId.
   */
  begin(record: OperationRecord): Promise<{ record: OperationRecord; result: OperationResult | null } | null>;
  finish(ownerId: string, result: OperationResult): Promise<void>;
}

export class MemoryOperationStore implements OperationStore {
  private readonly rows = new Map<string, { record: OperationRecord; result: OperationResult | null }>();
  private readonly locks = new Map<string, Promise<void>>();

  async withOwnerLock<T>(ownerId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(ownerId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(ownerId, next);
    await previous;
    try { return await run(); }
    finally {
      release();
      if (this.locks.get(ownerId) === next) this.locks.delete(ownerId);
    }
  }

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
