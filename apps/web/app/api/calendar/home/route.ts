import type { NextRequest } from 'next/server';
import { ContractError } from '@polymate/contracts/calendar';
import { parseCalendarHome } from '@polymate/core/calendar/home';
import { resolveOwner } from '@polymate/core/identity';
import { AgentRequestError, withExclusiveCalendarAction } from '@/lib/agent-runtime';
import { assertCalendarMutation, calendarError, calendarHomeFor, previewCalendarHome, switchCalendarHome } from '@/lib/calendar-route';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    const { home, connected } = await calendarHomeFor(owner.userId);
    return Response.json({ home, googleEnabled: process.env.GOOGLE_ENABLED === 'true', googleConnected: connected }, { headers: NO_STORE });
  } catch (error) {
    return calendarError(error);
  }
}

/** `{ home }` previews how many upcoming blocks would move; `{ home, confirm: true }` moves them. */
export async function POST(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    assertCalendarMutation(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ContractError('Send JSON.');
    const body = await request.json().catch(() => { throw new ContractError('Request body is not valid JSON.'); }) as unknown;
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => key !== 'home' && key !== 'confirm')) throw new ContractError('Send only home and confirm.');
    const { home: value, confirm } = body as { home?: unknown; confirm?: unknown };
    const home = parseCalendarHome(value);
    if (confirm !== undefined && typeof confirm !== 'boolean') throw new ContractError('confirm must be true or false.');
    if (!confirm) return Response.json(await previewCalendarHome(owner, home), { headers: NO_STORE });
    const result = await withExclusiveCalendarAction(owner.userId, () => switchCalendarHome(owner, home));
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof AgentRequestError) return Response.json({ error: { code: 'busy', message: error.message } }, { status: error.status, headers: NO_STORE });
    return calendarError(error);
  }
}
