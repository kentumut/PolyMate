import type {
  CalendarClient, CalendarEvent, OperationErrorCode, OperationResult, StudyBlockChanges, StudyBlockInput,
} from '@polymate/contracts/calendar';
import type { DateRange } from '@polymate/contracts/time';
import { parseDateRange, parseStudyBlockInput, parseStudyBlockChanges, parseOperationId, parseEventId, parseEtag } from '@polymate/contracts/calendar';
import { isDeepStrictEqual } from 'node:util';
import { findConflicts, type Interval } from '../scheduling/intervals';
import {
  GoogleApiError, GoogleNotConnectedError, GoogleTransportError, type GoogleCalendarApi, type GoogleEvent, type GoogleEventWrite,
} from './google-api';
import {
  blocksTime, eventIdForOperation, isOwnedStudyBlock, newStudyBlockEvent, PROP_COMPLETION, PROP_OPERATION, summaryFor, toCalendarEvent,
} from './mapping';
import type { OperationRecord, OperationStore } from './operations';

export class CalendarServiceError extends Error {
  constructor(readonly code: OperationErrorCode, message: string) {
    super(message);
    this.name = 'CalendarServiceError';
  }
}

type Verification = { applied: boolean; event?: CalendarEvent };

const MESSAGES = {
  forbidden: 'Only PolyMate study blocks can be changed. Personal events stay as they are.',
  notFound: 'This study block no longer exists in Google Calendar.',
  conflict: 'This block changed in Google Calendar since you opened it. Reload and try again.',
  notConnected: 'Connect Google Calendar to continue.',
  retry: 'Google Calendar did not accept the change. Nothing was changed; please try again.',
  unknown: 'Google Calendar did not confirm the change. Retry to check whether it was saved.',
} as const;

/**
 * Google-backed CalendarClient for one resolved owner. Google is the source of truth; the
 * operation store only remembers outcomes so retries are idempotent and uncertain writes reconcile.
 */
export class CalendarService implements CalendarClient {
  constructor(
    private readonly ownerId: string,
    private readonly api: GoogleCalendarApi,
    private readonly operations: OperationStore,
  ) {}

  async listWeek(range: DateRange): Promise<CalendarEvent[]> {
    range = parseDateRange(range);
    const events = await this.api.list(range.from, range.to);
    return events.flatMap(event => toCalendarEvent(event, this.ownerId) ?? []);
  }

  async readStudyBlock(id: string): Promise<CalendarEvent> {
    return this.map(await this.ownedEvent(parseEventId(id)));
  }

  /** Planning reads current linked blocks, including completed work outside the visible week. */
  async getStudyBlock(id: string): Promise<CalendarEvent | null> {
    const event = await this.api.get(parseEventId(id));
    return event && isOwnedStudyBlock(event, this.ownerId) ? this.map(event) : null;
  }

  async listBusy(range: DateRange): Promise<CalendarEvent[]> {
    range = parseDateRange(range);
    const events = await this.api.list(range.from, range.to);
    return events.filter(blocksTime).flatMap(event => toCalendarEvent(event, this.ownerId) ?? []);
  }

  createStudyBlock(input: StudyBlockInput, operationId: string): Promise<OperationResult> {
    input = parseStudyBlockInput(input);
    operationId = parseOperationId(operationId);
    const id = eventIdForOperation(operationId);
    return this.run({ operationId, kind: 'create', targetEventId: id, expectedEtag: null, intendedChange: { ...input } }, async markSent => {
      await this.assertNoOverlap(input, id);
      try {
        markSent();
        return await this.api.insert(newStudyBlockEvent(input, this.ownerId, operationId));
      } catch (error) {
        // 409: this operation's event already exists, e.g. after an earlier timeout.
        if (error instanceof GoogleApiError && error.status === 409) {
          const existing = await this.api.get(id);
          if (existing && isOwnedStudyBlock(existing, this.ownerId) &&
              existing.extendedProperties?.private?.[PROP_OPERATION] === operationId && this.matches(existing, input)) return existing;
        }
        throw error;
      }
    }, async () => {
      const existing = await this.api.get(id);
      return existing && isOwnedStudyBlock(existing, this.ownerId) &&
        existing.extendedProperties?.private?.[PROP_OPERATION] === operationId && this.matches(existing, input)
        ? { applied: true, event: this.map(existing) } : { applied: false };
    });
  }

