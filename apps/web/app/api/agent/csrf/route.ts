import { resolveOwner } from '@polymate/core/identity';
import { randomToken } from '@polymate/core/google-auth/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { calendarError } from '@/lib/calendar-route';
import { setAgentCsrfCookie } from '@/lib/agent-csrf';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  try {
    resolveOwner(request.headers);
    const token = randomToken();
    const response = NextResponse.json({ csrfToken: token }, { headers: { 'Cache-Control': 'no-store' } });
    setAgentCsrfCookie(response, token);
    return response;
  } catch (error) { return calendarError(error); }
}
