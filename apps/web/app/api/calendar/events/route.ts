import { parseCreateRequest, parseDateRange, type ListEventsResponse } from '@polymate/contracts/calendar';
import { resolveOwner } from '@polymate/core/identity';
import type { NextRequest } from 'next/server';
import { calendarError, calendarMutation, calendarServiceFor } from '@/lib/calendar-route';
import { syncStudyCalendarRead } from '@polymate/db/study-progress';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    const query = request.nextUrl.searchParams;
    const range = parseDateRange({ from: query.get('from') ?? undefined, to: query.get('to') ?? undefined });
    const observedAt = new Date();
    const events = await calendarServiceFor(owner).listWeek(range);
    // Progress metadata is secondary: a sync failure must not hide events Google already returned.
    try { await syncStudyCalendarRead(owner.userId, events, observedAt); }
    catch (error) { console.error('Study progress calendar sync failed.', error instanceof Error ? error.message : 'unknown error'); }
    return Response.json({ range, events } satisfies ListEventsResponse, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return calendarError(error);
  }
}

export function POST(request: NextRequest) {
  return calendarMutation(request, parseCreateRequest,
    (service, { block, operationId }) => service.createStudyBlock(block, operationId));
}
