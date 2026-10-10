import { assertSameOrigin, IdentityError } from '@polymate/core/identity';
import { constantTimeEqual } from '@polymate/core/google-auth/crypto';
import type { NextRequest, NextResponse } from 'next/server';

export const BINDING_COOKIE = 'polymate_google_binding';
const CSRF_COOKIE = 'polymate_google_csrf';

export function googleConfig() {
  const origin = process.env.APP_ORIGIN ?? (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:3000' : undefined);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (process.env.GOOGLE_ENABLED !== 'true' || !origin || !clientId || !clientSecret ||
      redirectUri !== `${origin}/api/integrations/google/callback`) {
    throw new IdentityError('Google Calendar connection is unavailable.', 503);
  }
  return { origin, clientId, clientSecret, redirectUri };
}

export function cookieOptions(maxAge: number, path: string) {
  return { httpOnly: true, secure: process.env.NODE_ENV !== 'development', sameSite: 'lax' as const, path, maxAge };
}

export function setCsrfCookie(response: NextResponse, token: string): void {
  response.cookies.set(CSRF_COOKIE, token, cookieOptions(2 * 60 * 60, '/api/integrations/google'));
}

export function assertGoogleMutation(request: NextRequest): void {
  assertSameOrigin(request);
  const cookie = request.cookies.get(CSRF_COOKIE)?.value;
  const supplied = request.headers.get('x-csrf-token');
  if (!cookie || !supplied || !constantTimeEqual(cookie, supplied)) {
    throw new IdentityError('Invalid connection request.', 403);
  }
}

export function routeError(error: unknown): Response {
  // Matched by name so this module stays free of database imports.
  if (error instanceof Error && error.name === 'CalendarHomeInUseError') {
    return Response.json({ error: { code: 'calendar_home_in_use', message: error.message } }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
  }
  const status = error instanceof IdentityError ? error.status : 500;
  const message = error instanceof IdentityError ? error.message : 'Google Calendar request failed.';
  return Response.json({ error: { message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
