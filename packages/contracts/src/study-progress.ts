import type { Assignment } from './assignments';
import { ASSIGNMENT_EFFORT_MAX } from './assignments';
import { ContractError, parseEtag, parseEventId, parseOperationId, type CalendarEvent, type OperationResult } from './calendar';

export type ProgressAction = 'done' | 'partly_done' | 'missed' | 'stuck';
export type BlockAssignmentLink = Readonly<{
  eventId: string; assignmentId: string; sessionRevision: number; completion: 'open' | 'done';
  startAt: string; endAt: string; etag: string; deleted: boolean;
}>;
export type ProgressRequest = Readonly<{
  clientRequestId: string; eventId: string; assignmentId: string; action: ProgressAction;
  expectedAssignmentVersion: number; expectedSessionRevision: number; expectedEtag: string;
  remainingMinutes?: number; assignmentFinished?: boolean; note?: string;
}>;
export type ProgressReport = Readonly<{
  id: string; clientRequestId: string; eventId: string; assignmentId: string; sessionRevision: number;
  action: ProgressAction; reportedRemainingMinutes: number | null; assignmentFinished: boolean; note: string; reportedAt: string;
}>;
export type ProgressReceipt = Readonly<{ report: ProgressReport; assignment: Assignment; calendarOperation?: OperationResult; calendarAlreadyDone?: boolean }>;
export type StudyProgressState = Readonly<{ assignments: Assignment[]; links: BlockAssignmentLink[]; reports: ProgressReport[]; pendingCompletions: ProgressRequest[] }>;
export type LinkRequest = Readonly<{ eventId: string; assignmentId: string; expectedAssignmentVersion: number; expectedEtag: string }>;
export type StudyActivityKind = 'block_linked' | 'progress_recorded' | 'block_rescheduled' | 'block_completed' | 'block_deleted';
export type StudyActivity = Readonly<{ id: string; kind: StudyActivityKind; payload: Record<string, unknown>; createdAt: string }>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('Send a progress object.');
  return value as Record<string, unknown>;
}
function only(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ContractError('Progress request contains unsupported fields.');
}
export function positiveVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) throw new ContractError('A valid current version is required.');
  return value;
}
export function parseLinkRequest(value: unknown): LinkRequest {
  const body = object(value); only(body, ['eventId', 'assignmentId', 'expectedAssignmentVersion', 'expectedEtag']);
  return { eventId: parseEventId(body.eventId), assignmentId: parseOperationId(body.assignmentId),
    expectedAssignmentVersion: positiveVersion(body.expectedAssignmentVersion), expectedEtag: parseEtag(body.expectedEtag) };
}
export function parseProgressRequest(value: unknown): ProgressRequest {
  const body = object(value);
  only(body, ['clientRequestId', 'eventId', 'assignmentId', 'action', 'expectedAssignmentVersion', 'expectedSessionRevision', 'expectedEtag', 'remainingMinutes', 'assignmentFinished', 'note']);
  if (typeof body.action !== 'string' || !['done', 'partly_done', 'missed', 'stuck'].includes(body.action)) throw new ContractError('Choose a valid progress action.');
  if (body.assignmentFinished !== undefined && typeof body.assignmentFinished !== 'boolean') throw new ContractError('Confirm assignment completion explicitly.');
  if (body.note !== undefined && typeof body.note !== 'string') throw new ContractError('The note must be text.');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > 2000) throw new ContractError('Keep the note under 2000 characters.');
  if (body.action === 'stuck' && !note) throw new ContractError('Tell us which question or topic was difficult.');
  if (body.assignmentFinished === true && body.action !== 'done') throw new ContractError('Choose Done to confirm the entire assignment is finished.');
  if (body.action === 'missed' && body.remainingMinutes !== undefined) throw new ContractError('Missing a session does not change remaining effort.');
  if (body.remainingMinutes !== undefined && (typeof body.remainingMinutes !== 'number' || !Number.isInteger(body.remainingMinutes)
    || body.remainingMinutes < 0 || body.remainingMinutes > ASSIGNMENT_EFFORT_MAX)) throw new ContractError('Remaining effort must be whole minutes.');
  if (body.action === 'partly_done' && (body.remainingMinutes === undefined || body.remainingMinutes === 0)) throw new ContractError('Report the positive remaining effort, or choose Done and confirm the assignment is finished.');
  if (body.remainingMinutes === 0 && body.assignmentFinished !== true) throw new ContractError('Confirm the whole assignment is finished before setting remaining work to zero.');
  if (body.assignmentFinished === true && body.remainingMinutes !== undefined && body.remainingMinutes !== 0) throw new ContractError('A finished assignment has no remaining work.');
  return {
    clientRequestId: parseOperationId(body.clientRequestId), eventId: parseEventId(body.eventId), assignmentId: parseOperationId(body.assignmentId), action: body.action as ProgressAction,
    expectedAssignmentVersion: positiveVersion(body.expectedAssignmentVersion), expectedSessionRevision: positiveVersion(body.expectedSessionRevision), expectedEtag: parseEtag(body.expectedEtag),
    ...(body.remainingMinutes !== undefined ? { remainingMinutes: body.remainingMinutes as number } : {}),
    ...(body.action === 'done' ? { assignmentFinished: body.assignmentFinished === true } : {}), ...(note ? { note } : {}),
  };
}
export function progressSignature(request: ProgressRequest): string {
  return JSON.stringify([request.clientRequestId, request.eventId, request.assignmentId, request.action, request.expectedAssignmentVersion,
    request.expectedSessionRevision, request.expectedEtag, request.remainingMinutes ?? null, request.assignmentFinished ?? false, request.note ?? '']);
}
export function assignmentAfterReport(assignment: Assignment, request: ProgressRequest): Assignment {
  const remainingMinutes = request.assignmentFinished ? 0 : request.remainingMinutes ?? assignment.remainingMinutes;
  return { ...assignment, remainingMinutes, status: request.assignmentFinished ? 'completed' : request.action === 'missed' ? assignment.status : 'in_progress', version: assignment.version + 1 };
}
export function assertProgressContext(assignment: Assignment, link: BlockAssignmentLink, request: ProgressRequest, event: CalendarEvent) {
  if (link.deleted || link.assignmentId !== request.assignmentId || link.eventId !== request.eventId) throw new ContractError('The assignment/session link is no longer valid.');
  if (assignment.version !== request.expectedAssignmentVersion || link.sessionRevision !== request.expectedSessionRevision) throw new ContractError('Progress changed since you opened it. Refresh and review the latest values.');
  if (link.startAt !== event.startAt || link.endAt !== event.endAt) throw new ContractError('The session moved. Refresh the calendar before reporting progress.');
  if (assignment.status === 'cancelled' || (assignment.status === 'completed' && !request.assignmentFinished)) throw new ContractError('This assignment is already closed.');
}
