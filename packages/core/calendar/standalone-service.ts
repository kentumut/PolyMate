import {
  parseDateRange,
  parseEtag,
  parseEventId,
  parseOperationId,
  parseStudyBlockChanges,
  parseStudyBlockInput,
  type CalendarClient,
  type CalendarEvent,
  type OperationResult,
  type StudyBlockChanges,
  type StudyBlockInput,
} from '@polymate/contracts/calendar';
import type { DateRange } from '@polymate/contracts/time';
import type { OwnerContext } from '../src/identity';
import { findConflicts } from '../scheduling/intervals';
import type { OperationRecord, OperationStore } from './operations';
import { eventIdForOperation } from './mapping';

export type StandaloneEventStore = {
  ensureOwner(owner: OwnerContext): Promise<void>;
  list(ownerId: string, range: DateRange): Promise<CalendarEvent[]>;
  find(ownerId: string, id: string): Promise<CalendarEvent | null>;
  create(owner: OwnerContext, id: string, input: StudyBlockInput): Promise<CalendarEvent | null>;
  update(ownerId: string, id: string, changes: StudyBlockChanges, expectedVersion: number): Promise<CalendarEvent | null>;
  complete(ownerId: string, id: string, expectedVersion: number): Promise<CalendarEvent | null>;
  delete(ownerId: string, id: string, expectedVersion: number): Promise<boolean>;
};

const MESSAGES = {
  notFound: 'This calendar event no longer exists.',
  conflict: 'This event changed since you opened it. Reload and try again.',
  forbidden: 'Only events in your PolyMate calendar can be changed.',
} as const;

export class StandaloneCalendarService implements CalendarClient {
  constructor(
    private readonly owner: OwnerContext,
    private readonly events: StandaloneEventStore,
    private readonly operations: OperationStore,
    private readonly readOnlyEvents: ((range: DateRange) => Promise<CalendarEvent[]>) | null = null,
  ) {}

  async listWeek(range: DateRange): Promise<CalendarEvent[]> {
    range = parseDateRange(range);
    const local = await this.events.list(this.owner.userId, range);
    let external: CalendarEvent[] = [];
    if (this.readOnlyEvents) {
      try { external = await this.readOnlyEvents(range); } catch { /* Optional integrations never disable the local calendar. */ }
    }
    return [...local, ...external].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
  }

  async createStudyBlock(input: StudyBlockInput, operationId: string): Promise<OperationResult> {
    input = parseStudyBlockInput(input);
    operationId = parseOperationId(operationId);
    // The durable operation log references users, so a first-time owner must
    // exist before run() records the intent.
    await this.events.ensureOwner(this.owner);
    const id = eventIdForOperation(operationId);
    return this.run({ operationId, kind: 'create', targetEventId: id, expectedEtag: null, intendedChange: { ...input } }, async () => {
      await this.assertNoOverlap(input, id);
      const created = await this.events.create(this.owner, id, input);
      if (created) return created;
      const existing = await this.events.find(this.owner.userId, id);
      if (existing && matches(existing, input)) return existing;
      throw new LocalCalendarError('conflict', MESSAGES.conflict);
    });
  }

  updateStudyBlock(id: string, changes: StudyBlockChanges, expectedEtag: string, operationId: string): Promise<OperationResult> {
    id = parseEventId(id); changes = parseStudyBlockChanges(changes); expectedEtag = parseEtag(expectedEtag); operationId = parseOperationId(operationId);
    return this.run({ operationId, kind: 'update', targetEventId: id, expectedEtag, intendedChange: { ...changes } }, async () => {
      const current = await this.owned(id);
      if (current.etag !== expectedEtag) throw new LocalCalendarError('conflict', MESSAGES.conflict);
      const next = { ...current, ...changes };
      await this.assertNoOverlap(next, id);
      const updated = await this.events.update(this.owner.userId, id, changes, version(expectedEtag));
      if (!updated) throw new LocalCalendarError('conflict', MESSAGES.conflict);
      return updated;
    });
  }

  completeStudyBlock(id: string, expectedEtag: string, operationId: string): Promise<OperationResult> {
    id = parseEventId(id); expectedEtag = parseEtag(expectedEtag); operationId = parseOperationId(operationId);
    return this.run({ operationId, kind: 'complete', targetEventId: id, expectedEtag, intendedChange: { completion: 'done' } }, async () => {
      const current = await this.owned(id);
      if (current.etag !== expectedEtag) throw new LocalCalendarError('conflict', MESSAGES.conflict);
      const updated = await this.events.complete(this.owner.userId, id, version(expectedEtag));
      if (!updated) throw new LocalCalendarError('conflict', MESSAGES.conflict);
      return updated;
    });
  }

