import { resolveOwner } from '@polymate/core/identity';
import { createAuthorization } from '@polymate/core/google-auth';
import { sealBrowserBinding } from '@polymate/core/google-auth/crypto';
import { ensureUser, oauthStateStore } from '@polymate/db/google-oauth';
import { NextRequest, NextResponse } from 'next/server';
import { assertGoogleMutation, BINDING_COOKIE, cookieOptions, googleConfig, routeError } from '@/lib/google-oauth';

export async function POST(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    assertGoogleMutation(request);
    const config = googleConfig();
    await ensureUser(owner);
    const authorization = await createAuthorization({
      ownerId: owner.userId, browserBinding: '', store: oauthStateStore, config,
    });
    const response = NextResponse.json({ url: authorization.url }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(BINDING_COOKIE, sealBrowserBinding(authorization.browserBinding),
      cookieOptions(10 * 60, '/api/integrations/google/callback'));
    return response;
  } catch (error) {
    return routeError(error);
  }
}
