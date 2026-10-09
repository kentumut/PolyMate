import { parseCreateRequest, parseDateRange, type ListEventsResponse } from '@polymate/contracts/calendar';
import { resolveOwner } from '@polymate/core/identity';
import type { NextRequest } from 'next/server';
import { calendarError, calendarMutation, calendarServiceFor } from '@/lib/calendar-route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    const query = request.nextUrl.searchParams;
    const range = parseDateRange({ from: query.get('from') ?? undefined, to: query.get('to') ?? undefined });
    const events = await calendarServiceFor(owner).listWeek(range);
    return Response.json({ range, events } satisfies ListEventsResponse, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return calendarError(error);
  }
}

export function POST(request: NextRequest) {
  return calendarMutation(request, parseCreateRequest,
    (service, { block, operationId }) => service.createStudyBlock(block, operationId));
}
