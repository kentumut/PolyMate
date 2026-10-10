import type { NextRequest } from 'next/server';
import { assertSameOrigin, resolveOwner } from '@polymate/core/identity';
import { AgentRequestError, agentResponseBody, beginAgentTurn, callOpenClawAgent, endAgentTurn, scheduleCurrentPlan, publicPendingPlan } from '@/lib/agent-runtime';
import { readBoundedText } from '@polymate/core/agent/http';
import { calendarError } from '@/lib/calendar-route';
import { moodleError } from '@/lib/moodle';

export const runtime = 'nodejs';
export const maxDuration = 120;

async function readBody(request: NextRequest): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AgentRequestError('Send a JSON message.');
  if (Number(request.headers.get('content-length')) > 16_000) throw new AgentRequestError('That message is too large.');
  let raw: string;
  try { raw = await readBoundedText(request.body, 16_000); } catch { throw new AgentRequestError('That message is too large or incomplete.'); }
  try { return JSON.parse(raw) as unknown; } catch { throw new AgentRequestError('Send valid JSON.'); }
}

function agentError(error: unknown): Response {
  if (error instanceof AgentRequestError) return Response.json({ error: { message: error.message } }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  if (error instanceof SyntaxError) return Response.json({ error: { message: 'Send valid JSON.' } }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  return calendarError(error);
}

export async function POST(request: NextRequest): Promise<Response> {
  let owner: ReturnType<typeof resolveOwner>;
  try {
    owner = resolveOwner(request.headers);
    assertSameOrigin(request);
    const body = await readBody(request);
    if (body && typeof body === 'object' && !Array.isArray(body) && (body as Record<string, unknown>).action === 'schedule_current_plan') {
      const action = body as Record<string, unknown>;
      if (Object.keys(action).some(key => !['action', 'allowPartial', 'timelineId'].includes(key)) || typeof action.allowPartial !== 'boolean' || typeof action.timelineId !== 'string' || action.timelineId.length > 128) {
        throw new AgentRequestError('Choose whether to add only the blocks that fit.');
      }
      const scheduled = await scheduleCurrentPlan(request, owner, action.allowPartial, action.timelineId);
      return Response.json({ reply: scheduled.reply, cards: [scheduled.card], pendingPlan: publicPendingPlan(owner.userId), reloadCalendar: scheduled.reloadCalendar }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const { turn, message } = beginAgentTurn(request, owner, body);
    try {
      const reply = await callOpenClawAgent({ sessionKey: turn.sessionKey, message, signal: request.signal, history: turn.history, draftContext: turn.draftContext });
      return Response.json(agentResponseBody(reply, turn, owner.userId), { headers: { 'Cache-Control': 'no-store' } });
    } finally { endAgentTurn(turn.sessionKey); }
  } catch (error) {
    if (error instanceof AgentRequestError || error instanceof SyntaxError) return agentError(error);
    return moodleError(error);
  }
}
