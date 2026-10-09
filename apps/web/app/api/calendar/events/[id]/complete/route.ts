import { parseActionRequest, parseEventId } from '@polymate/contracts/calendar';
import type { NextRequest } from 'next/server';
import { calendarMutation } from '@/lib/calendar-route';

export async function POST(request: NextRequest, ctx: RouteContext<'/api/calendar/events/[id]/complete'>) {
  const { id } = await ctx.params;
  return calendarMutation(request, body => ({ id: parseEventId(id), ...parseActionRequest(body) }),
    (service, input) => service.completeStudyBlock(input.id, input.expectedEtag, input.operationId));
}
