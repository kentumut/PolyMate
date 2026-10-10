import { constantTimeEqual } from '@polymate/core/google-auth/crypto';
import { IdentityError } from '@polymate/core/identity';
import type { NextRequest, NextResponse } from 'next/server';

const COOKIE = 'polymate_agent_csrf';

export function setAgentCsrfCookie(response: NextResponse, token: string) {
  response.cookies.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV !== 'development', sameSite: 'strict', path: '/api/agent', maxAge: 8 * 60 * 60 });
}

/** Double-submit check for agent actions that write, such as confirming a progress card. */
export function assertAgentCsrf(request: NextRequest) {
  const cookie = request.cookies.get(COOKIE)?.value;
  const token = request.headers.get('x-csrf-token');
  if (!cookie || !token || !constantTimeEqual(cookie, token)) throw new IdentityError('Chat session expired. Refresh and retry.', 403);
}
