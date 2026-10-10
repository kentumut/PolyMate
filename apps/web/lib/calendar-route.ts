import { ContractError, parseOperationId, type CalendarEvent, type OperationResult, type StudyBlockChanges, type StudyBlockInput } from '@polymate/contracts/calendar';
import type { CalendarClient } from '@polymate/contracts/calendar';
import type { DateRange } from '@polymate/contracts/time';
import { GoogleApiError, GoogleCalendarApi, GoogleNotConnectedError, GoogleTransportError } from '@polymate/core/calendar/google-api';
import { toCalendarEvent } from '@polymate/core/calendar/mapping';
import { CalendarService, CalendarServiceError } from '@polymate/core/calendar';
import { googleStudyBlockHome, moveStudyBlocks, toMovableBlock, type CalendarHome, type MoveOutcome, type StudyBlockHome } from '@polymate/core/calendar/home';
import { StandaloneCalendarService, type StandaloneEventStore } from '@polymate/core/calendar/standalone';
import { constantTimeEqual } from '@polymate/core/google-auth/crypto';
import { assertSameOrigin, IdentityError, resolveOwner, type OwnerContext } from '@polymate/core/identity';
import { CalendarBusyError } from '@polymate/core/calendar/operations';
import type { ProgressCalendar } from '@polymate/core/progress';
import { calendarOperationStore, findCalendarOperation, listUnresolvedCalendarOperations } from '@polymate/db/calendar-operations';
import {
  completeStandaloneCalendarEvent, createStandaloneCalendarEvent, deleteStandaloneCalendarEvent,
  findStandaloneCalendarEvent, listStandaloneCalendarEvents, putStandaloneCalendarEvent, removeStandaloneCalendarEvent, updateStandaloneCalendarEvent,
} from '@polymate/db/calendar-events';
import { ensureUser, getConnectionStatus, getValidAccessToken, setCalendarHome } from '@polymate/db/google-oauth';
import { observeStudyCalendarChange } from '@polymate/db/study-progress';
import { ProgressError } from '@polymate/core/progress';
import type { NextRequest, NextResponse } from 'next/server';

export const CALENDAR_CSRF_COOKIE = 'polymate_calendar_csrf';
const NO_STORE = { 'Cache-Control': 'no-store' };

export function setCalendarCsrfCookie(response: NextResponse, token: string): void {
  response.cookies.set(CALENDAR_CSRF_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV !== 'development', sameSite: 'strict', path: '/api/calendar', maxAge: 8 * 60 * 60,
  });
}

class CsrfError extends IdentityError {
  constructor() { super('Your session expired. Reload the page and try again.', 403); }
}

export function assertCalendarMutation(request: NextRequest): void {
  assertSameOrigin(request);
  const cookie = request.cookies.get(CALENDAR_CSRF_COOKIE)?.value;
  const supplied = request.headers.get('x-csrf-token');
  if (!cookie || !supplied || !constantTimeEqual(cookie, supplied)) throw new CsrfError();
}

const standaloneEvents: StandaloneEventStore = {
  ensureOwner: ensureUser,
  list: listStandaloneCalendarEvents,
  find: findStandaloneCalendarEvent,
  create: createStandaloneCalendarEvent,
  update: updateStandaloneCalendarEvent,
  complete: completeStandaloneCalendarEvent,
  delete: deleteStandaloneCalendarEvent,
};

/** The student's chosen calendar: PolyMate, or Google with PolyMate showing the same blocks. */
export type OwnerCalendar = CalendarClient & ProgressCalendar & {
  getStudyBlock(id: string): Promise<CalendarEvent | null>;
  listBusy(range: DateRange): Promise<CalendarEvent[]>;
};

type ConnectionStatus = { connected: boolean; calendarHome?: CalendarHome };

function googleApiFor(owner: OwnerContext): GoogleCalendarApi {
  return new GoogleCalendarApi({ accessToken: () => getValidAccessToken(owner) });
}

/** Reads the stored choice. Without Google configured, every student uses the PolyMate calendar. */
export async function calendarHomeFor(ownerId: string): Promise<{ home: CalendarHome; connected: boolean }> {
  if (process.env.GOOGLE_ENABLED !== 'true') return { home: 'polymate', connected: false };
  const status: ConnectionStatus = await getConnectionStatus(ownerId);
  return { home: status.calendarHome === 'google' ? 'google' : 'polymate', connected: status.connected };
}

function polymateCalendar(owner: OwnerContext, googleConnected: Promise<boolean>): OwnerCalendar {
  const googleEvents = process.env.GOOGLE_ENABLED === 'true' ? async (range: { from: string; to: string }) => {
    if (!await googleConnected) return [];
    return (await googleApiFor(owner).list(range.from, range.to)).flatMap(event => {
      const mapped = toCalendarEvent(event, owner.userId);
      if (!mapped || mapped.source === 'polymate') return [];
      return [{ ...mapped, id: `google_${mapped.id}` }];
    });
  } : null;
  return new StandaloneCalendarService(owner, standaloneEvents, calendarOperationStore, googleEvents);
}

