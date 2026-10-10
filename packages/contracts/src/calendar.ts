import type { DateRange } from './time';

export type EventSource = 'google-personal' | 'polymate';
export type Completion = 'open' | 'done';

/** One event shown in the student's PolyMate calendar, including optional read-only overlays. */
export type CalendarEvent = Readonly<{
  id: string;
  title: string;
  /** ISO instants. All-day events start and end at Zurich midnight. */
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  source: EventSource;
  /** PolyMate-owned events can be changed; optional external events are read-only busy time. */
  editable: boolean;
  completion: Completion;
  etag: string;
}>;

export type StudyBlockInput = Readonly<{ title: string; startAt: string; endAt: string }>;
export type StudyBlockChanges = Readonly<Partial<StudyBlockInput>>;

export type OperationStatus = 'pending' | 'synced' | 'failed' | 'unknown';
export type OperationErrorCode =
  | 'validation'
  | 'overlap'
  | 'conflict'
  | 'forbidden'
  | 'not_found'
  | 'not_connected'
  | 'google_unavailable'
  | 'unknown';

export type OperationError = Readonly<{ code: OperationErrorCode; message: string }>;

/**
 * `synced` means Google confirmed the change. `unknown` means the write may or may not have
 * reached Google; retrying with the same operationId is safe and reconciles it.
 */
export type OperationResult = Readonly<{
  operationId: string;
  status: OperationStatus;
  event?: CalendarEvent;
  error?: OperationError;
}>;

export interface CalendarClient {
  listWeek(range: DateRange): Promise<CalendarEvent[]>;
  createStudyBlock(input: StudyBlockInput, operationId: string): Promise<OperationResult>;
  updateStudyBlock(id: string, changes: StudyBlockChanges, expectedEtag: string, operationId: string): Promise<OperationResult>;
  completeStudyBlock(id: string, expectedEtag: string, operationId: string): Promise<OperationResult>;
  deleteStudyBlock(id: string, expectedEtag: string, operationId: string): Promise<OperationResult>;
}

/** Wire bodies for the authenticated `/api/calendar` routes. */
export type CreateStudyBlockRequest = Readonly<{ operationId: string; block: StudyBlockInput }>;
export type UpdateStudyBlockRequest = Readonly<{ operationId: string; expectedEtag: string; changes: StudyBlockChanges }>;
export type StudyBlockActionRequest = Readonly<{ operationId: string; expectedEtag: string }>;
export type ListEventsResponse = Readonly<{ range: DateRange; events: CalendarEvent[] }>;

export const STUDY_BLOCK_DEFAULT_MINUTES = 50;
export const STUDY_BLOCK_MIN_MINUTES = 10;
export const STUDY_BLOCK_MAX_MINUTES = 8 * 60;
export const STUDY_BLOCK_TITLE_MAX = 200;
export const MAX_RANGE_DAYS = 42;

export class ContractError extends Error {
  readonly code = 'validation' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ContractError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFSET_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
/** JSON Schema for tool arguments parsed by parseInstant; spelling out the format avoids a failed call and a retry. */
export const OFFSET_INSTANT_SCHEMA = {
  type: 'string',
  pattern: OFFSET_INSTANT.source,
  description: 'ISO 8601 date and time with a timezone offset, e.g. 2026-10-12T14:00:00+02:00 (Europe/Zurich). Dates without a time or offset are rejected.',
} as const;
const EVENT_ID = /^[A-Za-z0-9_-]{1,1024}$/;
const MINUTE = 60_000;

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ContractError(`${what} must be an object.`);
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, keys: string[], what: string): void {
  const extra = Object.keys(value).filter(key => !keys.includes(key));
  if (extra.length) throw new ContractError(`${what} has unsupported fields: ${extra.join(', ')}.`);
}

/** Accepts an ISO timestamp with an explicit offset and returns it normalized to UTC. */
export function parseInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !OFFSET_INSTANT.test(value)) {
    throw new ContractError(`${field} must be an ISO timestamp with a timezone offset.`);
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new ContractError(`${field} is not a valid time.`);
  return new Date(time).toISOString();
}

export function parseOperationId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ContractError('operationId must be a UUID.');
  return value.toLowerCase();
}

export function parseEventId(value: unknown): string {
  if (typeof value !== 'string' || !EVENT_ID.test(value)) throw new ContractError('Event ID is invalid.');
  return value;
}

export function parseEtag(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256) throw new ContractError('expectedEtag is required.');
  return value;
}

function parseTitle(value: unknown): string {
  if (typeof value !== 'string') throw new ContractError('title must be text.');
  const title = value.trim().replace(/\s+/g, ' ');
  if (!title) throw new ContractError('Give the study block a title.');
  if (title.length > STUDY_BLOCK_TITLE_MAX) throw new ContractError(`Keep the title under ${STUDY_BLOCK_TITLE_MAX} characters.`);
  return title;
}

/** Interval rules shared by forms and the server: positive, minute-aligned, and a sensible length. */
export function validateStudyInterval(startAt: string, endAt: string): void {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (start % MINUTE !== 0 || end % MINUTE !== 0) throw new ContractError('Times must be whole minutes.');
  const minutes = (end - start) / MINUTE;
  if (minutes <= 0) throw new ContractError('The block must end after it starts.');
  if (minutes < STUDY_BLOCK_MIN_MINUTES) throw new ContractError(`Study blocks need at least ${STUDY_BLOCK_MIN_MINUTES} minutes.`);
  if (minutes > STUDY_BLOCK_MAX_MINUTES) throw new ContractError(`Study blocks can last at most ${STUDY_BLOCK_MAX_MINUTES / 60} hours.`);
}

