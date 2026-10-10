import { resolveOwner } from '@polymate/core/identity';
import { randomToken } from '@polymate/core/google-auth/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { assignmentRouteError, setAssignmentCsrfCookie } from '@/lib/assignment-route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    resolveOwner(request.headers);
    const token = randomToken();
    const response = NextResponse.json({ csrfToken: token }, { headers: { 'Cache-Control': 'no-store' } });
    setAssignmentCsrfCookie(response, token);
    return response;
  } catch (error) { return assignmentRouteError(error); }
}
