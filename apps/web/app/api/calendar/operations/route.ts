import { resolveOwner } from '@polymate/core/identity';
import { listUnresolvedCalendarOperations } from '@polymate/db/calendar-operations';
import type { NextRequest } from 'next/server';
import { calendarError } from '@/lib/calendar-route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    const operations = await listUnresolvedCalendarOperations(owner.userId);
    return Response.json({ operations }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return calendarError(error);
  }
}
