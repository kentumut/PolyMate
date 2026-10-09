import { resolveOwner } from '@polymate/core/identity';
import { randomToken } from '@polymate/core/google-auth/crypto';
import { getConnectionStatus } from '@polymate/db/google-oauth';
import { NextRequest, NextResponse } from 'next/server';
import { googleConfig, routeError, setCsrfCookie } from '@/lib/google-oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    const enabled = process.env.GOOGLE_ENABLED === 'true';
    if (enabled) googleConfig();
    const status = enabled ? await getConnectionStatus(owner.userId) : { connected: false };
    const csrfToken = randomToken();
    const response = NextResponse.json({ ...status, enabled, csrfToken }, { headers: { 'Cache-Control': 'no-store' } });
    setCsrfCookie(response, csrfToken);
    return response;
  } catch (error) {
    return routeError(error);
  }
}
