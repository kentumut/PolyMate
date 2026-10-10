import { ContractError } from '@polymate/contracts/calendar';
import { CourseConflict } from '@polymate/db/courses';
import { IdentityError } from '@polymate/core/identity';

export function courseRouteError(error: unknown): Response {
  let status = 500; let code = 'courses_unavailable'; let message = 'Courses are unavailable. Please retry.';
  if (error instanceof IdentityError) [status, code, message] = [error.status, 'identity', error.message];
  else if (error instanceof ContractError) [status, code, message] = [422, 'validation', error.message];
  else if (error instanceof CourseConflict) [status, code, message] = [409, 'conflict', error.message];
  else if (error instanceof SyntaxError) [status, code, message] = [422, 'validation', 'Send valid JSON.'];
  else console.error('Course request failed.', error instanceof Error ? error.name : typeof error);
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
