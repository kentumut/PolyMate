import { AssignmentValidationError } from '@polymate/contracts/assignments';
import { AssignmentRequestConflict } from '@polymate/db/assignments';
import { assertSameOrigin, IdentityError } from '@polymate/core/identity';
import { constantTimeEqual } from '@polymate/core/google-auth/crypto';
import type { NextRequest, NextResponse } from 'next/server';

export const ASSIGNMENT_CSRF_COOKIE = 'polymate_assignments_csrf';

export function setAssignmentCsrfCookie(response: NextResponse, token: string) {
  response.cookies.set(ASSIGNMENT_CSRF_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV !== 'development', sameSite: 'strict', path: '/api/assignments', maxAge: 8 * 60 * 60,
  });
}

class AssignmentCsrfError extends IdentityError {
  constructor() { super('Your session expired. Retry to refresh it.', 403); }
}

export function assertAssignmentMutation(request: NextRequest) {
  assertSameOrigin(request);
  const cookie = request.cookies.get(ASSIGNMENT_CSRF_COOKIE)?.value;
  const token = request.headers.get('x-csrf-token');
  if (!cookie || !token || !constantTimeEqual(cookie, token)) throw new AssignmentCsrfError();
}

export function assignmentRouteError(error: unknown) {
  let status = 500; let code = 'assignment_unavailable'; let message = 'Assignment request failed. Please retry.';
  if (error instanceof AssignmentCsrfError) [status, code, message] = [403, 'csrf', error.message];
  else if (error instanceof IdentityError) [status, code, message] = [error.status, 'identity', error.message];
  else if (error instanceof AssignmentValidationError) [status, code, message] = [422, 'validation', error.message];
  else if (error instanceof AssignmentRequestConflict) [status, code, message] = [409, 'request_conflict', error.message];
  else console.error('Assignment request failed.', error instanceof Error ? error.name : typeof error);
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
