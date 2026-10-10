import type { NextRequest } from 'next/server';
import { constantTimeEqual } from '@polymate/core/google-auth/crypto';
import { listCheckInOwnerIds } from '@polymate/db/chats';
import { runCheckInsFor } from '@/lib/chats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Opens due check-ins for every student, so questions arrive while the app is closed. Called by a
 * timer on the host with CHECK_IN_TICK_SECRET; it is not reachable with a student's identity.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const secret = process.env.CHECK_IN_TICK_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) return Response.json({ error: { message: 'Check-in timer is not configured.' } }, { status: 503, headers: NO_STORE });
  const supplied = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!supplied || !constantTimeEqual(supplied, secret)) return Response.json({ error: { message: 'Not authorized.' } }, { status: 401, headers: NO_STORE });
  const now = new Date();
  let opened = 0, failed = 0;
  const owners = await listCheckInOwnerIds();
  for (const ownerId of owners) {
    try { opened += (await runCheckInsFor(ownerId, now)).length; }
    catch (error) { failed += 1; console.error('Check-in run failed.', error instanceof Error ? error.name : 'unknown error'); }
  }
  return Response.json({ students: owners.length, opened, failed }, { headers: NO_STORE });
}
