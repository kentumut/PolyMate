import type { NextRequest } from 'next/server';
import { ContractError } from '@polymate/contracts/calendar';
import { parsePlanningRequest } from '@polymate/contracts/planning';
import { readBoundedText } from '@polymate/core/agent/http';
import { resolveOwner } from '@polymate/core/identity';
import { assertAssignmentMutation } from '@/lib/assignment-route';
import { calendarError } from '@/lib/calendar-route';
import { executePlanning, readPlanningState } from '@/lib/planning';

export const runtime = 'nodejs';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest): Promise<Response> {
  try { return Response.json(await readPlanningState(resolveOwner(request.headers).userId), { headers }); }
  catch (error) { return calendarError(error); }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const owner = resolveOwner(request.headers);
    assertAssignmentMutation(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ContractError('Send JSON.');
    let body: unknown;
    try { body = JSON.parse(await readBoundedText(request.body, 16_000)); }
    catch { throw new ContractError('Send valid JSON under 16 KB.'); }
    return Response.json(await executePlanning(owner, parsePlanningRequest(body)), { headers });
  } catch (error) { return calendarError(error); }
}
