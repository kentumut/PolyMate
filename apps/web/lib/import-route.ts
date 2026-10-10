import { ContractError } from '@polymate/contracts/calendar';
import { ImportStoreError } from '@polymate/contracts/imports';
import { CalendarImportError } from '@polymate/core/calendar/import';
import { CalendarBusyError } from '@polymate/core/calendar/operations';
import { assignmentRouteError } from './assignment-route';

export function importRouteError(error: unknown) {
  if (error instanceof ImportStoreError || error instanceof ContractError || error instanceof CalendarImportError || error instanceof CalendarBusyError) {
    const status = error instanceof ImportStoreError ? error.code === 'not_found' ? 404 : 409 : error instanceof CalendarBusyError ? 409 : 422;
    return Response.json({ error: { code: error instanceof ImportStoreError ? error.code : 'validation', message: error.message } }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
  return assignmentRouteError(error);
}
