import { resolveOwner } from '@polymate/core/identity';
import { consumeCallbackState, exchangeAuthorizationCode, verifyGoogleCalendarAccess } from '@polymate/core/google-auth';
import { openBrowserBinding } from '@polymate/core/google-auth/crypto';
import { oauthStateStore, saveConnection } from '@polymate/db/google-oauth';
import { NextRequest, NextResponse } from 'next/server';
import { BINDING_COOKIE, cookieOptions, googleConfig } from '@/lib/google-oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const origin = process.env.APP_ORIGIN ?? (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:3000' : undefined);
  if (!origin) return Response.json({ error: { message: 'Application origin is not configured.' } }, { status: 503 });
  let outcome = 'error';
  try {
    const owner = resolveOwner(request.headers);
    const config = googleConfig();
    const query = request.nextUrl.searchParams;
    if (query.has('error')) {
      outcome = 'denied';
    } else {
      const code = query.get('code');
      const state = query.get('state');
      const binding = openBrowserBinding(request.cookies.get(BINDING_COOKIE)?.value ?? '');
      if (!code || !state || !binding) throw new Error('Invalid Google callback.');
      const stateOwner = await consumeCallbackState({ state, browserBinding: binding, store: oauthStateStore });
      if (stateOwner !== owner.userId) throw new Error('Google callback owner mismatch.');
      const tokens = await exchangeAuthorizationCode({ code, clientId: config.clientId,
        clientSecret: config.clientSecret, redirectUri: config.redirectUri });
      await verifyGoogleCalendarAccess({ accessToken: async () => tokens.accessToken });
      await saveConnection(owner.userId, tokens);
      outcome = 'connected';
    }
  } catch {
    // The browser gets a generic result. Codes, state, and credentials stay out of logs and URLs.
  }
  const response = NextResponse.redirect(new URL(`/calendar?view=settings&google=${outcome}`, origin), { status: 303 });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.cookies.set(BINDING_COOKIE, '', cookieOptions(0, '/api/integrations/google/callback'));
  return response;
}