  deleteStudyBlock(id: string, expectedEtag: string, operationId: string): Promise<OperationResult> {
    id = parseEventId(id); expectedEtag = parseEtag(expectedEtag); operationId = parseOperationId(operationId);
    return this.run({ operationId, kind: 'delete', targetEventId: id, expectedEtag, intendedChange: {} }, async () => {
      const current = await this.owned(id);
      if (current.etag !== expectedEtag) throw new LocalCalendarError('conflict', MESSAGES.conflict);
      if (!await this.events.delete(this.owner.userId, id, version(expectedEtag))) throw new LocalCalendarError('conflict', MESSAGES.conflict);
      return undefined;
    });
  }

  private async run(record: Omit<OperationRecord, 'ownerId'>, execute: () => Promise<CalendarEvent | undefined>): Promise<OperationResult> {
    return this.operations.withOwnerLock(this.owner.userId, async () => {
      const prior = await this.operations.begin({ ...record, ownerId: this.owner.userId });
      if (prior) {
        const same = prior.record.ownerId === this.owner.userId && prior.record.kind === record.kind &&
          prior.record.targetEventId === record.targetEventId && prior.record.expectedEtag === record.expectedEtag &&
          JSON.stringify(prior.record.intendedChange) === JSON.stringify(record.intendedChange);
        if (!same) return { operationId: record.operationId, status: 'failed', error: { code: 'validation', message: 'This operation ID was already used for a different change.' } };
        if (prior.result) return prior.result;
        const recovered = await this.recover(record);
        if (recovered) await this.operations.finish(this.owner.userId, recovered);
        return recovered ?? { operationId: record.operationId, status: 'unknown', error: { code: 'unknown', message: 'The calendar change could not be confirmed. Check it again before making another change.' } };
      }
      let result: OperationResult;
      try {
        const event = await execute();
        result = { operationId: record.operationId, status: 'synced', ...(event ? { event } : {}) };
      } catch (error) {
        const local = error instanceof LocalCalendarError ? error : null;
        result = { operationId: record.operationId, status: 'failed', error: {
          code: local?.code ?? 'unknown', message: local?.message ?? 'The calendar change could not be saved.',
        } };
      }
      await this.operations.finish(this.owner.userId, result);
      return result;
    });
  }

  private async recover(record: Omit<OperationRecord, 'ownerId'>): Promise<OperationResult | null> {
    if (!record.targetEventId) return null;
    const current = await this.events.find(this.owner.userId, record.targetEventId);
    if (record.kind === 'create') {
      return current && matches(current, record.intendedChange as StudyBlockInput)
        ? { operationId: record.operationId, status: 'synced', event: current } : null;
    }
    if (record.kind === 'delete') return current ? null : { operationId: record.operationId, status: 'synced' };
    if (!current) return null;
    if (record.kind === 'complete' && current.completion === 'done') return { operationId: record.operationId, status: 'synced', event: current };
    if (record.kind === 'update' && matchesChanges(current, record.intendedChange as StudyBlockChanges)) return { operationId: record.operationId, status: 'synced', event: current };
    return null;
  }

  private async owned(id: string): Promise<CalendarEvent> {
    const current = await this.events.find(this.owner.userId, id);
    if (!current) throw new LocalCalendarError('not_found', MESSAGES.notFound);
    if (!current.editable || current.source !== 'polymate') throw new LocalCalendarError('forbidden', MESSAGES.forbidden);
    return current;
  }

  private async assertNoOverlap(candidate: { startAt: string; endAt: string }, ownId: string): Promise<void> {
    const range = { from: candidate.startAt, to: candidate.endAt };
    const busy = (await this.listWeek(range)).filter(event => event.id !== ownId);
    const [first] = findConflicts(candidate, busy);
    if (first) throw new LocalCalendarError('overlap', `This time overlaps “${first.title}”. Choose a free slot.`);
  }
}

class LocalCalendarError extends Error {
  constructor(readonly code: 'overlap' | 'conflict' | 'forbidden' | 'not_found', message: string) { super(message); }
}

function version(etag: string): number {
  const match = /^"([1-9]\d*)"$/.exec(etag);
  if (!match) throw new LocalCalendarError('conflict', MESSAGES.conflict);
  return Number(match[1]);
}

function matches(event: CalendarEvent, input: StudyBlockInput): boolean {
  return event.title === input.title && event.startAt === input.startAt && event.endAt === input.endAt;
}

function matchesChanges(event: CalendarEvent, changes: StudyBlockChanges): boolean {
  return (changes.title === undefined || changes.title === event.title) &&
    (changes.startAt === undefined || changes.startAt === event.startAt) &&
    (changes.endAt === undefined || changes.endAt === event.endAt);
}
