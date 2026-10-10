import type { Assignment } from '@polymate/contracts/assignments';
import type { CalendarEvent, OperationResult } from '@polymate/contracts/calendar';
import { assertProgressContext, assignmentAfterReport, progressSignature, type BlockAssignmentLink, type LinkRequest, type ProgressReceipt, type ProgressRequest, type StudyProgressState } from '@polymate/contracts/study-progress';
import { ProgressError, progressConflict, type StudyProgressStore } from './service';

/** Labelled sample storage using the same progress reducer/context rules as PostgreSQL. */
export class MemoryStudyProgressStore implements StudyProgressStore {
  private links = new Map<string, BlockAssignmentLink>();
  private attempts = new Map<string, { request: ProgressRequest; receipt: ProgressReceipt }>();
  private tail: Promise<void> = Promise.resolve();
  constructor(private readonly owner: string, private readonly assignments: () => Promise<Assignment[]>, private readonly saveAssignment: (assignment: Assignment) => void) {}
  private authorize(ownerId: string) { if (ownerId !== this.owner) throw new ProgressError('forbidden', 'Sample owner mismatch.'); }
  private async serial<T>(run: () => Promise<T>) {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await run(); } finally { release(); }
  }
  async state(ownerId: string): Promise<StudyProgressState> {
    this.authorize(ownerId);
    return { assignments: await this.assignments(), links: [...this.links.values()], reports: [...this.attempts.values()].map(item => item.receipt.report),
      pendingCompletions: [...this.attempts.values()].filter(item => item.request.action === 'done' && !item.receipt.calendarAlreadyDone
        && (!item.receipt.calendarOperation || ['unknown','pending'].includes(item.receipt.calendarOperation.status))).map(item => item.request) };
  }
  async link(ownerId: string, request: LinkRequest, event: CalendarEvent) {
    this.authorize(ownerId);
    return this.serial(async () => {
    const existing = this.links.get(event.id);
    if (existing) {
      if (existing.assignmentId !== request.assignmentId || existing.deleted) throw new ProgressError('conflict', 'This block already belongs to an assignment.');
      return existing;
    }
    const assignment = (await this.assignments()).find(item => item.id === request.assignmentId);
    if (!assignment) throw new ProgressError('not_found', 'Assignment not found.');
    if (assignment.version !== request.expectedAssignmentVersion || assignment.status === 'cancelled') throw new ProgressError('conflict', 'Assignment changed. Refresh and review it.');
    const linked: BlockAssignmentLink = { eventId: event.id, assignmentId: assignment.id, sessionRevision: 1,
      startAt: event.startAt, endAt: event.endAt, etag: event.etag, completion: event.completion, deleted: false };
    this.links.set(event.id, linked); return linked;
    });
  }
  async attempt(ownerId: string, requestId: string) { this.authorize(ownerId); return this.attempts.get(requestId) ?? null; }
  async record(ownerId: string, request: ProgressRequest, event: CalendarEvent) {
    this.authorize(ownerId);
    return this.serial(async () => {
    const previous = this.attempts.get(request.clientRequestId);
    if (previous) {
      if (progressSignature(previous.request) !== progressSignature(request)) throw new ProgressError('conflict', 'Report request changed.');
      return previous.receipt;
    }
    const assignment = (await this.assignments()).find(item => item.id === request.assignmentId);
    const linked = this.links.get(request.eventId);
    if (!assignment || !linked) throw new ProgressError('not_found', 'Link the sample block to an assignment first.');
    try { assertProgressContext(assignment, linked, request, event); } catch (error) { progressConflict(error); }
    const next = assignmentAfterReport(assignment, request);
    this.saveAssignment(next);
    const receipt: ProgressReceipt = { assignment: next, report: {
      id: crypto.randomUUID(), clientRequestId: request.clientRequestId, eventId: request.eventId, assignmentId: request.assignmentId,
      sessionRevision: linked.sessionRevision, action: request.action, reportedRemainingMinutes: request.assignmentFinished ? 0 : request.remainingMinutes ?? null,
      assignmentFinished: request.assignmentFinished === true, note: request.note ?? '', reportedAt: new Date().toISOString(),
    }, ...(request.action === 'done' && event.completion === 'done' ? { calendarAlreadyDone: true } : {}) };
    this.attempts.set(request.clientRequestId, { request, receipt }); return receipt;
    });
  }
  async calendarResult(ownerId: string, requestId: string, result: OperationResult) {
    this.authorize(ownerId);
    const previous = this.attempts.get(requestId);
    if (!previous) throw new ProgressError('not_found', 'Report not found.');
    if (previous.receipt.calendarOperation?.status === 'synced' || previous.receipt.calendarOperation?.status === 'failed') return previous.receipt;
    this.observe('complete', previous.request.eventId, result);
    previous.receipt = { ...previous.receipt, calendarOperation: result }; return previous.receipt;
  }
  observe(kind: 'create' | 'update' | 'complete' | 'delete', eventId: string | null, result: OperationResult) {
    if (result.status !== 'synced') return;
    const id = result.event?.id ?? eventId;
    const current = id ? this.links.get(id) : undefined;
    if (!current || current.deleted) return;
    if (kind === 'delete') this.links.set(id!, { ...current, deleted: true, sessionRevision: current.sessionRevision + 1 });
    else if (result.event) {
      const moved = current.startAt !== result.event.startAt || current.endAt !== result.event.endAt;
      this.links.set(id!, { ...current, startAt: result.event.startAt, endAt: result.event.endAt, etag: result.event.etag,
        completion: result.event.completion, sessionRevision: current.sessionRevision + (moved ? 1 : 0) });
    }
  }
}
