import { randomToken } from '@polymate/core/google-auth/crypto';
import { resolveOwner } from '@polymate/core/identity';
import { NextRequest, NextResponse } from 'next/server';
import { calendarError, setCalendarCsrfCookie } from '@/lib/calendar-route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    resolveOwner(request.headers);
    const csrfToken = randomToken();
    const response = NextResponse.json({ csrfToken }, { headers: { 'Cache-Control': 'no-store' } });
    setCalendarCsrfCookie(response, csrfToken);
    return response;
  } catch (error) {
    return calendarError(error);
  }
}
