import { resolveOwner } from '@polymate/core/identity';
import { disconnectGoogle } from '@polymate/db/google-oauth';
import { NextRequest, NextResponse } from 'next/server';
import { assertGoogleMutation, routeError } from '@/lib/google-oauth';

export async function POST(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    assertGoogleMutation(request);
    await disconnectGoogle(owner.userId);
    return NextResponse.json({ connected: false }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return routeError(error);
  }
}