export function parseStudyBlockInput(value: unknown): StudyBlockInput {
  const input = record(value, 'block');
  only(input, ['title', 'startAt', 'endAt'], 'block');
  const block = { title: parseTitle(input.title), startAt: parseInstant(input.startAt, 'startAt'), endAt: parseInstant(input.endAt, 'endAt') };
  validateStudyInterval(block.startAt, block.endAt);
  return block;
}

/** A move must send both times so the server never guesses the intended duration. */
export function parseStudyBlockChanges(value: unknown): StudyBlockChanges {
  const input = record(value, 'changes');
  only(input, ['title', 'startAt', 'endAt'], 'changes');
  const changes: { title?: string; startAt?: string; endAt?: string } = {};
  if (input.title !== undefined) changes.title = parseTitle(input.title);
  if ((input.startAt === undefined) !== (input.endAt === undefined)) {
    throw new ContractError('Send startAt and endAt together when moving a block.');
  }
  if (input.startAt !== undefined) {
    changes.startAt = parseInstant(input.startAt, 'startAt');
    changes.endAt = parseInstant(input.endAt, 'endAt');
    validateStudyInterval(changes.startAt, changes.endAt);
  }
  if (!Object.keys(changes).length) throw new ContractError('Nothing to change.');
  return changes;
}

export function parseDateRange(value: { from?: unknown; to?: unknown }): DateRange {
  const from = parseInstant(value.from, 'from');
  const to = parseInstant(value.to, 'to');
  const days = (Date.parse(to) - Date.parse(from)) / (24 * 60 * MINUTE);
  if (days <= 0) throw new ContractError('The range must end after it starts.');
  if (days > MAX_RANGE_DAYS) throw new ContractError(`Request at most ${MAX_RANGE_DAYS} days at once.`);
  return { from, to };
}

export function parseCreateRequest(value: unknown): CreateStudyBlockRequest {
  const body = record(value, 'request');
  only(body, ['operationId', 'block'], 'request');
  return { operationId: parseOperationId(body.operationId), block: parseStudyBlockInput(body.block) };
}

export function parseUpdateRequest(value: unknown): UpdateStudyBlockRequest {
  const body = record(value, 'request');
  only(body, ['operationId', 'expectedEtag', 'changes'], 'request');
  return {
    operationId: parseOperationId(body.operationId),
    expectedEtag: parseEtag(body.expectedEtag),
    changes: parseStudyBlockChanges(body.changes),
  };
}

export function parseActionRequest(value: unknown): StudyBlockActionRequest {
  const body = record(value, 'request');
  only(body, ['operationId', 'expectedEtag'], 'request');
  return { operationId: parseOperationId(body.operationId), expectedEtag: parseEtag(body.expectedEtag) };
}

/** Flat dialog wire contract; delegates interval/title validation to the service contract. */
export function parseDialogCreateRequest(value: unknown): CreateStudyBlockRequest & { assignmentId?: string; expectedAssignmentVersion?: number } {
  const body = record(value, 'request');
  only(body, ['operationId', 'title', 'startAt', 'endAt', 'timezone', 'assignmentId', 'expectedAssignmentVersion'], 'request');
  if (body.timezone !== 'Europe/Zurich') throw new ContractError('timezone must be Europe/Zurich.');
  if ((body.assignmentId === undefined) !== (body.expectedAssignmentVersion === undefined)) throw new ContractError('Send the assignment ID and version together.');
  if (body.assignmentId !== undefined && (typeof body.expectedAssignmentVersion !== 'number' || !Number.isInteger(body.expectedAssignmentVersion) || body.expectedAssignmentVersion < 1)) throw new ContractError('Review the current assignment version.');
  return { operationId: parseOperationId(body.operationId), block: parseStudyBlockInput({ title: body.title, startAt: body.startAt, endAt: body.endAt }),
    ...(body.assignmentId !== undefined ? { assignmentId: parseOperationId(body.assignmentId), expectedAssignmentVersion: body.expectedAssignmentVersion as number } : {}) };
}

export function parseDialogUpdateRequest(value: unknown): UpdateStudyBlockRequest {
  const body = record(value, 'request');
  only(body, ['operationId', 'expectedEtag', 'title', 'startAt', 'endAt', 'timezone'], 'request');
  if (body.timezone !== 'Europe/Zurich') throw new ContractError('timezone must be Europe/Zurich.');
  return {
    operationId: parseOperationId(body.operationId), expectedEtag: parseEtag(body.expectedEtag),
    changes: parseStudyBlockInput({ title: body.title, startAt: body.startAt, endAt: body.endAt }),
  };
}

/** Builds a proposed block of the default length; the student still chooses the time. */
export function proposeStudyBlock(startAt: string, title = 'Study block'): StudyBlockInput {
  const start = parseInstant(startAt, 'startAt');
  return { title, startAt: start, endAt: new Date(Date.parse(start) + STUDY_BLOCK_DEFAULT_MINUTES * MINUTE).toISOString() };
}