async function resolveCalendar(owner: OwnerContext): Promise<OwnerCalendar> {
  const { home, connected } = await calendarHomeFor(owner.userId);
  // A Google home never falls back to PolyMate: a block written to the wrong calendar is worse
  // than a clear "reconnect Google" error.
  if (home === 'google') return new CalendarService(owner.userId, googleApiFor(owner), calendarOperationStore);
  return polymateCalendar(owner, Promise.resolve(connected));
}

/**
 * Owner-bound calendar for the student's chosen home. The choice is read once, on first use, so
 * every call on one instance goes to the same calendar.
 */
export function calendarServiceFor(owner: OwnerContext): OwnerCalendar {
  let backend: Promise<OwnerCalendar> | undefined;
  const resolved = () => backend ??= resolveCalendar(owner);
  return {
    listWeek: async range => (await resolved()).listWeek(range),
    listBusy: async range => (await resolved()).listBusy(range),
    readStudyBlock: async id => (await resolved()).readStudyBlock(id),
    getStudyBlock: async id => (await resolved()).getStudyBlock(id),
    createStudyBlock: async (input, operationId) => (await resolved()).createStudyBlock(input, operationId),
    updateStudyBlock: async (id, changes, etag, operationId) => (await resolved()).updateStudyBlock(id, changes, etag, operationId),
    completeStudyBlock: async (id, etag, operationId) => (await resolved()).completeStudyBlock(id, etag, operationId),
    deleteStudyBlock: async (id, etag, operationId) => (await resolved()).deleteStudyBlock(id, etag, operationId),
  };
}

const UPCOMING_DAYS = 400;

function upcomingRange(now = Date.now()): DateRange {
  return { from: new Date(now).toISOString(), to: new Date(now + UPCOMING_DAYS * 86_400_000).toISOString() };
}

function studyBlockHome(owner: OwnerContext, home: CalendarHome): StudyBlockHome {
  if (home === 'google') return googleStudyBlockHome(googleApiFor(owner), owner.userId);
  return {
    listOwnBlocks: async range => (await listStandaloneCalendarEvents(owner.userId, range)).map(toMovableBlock),
    put: block => putStandaloneCalendarEvent(owner, block),
    remove: id => removeStandaloneCalendarEvent(owner.userId, id),
  };
}

export class CalendarHomeError extends Error {
  constructor(readonly code: 'not_connected' | 'pending_operations' | 'incomplete', message: string, readonly status: number) {
    super(message);
    this.name = 'CalendarHomeError';
  }
}

/** How many upcoming blocks a switch would move, so the student can confirm first. */
export async function previewCalendarHome(owner: OwnerContext, to: CalendarHome): Promise<{ home: CalendarHome; upcomingBlocks: number }> {
  const { home } = await calendarHomeFor(owner.userId);
  if (home === to) return { home, upcomingBlocks: 0 };
  return { home, upcomingBlocks: (await studyBlockHome(owner, home).listOwnBlocks(upcomingRange())).length };
}

/**
 * Moves upcoming blocks to the new home, and only then records the new choice. A failed move keeps
 * the old choice; blocks already moved stay hidden copies until a retry finishes the move.
 * Holds the owner's calendar lock so no other calendar write can run in between.
 */
export async function switchCalendarHome(owner: OwnerContext, to: CalendarHome): Promise<{ home: CalendarHome } & MoveOutcome> {
  if (to === 'google') {
    if (process.env.GOOGLE_ENABLED !== 'true' || !(await getConnectionStatus(owner.userId)).connected) {
      throw new CalendarHomeError('not_connected', 'Connect Google Calendar before saving study blocks there.', 409);
    }
  }
  return calendarOperationStore.withOwnerLock(owner.userId, async () => {
    const { home } = await calendarHomeFor(owner.userId);
    if (home === to) return { home, total: 0, moved: 0, complete: true };
    if ((await listUnresolvedCalendarOperations(owner.userId)).length) {
      throw new CalendarHomeError('pending_operations', 'A calendar change is still unconfirmed. Check it in the calendar before switching.', 409);
    }
    const outcome = await moveStudyBlocks(studyBlockHome(owner, home), studyBlockHome(owner, to), upcomingRange());
    if (!outcome.complete) {
      throw new CalendarHomeError('incomplete', `Moved ${outcome.moved} of ${outcome.total} study blocks. Your blocks stay in the ${home === 'google' ? 'Google' : 'PolyMate'} calendar; try again to finish.`, 503);
    }
    await setCalendarHome(owner.userId, to);
    return { home: to, ...outcome };
  });
}

