import { parseActionRequest, parseDialogUpdateRequest } from '@polymate/contracts/calendar';
import type { NextRequest } from 'next/server';
import { calendarMutation } from '@/lib/calendar-route';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return calendarMutation(request, parseDialogUpdateRequest,
    (service, { changes, expectedEtag, operationId }) => service.updateStudyBlock(id, changes, expectedEtag, operationId));
}

export async function DELETE(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return calendarMutation(request, parseActionRequest,
    (service, { expectedEtag, operationId }) => service.deleteStudyBlock(id, expectedEtag, operationId));
}
