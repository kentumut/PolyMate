import { ContractError, type CalendarEvent, type OperationResult } from '@polymate/contracts/calendar';
import { parseLinkRequest, parseProgressRequest, progressSignature, type LinkRequest, type ProgressReceipt, type ProgressRequest, type StudyProgressState, type BlockAssignmentLink } from '@polymate/contracts/study-progress';

export class ProgressError extends Error {
  constructor(readonly code: 'not_found' | 'conflict' | 'version_conflict' | 'forbidden', message: string) { super(message); this.name = 'ProgressError'; }
}
export interface StudyProgressStore {
  state(ownerId: string): Promise<StudyProgressState>;
  link(ownerId: string, request: LinkRequest, event: CalendarEvent): Promise<BlockAssignmentLink>;
  attempt(ownerId: string, requestId: string): Promise<{ request: ProgressRequest; receipt: ProgressReceipt } | null>;
  record(ownerId: string, request: ProgressRequest, event: CalendarEvent): Promise<ProgressReceipt>;
  calendarResult(ownerId: string, requestId: string, result: OperationResult): Promise<ProgressReceipt>;
}
export interface ProgressCalendar {
  readStudyBlock(id: string): Promise<CalendarEvent>;
  completeStudyBlock(id: string, etag: string, operationId: string): Promise<OperationResult>;
}

/** Construct only with a server-authenticated owner; tools never accept owner IDs from model arguments. */
export class StudyProgressService {
  constructor(private readonly ownerId: string, private readonly calendar: ProgressCalendar, private readonly store: StudyProgressStore) {}
  state() { return this.store.state(this.ownerId); }

  async link(value: unknown) {
    const request = parseLinkRequest(value);
    const event = await this.calendar.readStudyBlock(request.eventId);
    if (event.source !== 'polymate' || !event.editable) throw new ProgressError('forbidden', 'Only your PolyMate study blocks can be linked.');
    if (event.etag !== request.expectedEtag) throw new ProgressError('conflict', 'The calendar block changed. Refresh and review it.');
    return this.store.link(this.ownerId, request, event);
  }

  async record(value: unknown): Promise<ProgressReceipt> {
    const request = parseProgressRequest(value);
    const prior = await this.store.attempt(this.ownerId, request.clientRequestId);
    let receipt: ProgressReceipt;
    if (prior) {
      if (progressSignature(prior.request) !== progressSignature(request)) throw new ProgressError('conflict', 'This report ID already belongs to different progress.');
      receipt = prior.receipt;
    } else {
      const event = await this.calendar.readStudyBlock(request.eventId);
      if (event.source !== 'polymate' || !event.editable) throw new ProgressError('forbidden', 'Personal events cannot receive study progress.');
      if (event.etag !== request.expectedEtag) throw new ProgressError('conflict', 'The calendar block changed. Refresh and review it.');
      if (event.completion === 'done' && request.action !== 'done') throw new ProgressError('conflict', 'This session is already marked done.');
      receipt = await this.store.record(this.ownerId, request, event);
    }
    if (request.action !== 'done' || receipt.calendarAlreadyDone || receipt.calendarOperation?.status === 'synced' || receipt.calendarOperation?.status === 'failed') return receipt;
    let result: OperationResult;
    try { result = await this.calendar.completeStudyBlock(request.eventId, request.expectedEtag, request.clientRequestId); }
    catch { result = { operationId: request.clientRequestId, status: 'unknown', error: { code: 'unknown', message: 'Progress was saved, but Google completion could not be confirmed.' } }; }
    return this.store.calendarResult(this.ownerId, request.clientRequestId, result);
  }
}

export function progressConflict(error: unknown): never {
  if (error instanceof ContractError) throw new ProgressError('version_conflict', error.message);
  throw error;
}