const STATUS_FOR: Record<string, number> = {
  validation: 422, overlap: 409, conflict: 409, forbidden: 403, not_found: 404, not_connected: 409, google_unavailable: 503,
};

export function operationResponse(result: OperationResult): Response {
  const status = result.status === 'synced' ? 200 : result.status === 'unknown' ? 202 : STATUS_FOR[result.error?.code ?? ''] ?? 500;
  return Response.json(result, { status, headers: NO_STORE });
}

export function calendarError(error: unknown): Response {
  let status = 500;
  let code = 'unknown';
  let message = 'Calendar request failed.';
  if (error instanceof CsrfError) [status, code, message] = [403, 'csrf', error.message];
  else if (error instanceof IdentityError) [status, code, message] = [error.status, 'identity', error.message];
  else if (error instanceof CalendarBusyError) [status, code, message] = [409, 'busy', error.message];
  else if (error instanceof ContractError) [status, code, message] = [422, 'validation', error.message];
  else if (error instanceof ProgressError) [status, code, message] = [error.code === 'not_found' ? 404 : error.code === 'forbidden' ? 403 : 409, error.code, error.message];
  else if (error instanceof CalendarHomeError) [status, code, message] = [error.status, error.code, error.message];
  else if (error instanceof CalendarServiceError) [status, code, message] = [STATUS_FOR[error.code] ?? 409, error.code, error.message];
  else if (error instanceof GoogleNotConnectedError) [status, code, message] = [409, 'not_connected', 'Google Calendar is not connected. Reconnect it to see and change your study blocks.'];
  else if (error instanceof GoogleApiError || error instanceof GoogleTransportError) {
    [status, code, message] = [503, 'google_unavailable', 'Google Calendar is not responding. Try again in a moment.'];
  } else console.error('Calendar route failed.', error instanceof Error ? error.name : typeof error);
  return Response.json({ error: { code, message } }, { status, headers: NO_STORE });
}

async function readJson(request: NextRequest): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ContractError('Send JSON.');
  try {
    return await request.json();
  } catch {
    throw new ContractError('Request body is not valid JSON.');
  }
}

/** Shared write path: identity → same-origin + CSRF → validated body → owner-bound service. */
export async function calendarMutation<T>(
  request: NextRequest,
  parse: (body: unknown) => T,
  run: (service: CalendarClient, input: T) => Promise<OperationResult>,
  before?: (owner: OwnerContext, input: T) => Promise<void>,
): Promise<Response> {
  try {
    const owner = resolveOwner(request.headers);
    assertCalendarMutation(request);
    const input = parse(await readJson(request));
    if (before) await before(owner, input);
    const result = await run(calendarServiceFor(owner), input);
    const path = new URL(request.url).pathname;
    const kind = request.method === 'DELETE' ? 'delete' : request.method === 'PATCH' ? 'update' : path.endsWith('/complete') ? 'complete' : 'create';
    const target = kind === 'create' ? null : decodeURIComponent(path.split('/').at(kind === 'complete' ? -2 : -1)!);
    await observeStudyCalendarChange(owner.userId, kind, target, result);
    return operationResponse(result);
  } catch (error) {
    return calendarError(error);
  }
}

/** Only replay an existing owner-scoped record; the service reconciles uncertain writes with reads. */
export async function reconcileCalendarOperation(request: NextRequest, id: string): Promise<Response> {
  try {
    const owner = resolveOwner(request.headers);
    assertCalendarMutation(request);
    const operationId = parseOperationId(id);
    const stored = await findCalendarOperation(owner.userId, operationId);
    if (!stored) return Response.json({ error: { code: 'not_found', message: 'Calendar operation not found.' } }, { status: 404, headers: NO_STORE });
    if (stored.result?.status === 'synced' || stored.result?.status === 'failed') {
      await observeStudyCalendarChange(owner.userId, stored.record.kind, stored.record.targetEventId, stored.result);
      return operationResponse(stored.result);
    }
    const service = calendarServiceFor(owner);
    const { record } = stored;
    let result: OperationResult;
    if (record.kind === 'create') result = await service.createStudyBlock(record.intendedChange as StudyBlockInput, operationId);
    else {
      if (!record.targetEventId || !record.expectedEtag) throw new ContractError('The saved operation is missing its event version.');
      if (record.kind === 'update') result = await service.updateStudyBlock(record.targetEventId, record.intendedChange as StudyBlockChanges, record.expectedEtag, operationId);
      else if (record.kind === 'complete') result = await service.completeStudyBlock(record.targetEventId, record.expectedEtag, operationId);
      else result = await service.deleteStudyBlock(record.targetEventId, record.expectedEtag, operationId);
    }
    await observeStudyCalendarChange(owner.userId, record.kind, record.targetEventId, result);
    return operationResponse(result);
  } catch (error) {
    return calendarError(error);
  }
}
