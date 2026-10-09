import { parseActionRequest, parseEventId, parseUpdateRequest } from '@polymate/contracts/calendar';
import type { NextRequest } from 'next/server';
import { calendarMutation } from '@/lib/calendar-route';

export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/calendar/events/[id]'>) {
  const { id } = await ctx.params;
  return calendarMutation(request, body => ({ id: parseEventId(id), ...parseUpdateRequest(body) }),
    (service, input) => service.updateStudyBlock(input.id, input.changes, input.expectedEtag, input.operationId));
}

export async function DELETE(request: NextRequest, ctx: RouteContext<'/api/calendar/events/[id]'>) {
  const { id } = await ctx.params;
  return calendarMutation(request, body => ({ id: parseEventId(id), ...parseActionRequest(body) }),
    (service, input) => service.deleteStudyBlock(input.id, input.expectedEtag, input.operationId));
}
