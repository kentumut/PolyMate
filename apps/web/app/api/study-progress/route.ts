import { resolveOwner } from '@polymate/core/identity';
import { studyProgressStore } from '@polymate/db/study-progress';
import type { NextRequest } from 'next/server';
import { progressRouteError } from '@/lib/study-progress';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    return Response.json(await studyProgressStore.state(owner.userId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return progressRouteError(error); }
}
