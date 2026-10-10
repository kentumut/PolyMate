import { resolveOwner, type OwnerContext } from '@polymate/core/identity';
import { StudyProgressService } from '@polymate/core/progress';
import { studyProgressStore, observeStudyCalendarChange } from '@polymate/db/study-progress';
import { constantTimeEqual } from '@polymate/core/google-auth/crypto';
import { assertSameOrigin, IdentityError } from '@polymate/core/identity';
import { ContractError, parseEtag, parseEventId, parseOperationId, parseStudyBlockChanges, type OperationResult } from '@polymate/contracts/calendar';
import { positiveVersion } from '@polymate/contracts/study-progress';
import { ProgressError } from '@polymate/core/progress';
import { CalendarServiceError } from '@polymate/core/calendar';
import type { NextRequest, NextResponse } from 'next/server';
import { calendarError, calendarServiceFor } from './calendar-route';

const COOKIE = 'polymate_progress_csrf';

export type ProgressSyncStatus = 'synced' | 'pending' | 'not_attempted';

/** Google has already recorded its outcome. A secondary metadata failure cannot change it. */
export async function observeStudyMoveFor(owner: OwnerContext, eventId: string, result: OperationResult): Promise<ProgressSyncStatus> {
  if (result.status !== 'synced') return 'not_attempted';
  try {
    await observeStudyCalendarChange(owner.userId, 'update', eventId, result);
    return 'synced';
  } catch (error) {
    console.error('Study move metadata sync pending.', error instanceof Error ? error.name : 'unknown error');
    // The confirmed calendar ledger remains available to repairCalendarEffects on the next state read.
    return 'pending';
  }
}

/** Runtime adapter supplies an authenticated OwnerContext, not model-selected IDs. */
export function studyProgressServiceFor(owner: OwnerContext) {
  return new StudyProgressService(owner.userId, calendarServiceFor(owner), studyProgressStore);
}

/** Validated tool action for moving the same linked block; availability/ETag/idempotency stay in CalendarService. */
export async function rescheduleStudySessionFor(owner: OwnerContext, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('Send rescheduling details.');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['eventId','operationId','expectedEtag','expectedSessionRevision','startAt','endAt'].includes(key))) throw new ContractError('Unsupported rescheduling fields.');
  const eventId = parseEventId(body.eventId); const operationId = parseOperationId(body.operationId);
  const expectedEtag = parseEtag(body.expectedEtag); const revision = positiveVersion(body.expectedSessionRevision);
  const changes = parseStudyBlockChanges({ startAt: body.startAt, endAt: body.endAt });
  const state = await studyProgressStore.state(owner.userId);
  const link = state.links.find(item => item.eventId === eventId && !item.deleted);
  if (!link) throw new ProgressError('not_found', 'Linked study session not found.');
  // Replay uses the same service operation record; do not reject a successfully applied move on retry.
  const { findCalendarOperation } = await import('@polymate/db/calendar-operations');
  const prior = await findCalendarOperation(owner.userId, operationId);
  if (!prior && link.sessionRevision !== revision) throw new ProgressError('version_conflict', 'This session changed. Refresh before moving it.');
  const result = await calendarServiceFor(owner).updateStudyBlock(eventId, changes, expectedEtag, operationId);
  return { ...result, progressSync: await observeStudyMoveFor(owner, eventId, result) };
}
export function setProgressCookie(response: NextResponse, token: string) {
  response.cookies.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV !== 'development', sameSite: 'strict', path: '/api/study-progress', maxAge: 8 * 60 * 60 });
}
export function progressWriteOwner(request: NextRequest) {
  const owner = resolveOwner(request.headers);
  assertSameOrigin(request);
  const cookie = request.cookies.get(COOKIE)?.value;
  const token = request.headers.get('x-csrf-token');
  if (!cookie || !token || !constantTimeEqual(cookie, token)) throw new IdentityError('Progress session expired. Refresh and retry.', 403);
  return owner;
}
export async function progressJson(request: NextRequest) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ContractError('Send JSON.');
  try { return await request.json(); } catch { throw new ContractError('Progress request is not valid JSON.'); }
}
export function progressRouteError(error: unknown) {
  if (error instanceof CalendarServiceError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.code === 'forbidden' ? 403 : error.code === 'not_found' ? 404 : 409, headers: { 'Cache-Control': 'no-store' } });
  return calendarError(error);
}
