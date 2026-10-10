import type { NextRequest } from 'next/server';
import { parseOnboardingProfile } from '@polymate/contracts/onboarding';
import { assertSameOrigin, resolveOwner } from '@polymate/core/identity';
import { completeOnboarding, getOnboardingState } from '@polymate/db/onboarding';
import { coachingRouteError } from '@/lib/coaching-route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    return Response.json(await getOnboardingState(resolveOwner(request.headers)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return coachingRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    assertSameOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new SyntaxError('Send JSON.');
    const profile = parseOnboardingProfile(await request.json());
    return Response.json(await completeOnboarding(owner, profile), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return coachingRouteError(error); }
}