  updateStudyBlock(id: string, changes: StudyBlockChanges, expectedEtag: string, operationId: string): Promise<OperationResult> {
    id = parseEventId(id);
    changes = parseStudyBlockChanges(changes);
    expectedEtag = parseEtag(expectedEtag);
    operationId = parseOperationId(operationId);
    return this.run({ operationId, kind: 'update', targetEventId: id, expectedEtag, intendedChange: { ...changes } }, async markSent => {
      const current = await this.ownedEvent(id);
      if (current.etag !== expectedEtag) throw new CalendarServiceError('conflict', MESSAGES.conflict);
      const patch: GoogleEventWrite = {
        extendedProperties: { private: { ...current.extendedProperties?.private, [PROP_OPERATION]: operationId } },
      };
      if (changes.title !== undefined) patch.summary = summaryFor(changes.title, this.map(current).completion);
      if (changes.startAt && changes.endAt) {
        await this.assertNoOverlap({ startAt: changes.startAt, endAt: changes.endAt }, id);
        patch.start = { dateTime: changes.startAt, timeZone: current.start?.timeZone };
        patch.end = { dateTime: changes.endAt, timeZone: current.end?.timeZone };
      }
      markSent();
      return this.api.patch(id, patch, expectedEtag);
    }, async () => {
      const current = await this.api.get(id);
      return current && isOwnedStudyBlock(current, this.ownerId) &&
        current.extendedProperties?.private?.[PROP_OPERATION] === operationId && this.matches(current, changes)
        ? { applied: true, event: this.map(current) } : { applied: false };
    });
  }

  completeStudyBlock(id: string, expectedEtag: string, operationId: string): Promise<OperationResult> {
    id = parseEventId(id);
    expectedEtag = parseEtag(expectedEtag);
    operationId = parseOperationId(operationId);
    return this.run({ operationId, kind: 'complete', targetEventId: id, expectedEtag, intendedChange: { completion: 'done' } }, async markSent => {
      const current = await this.ownedEvent(id);
      const event = this.map(current);
      if (current.etag !== expectedEtag) throw new CalendarServiceError('conflict', MESSAGES.conflict);
      markSent();
      return this.api.patch(id, {
        summary: summaryFor(event.title, 'done'),
        extendedProperties: { private: { ...current.extendedProperties?.private, [PROP_COMPLETION]: 'done', [PROP_OPERATION]: operationId } },
      }, expectedEtag);
    }, async () => {
      const current = await this.api.get(id);
      const event = current && isOwnedStudyBlock(current, this.ownerId) ? this.map(current) : null;
      return event?.completion === 'done' && current?.extendedProperties?.private?.[PROP_OPERATION] === operationId
        ? { applied: true, event } : { applied: false };
    });
  }

  deleteStudyBlock(id: string, expectedEtag: string, operationId: string): Promise<OperationResult> {
    id = parseEventId(id);
    expectedEtag = parseEtag(expectedEtag);
    operationId = parseOperationId(operationId);
    return this.run({ operationId, kind: 'delete', targetEventId: id, expectedEtag, intendedChange: {} }, async markSent => {
      const current = await this.api.get(id);
      if (!current) return null; // Already gone, e.g. a retry after Google applied the delete.
      if (!isOwnedStudyBlock(current, this.ownerId)) throw new CalendarServiceError('forbidden', MESSAGES.forbidden);
      if (current.etag !== expectedEtag) throw new CalendarServiceError('conflict', MESSAGES.conflict);
      try {
        markSent();
        await this.api.delete(id, expectedEtag);
      } catch (error) {
        if (!(error instanceof GoogleApiError && (error.status === 404 || error.status === 410))) throw error;
      }
      return null;
    }, async () => ({ applied: (await this.api.get(id)) === null }));
  }

  private run(
    record: Omit<OperationRecord, 'ownerId'>,
    execute: (markSent: () => void) => Promise<GoogleEvent | null>,
    verify: () => Promise<Verification>,
  ): Promise<OperationResult> {
    return this.operations.withOwnerLock(this.ownerId, () => this.runLocked(record, execute, verify));
  }

