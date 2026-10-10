import { resolveOwner } from '@polymate/core/identity';
import { listStudyActivity } from '@polymate/db/study-progress';
import { ContractError } from '@polymate/contracts/calendar';
import type { NextRequest } from 'next/server';
import { progressRouteError } from '@/lib/study-progress';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    const after = request.nextUrl.searchParams.get('after') ?? '0';
    if (!/^\d{1,19}$/.test(after) || BigInt(after) > 9223372036854775807n) throw new ContractError('Invalid activity cursor.');
    const events = await listStudyActivity(owner.userId, after);
    return Response.json({ events, nextCursor: events.at(-1)?.id ?? after }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return progressRouteError(error); }
}
