import { ContractError, parseOperationId, type OperationResult, type StudyBlockChanges, type StudyBlockInput } from '@polymate/contracts/calendar';
import { CalendarService } from '@polymate/core/calendar';
import { GoogleApiError, GoogleCalendarApi, GoogleNotConnectedError, GoogleTransportError } from '@polymate/core/calendar/google-api';
import { constantTimeEqual } from '@polymate/core/google-auth/crypto';
import { assertSameOrigin, IdentityError, resolveOwner, type OwnerContext } from '@polymate/core/identity';
import { CalendarBusyError } from '@polymate/core/calendar/operations';
import { calendarOperationStore, findCalendarOperation } from '@polymate/db/calendar-operations';
import { getValidAccessToken } from '@polymate/db/google-oauth';
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

function assertCalendarMutation(request: NextRequest): void {
  assertSameOrigin(request);
  const cookie = request.cookies.get(CALENDAR_CSRF_COOKIE)?.value;
  const supplied = request.headers.get('x-csrf-token');
  if (!cookie || !supplied || !constantTimeEqual(cookie, supplied)) throw new CsrfError();
}

/** The service is always bound to the resolved owner; clients never choose whose calendar is used. */
export function calendarServiceFor(owner: OwnerContext): CalendarService {
  if (process.env.GOOGLE_ENABLED !== 'true') throw new GoogleNotConnectedError();
  const api = new GoogleCalendarApi({ accessToken: () => getValidAccessToken(owner) });
  return new CalendarService(owner.userId, api, calendarOperationStore);
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
  else if (error instanceof GoogleNotConnectedError) [status, code, message] = [409, 'not_connected', 'Connect Google Calendar to see your week.'];
  else if (error instanceof GoogleApiError || error instanceof GoogleTransportError) {
    [status, code, message] = [503, 'google_unavailable', 'Google Calendar is not responding. Try again shortly.'];
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
  run: (service: CalendarService, input: T) => Promise<OperationResult>,
): Promise<Response> {
  try {
    const owner = resolveOwner(request.headers);
    assertCalendarMutation(request);
    const input = parse(await readJson(request));
    return operationResponse(await run(calendarServiceFor(owner), input));
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
    if (stored.result?.status === 'synced' || stored.result?.status === 'failed') return operationResponse(stored.result);
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
    return operationResponse(result);
  } catch (error) {
    return calendarError(error);
  }
}
