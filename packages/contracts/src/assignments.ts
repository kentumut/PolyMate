import { parseInstant, parseOperationId } from './calendar';

export const ASSIGNMENT_TITLE_MAX = 200;
export const ASSIGNMENT_EFFORT_MAX = 2147483647; // PostgreSQL integer limit.

export type AssignmentInput = Readonly<{ title: string; dueAt: string; estimatedMinutes: number }>;
export type AssignmentStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type Assignment = AssignmentInput & Readonly<{
  id: string;
  remainingMinutes: number;
  status: AssignmentStatus;
  version: number;
}>;
export type AssignmentCreateRequest = AssignmentInput & Readonly<{ clientRequestId: string }>;

export class AssignmentValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'AssignmentValidationError'; }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AssignmentValidationError('Send an assignment object.');
  return value as Record<string, unknown>;
}

function deadline(value: unknown): string {
  try {
    const instant = parseInstant(value, 'dueAt');
    const date = (value as string).slice(0, 10);
    // Date.parse normalizes some impossible dates; reject those explicitly.
    if (date.startsWith('0000') || !/^\d{4}-/.test(instant) || instant.startsWith('0000')
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Invalid date');
    return instant;
  } catch { throw new AssignmentValidationError('Choose a valid deadline with an explicit timezone.'); }
}

export function parseAssignmentInput(value: unknown): AssignmentInput {
  const input = record(value);
  if (Object.keys(input).some(key => !['title', 'dueAt', 'estimatedMinutes'].includes(key))) {
    throw new AssignmentValidationError('Assignment contains unsupported fields.');
  }
  const title = typeof input.title === 'string' ? input.title.trim().replace(/\s+/g, ' ') : '';
  if (!title) throw new AssignmentValidationError('Enter an assignment title.');
  if (title.length > ASSIGNMENT_TITLE_MAX) throw new AssignmentValidationError(`Keep the title under ${ASSIGNMENT_TITLE_MAX} characters.`);
  if (typeof input.estimatedMinutes !== 'number' || !Number.isInteger(input.estimatedMinutes) || input.estimatedMinutes <= 0 || input.estimatedMinutes > ASSIGNMENT_EFFORT_MAX) {
    throw new AssignmentValidationError('Estimated effort must be a positive whole number of minutes.');
  }
  return { title, dueAt: deadline(input.dueAt), estimatedMinutes: input.estimatedMinutes };
}

export function parseAssignmentCreateRequest(value: unknown): AssignmentCreateRequest {
  const body = record(value);
  if (Object.keys(body).some(key => !['title', 'dueAt', 'estimatedMinutes', 'clientRequestId'].includes(key))) {
    throw new AssignmentValidationError('Assignment request contains unsupported fields.');
  }
  let clientRequestId: string;
  try { clientRequestId = parseOperationId(body.clientRequestId); }
  catch { throw new AssignmentValidationError('clientRequestId must be a UUID.'); }
  return { ...parseAssignmentInput({ title: body.title, dueAt: body.dueAt, estimatedMinutes: body.estimatedMinutes }), clientRequestId };
}

/** Validate server replies before displaying a save as confirmed. */
export function parseAssignment(value: unknown): Assignment {
  const item = record(value);
  const input = parseAssignmentInput({ title: item.title, dueAt: item.dueAt, estimatedMinutes: item.estimatedMinutes });
  let id: string;
  try { id = parseOperationId(item.id); } catch { throw new AssignmentValidationError('Assignment ID is invalid.'); }
  if (typeof item.remainingMinutes !== 'number' || !Number.isInteger(item.remainingMinutes) || item.remainingMinutes < 0 || item.remainingMinutes > ASSIGNMENT_EFFORT_MAX
    || typeof item.status !== 'string' || !['open', 'in_progress', 'completed', 'cancelled'].includes(item.status)
    || typeof item.version !== 'number' || !Number.isInteger(item.version) || item.version < 1) {
    throw new AssignmentValidationError('Assignment state is invalid.');
  }
  return { ...input, id, remainingMinutes: item.remainingMinutes, status: item.status as AssignmentStatus, version: item.version };
}