  private async runLocked(
    record: Omit<OperationRecord, 'ownerId'>,
    execute: (markSent: () => void) => Promise<GoogleEvent | null>,
    verify: () => Promise<Verification>,
  ): Promise<OperationResult> {
    const { operationId } = record;
    const prior = await this.operations.begin({ ...record, ownerId: this.ownerId });
    if (prior) {
      const same = prior.record.ownerId === this.ownerId && prior.record.kind === record.kind &&
        prior.record.targetEventId === record.targetEventId && prior.record.expectedEtag === record.expectedEtag &&
        isDeepStrictEqual(prior.record.intendedChange, record.intendedChange);
      if (!same) return failed(operationId, 'validation', 'This operation ID was already used for a different change.');
      // Finished operations replay their stored answer. An uncertain write is read back,
      // never resent: the original request could still be executing at Google.
      if (prior.result && (prior.result.status === 'synced' || prior.result.status === 'failed')) return prior.result;
      const check = await verify().catch(() => ({ applied: false }) as Verification);
      const result = check.applied ? synced(operationId, check.event) : uncertain(operationId);
      await this.operations.finish(this.ownerId, result);
      return result;
    }

    let result: OperationResult;
    let attempted = false;
    try {
      const event = await execute(() => { attempted = true; });
      result = { operationId, status: 'synced', ...(event ? { event: this.map(event) } : {}) };
    } catch (error) {
      result = await this.outcomeOf(error, operationId, verify, attempted);
    }
    await this.operations.finish(this.ownerId, result);
    return result;
  }

  private async outcomeOf(error: unknown, operationId: string, verify: () => Promise<Verification>, attempted: boolean): Promise<OperationResult> {
    if (error instanceof CalendarServiceError) return failed(operationId, error.code, error.message);
    if (error instanceof GoogleNotConnectedError) return failed(operationId, 'not_connected', MESSAGES.notConnected);
    if (!attempted) return failed(operationId, 'google_unavailable', 'Availability could not be checked. No write was sent; try again.');
    if (error instanceof GoogleApiError) {
      if (error.status === 404 || error.status === 410) return failed(operationId, 'not_found', MESSAGES.notFound);
      if (error.status === 403 && error.reason !== 'rateLimitExceeded' && error.reason !== 'userRateLimitExceeded') {
        return failed(operationId, 'forbidden', MESSAGES.forbidden);
      }
      if (error.status === 412) {
        return failed(operationId, 'conflict', MESSAGES.conflict);
      }
      if (error.status < 500 && error.status !== 429) return failed(operationId, 'google_unavailable', MESSAGES.retry);
    } else if (!(error instanceof GoogleTransportError)) {
      return { operationId, status: 'unknown', error: { code: 'unknown', message: MESSAGES.unknown } };
    }
    // Transport failure, 429 or 5xx: the write may have landed. Ask Google before answering.
    try {
      const check = await verify();
      // Absence is not proof of failure: a timed-out request may complete later.
      return check.applied ? synced(operationId, check.event) : uncertain(operationId);
    } catch {
      return { operationId, status: 'unknown', error: { code: 'unknown', message: MESSAGES.unknown } };
    }
  }

  private async ownedEvent(id: string): Promise<GoogleEvent> {
    const current = await this.api.get(id);
    if (!current) throw new CalendarServiceError('not_found', MESSAGES.notFound);
    if (!isOwnedStudyBlock(current, this.ownerId)) throw new CalendarServiceError('forbidden', MESSAGES.forbidden);
    return current;
  }

  private async assertNoOverlap(candidate: Interval, ownEventId: string): Promise<void> {
    const nearby = await this.api.list(candidate.startAt, candidate.endAt);
    const busy = nearby
      .filter(event => event.id !== ownEventId && blocksTime(event))
      .flatMap(event => toCalendarEvent(event, this.ownerId) ?? []);
    const [first] = findConflicts(candidate, busy);
    if (first) {
      throw new CalendarServiceError('overlap', `This time overlaps “${first.title}”. Choose a free slot.`);
    }
  }

  private matches(current: GoogleEvent, changes: StudyBlockChanges): boolean {
    const event = this.map(current);
    return (changes.title === undefined || changes.title === event.title) &&
      (changes.startAt === undefined || changes.startAt === event.startAt) &&
      (changes.endAt === undefined || changes.endAt === event.endAt);
  }

  private map(event: GoogleEvent): CalendarEvent {
    const mapped = toCalendarEvent(event, this.ownerId);
    if (!mapped) throw new GoogleTransportError();
    return mapped;
  }
}

function synced(operationId: string, event?: CalendarEvent): OperationResult {
  return { operationId, status: 'synced', ...(event ? { event } : {}) };
}

function uncertain(operationId: string): OperationResult {
  return { operationId, status: 'unknown', error: { code: 'unknown', message: MESSAGES.unknown } };
}

function failed(operationId: string, code: OperationErrorCode, message: string): OperationResult {
  return { operationId, status: 'failed', error: { code, message } };
}
