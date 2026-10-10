import type { NextRequest } from 'next/server';
import { parseCoachingMutation } from '@polymate/contracts/coaching';
import { assertSameOrigin, resolveOwner } from '@polymate/core/identity';
import { coachingState, forgetStudentMemory, respondToCoachMessage } from '@polymate/db/coaching';
import { coachingRouteError } from '@/lib/coaching-route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    return Response.json(await coachingState(owner), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return coachingRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    assertSameOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new SyntaxError('Send JSON.');
    const mutation = parseCoachingMutation(await request.json());
    if (mutation.action === 'respond') await respondToCoachMessage(owner, mutation.messageId, mutation.response);
    else await forgetStudentMemory(owner.userId, mutation.memoryId);
    return Response.json(await coachingState(owner), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return coachingRouteError(error); }
}
