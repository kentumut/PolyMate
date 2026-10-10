import { resolveOwner } from '@polymate/core/identity';
import { verifyGoogleCalendarAccess } from '@polymate/core/google-auth';
import { randomToken } from '@polymate/core/google-auth/crypto';
import { getConnectionStatus, getValidAccessToken } from '@polymate/db/google-oauth';
import { NextRequest, NextResponse } from 'next/server';
import { googleConfig, routeError, setCsrfCookie } from '@/lib/google-oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    const enabled = process.env.GOOGLE_ENABLED === 'true';
    if (enabled) googleConfig();
    const stored = enabled ? await getConnectionStatus(owner.userId) : { connected: false };
    let status: { connected: boolean; issue?: 'needs_reconnect' } = stored;
    if (stored.connected) {
      try {
        await verifyGoogleCalendarAccess({ accessToken: () => getValidAccessToken(owner) });
      } catch {
        status = { connected: false, issue: 'needs_reconnect' };
      }
    }
    const csrfToken = randomToken();
    const response = NextResponse.json({ ...status, enabled, csrfToken }, { headers: { 'Cache-Control': 'no-store' } });
    setCsrfCookie(response, csrfToken);
    return response;
  } catch (error) {
    return routeError(error);
  }
}
