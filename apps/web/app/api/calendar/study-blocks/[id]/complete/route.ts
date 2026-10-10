import { parseActionRequest } from '@polymate/contracts/calendar';
import type { NextRequest } from 'next/server';
import { calendarMutation } from '@/lib/calendar-route';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return calendarMutation(request, parseActionRequest,
    (service, { expectedEtag, operationId }) => service.completeStudyBlock(id, expectedEtag, operationId));
}
