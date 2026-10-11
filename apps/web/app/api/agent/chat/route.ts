import type { NextRequest } from 'next/server';
import { assertSameOrigin, resolveOwner } from '@polymate/core/identity';
import { AgentRequestError, agentAppContext, agentResponseBody, beginAgentTurn, endAgentTurn, scheduleCurrentPlan, publicPendingPlan, confirmCurrentProgress } from '@/lib/agent-runtime';
import { readBoundedText } from '@polymate/core/agent/http';
import { calendarError } from '@/lib/calendar-route';
import { moodleError } from '@/lib/moodle';
import { assertAgentCsrf } from '@/lib/agent-csrf';
import { logTurn, serverTimingHeader, summarizeTurn, type TurnOutcome } from '@/lib/agent-telemetry';
import { AGENT_STREAM_CONTENT_TYPE, StreamRedactor, encodeAgentEvent, wantsAgentStream, type AgentStreamEvent } from '@/lib/agent-stream';
import { runDirectChatTurn, streamDirectChatTurn } from '@/lib/direct-chat-runtime';
import { listActiveStudentMemories } from '@polymate/db/coaching';
import { listCourses } from '@polymate/db/courses';
import { appendChatMessages, chatTurnContext, ChatNotFound } from '@polymate/db/chats';
import { parseChatId } from '@polymate/contracts/chats';
import { ContractError } from '@polymate/contracts/calendar';
import { chatRouteError } from '@/lib/chats';

export const runtime = 'nodejs';
// Semester-plan improvement can run the existing bounded planner workflow before the chat resumes.
export const maxDuration = 300;

async function readBody(request: NextRequest): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AgentRequestError('Send a JSON message.');
  if (Number(request.headers.get('content-length')) > 64_000) throw new AgentRequestError('That message is too large.');
  let raw: string;
  try { raw = await readBoundedText(request.body, 64_000); } catch { throw new AgentRequestError('That message is too large or incomplete.'); }
  try { return JSON.parse(raw) as unknown; } catch { throw new AgentRequestError('Send valid JSON.'); }
}

function agentError(error: unknown): Response {
  if (error instanceof AgentRequestError) return Response.json({ error: { message: error.message } }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  if (error instanceof SyntaxError) return Response.json({ error: { message: 'Send valid JSON.' } }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  return calendarError(error);
}

type Turn = ReturnType<typeof beginAgentTurn>['turn'];
type Owner = ReturnType<typeof resolveOwner>;
const OPTIONAL_CONTEXT_TIMEOUT_MS = 1_500;

/** The persisted chat a turn belongs to. Turns without one keep the short in-memory history. */
type ChatBinding = { chatId: string; agentContext: string | null };

/** Splits the optional chat ID from the request, leaving the body each action already validates. */
function splitChatId(body: unknown): { chatId?: string; payload: unknown } {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('conversationId' in body)) return { payload: body };
  const { conversationId, ...payload } = body as Record<string, unknown>;
  try { return { chatId: parseChatId(conversationId), payload }; }
  catch (error) { throw new AgentRequestError(error instanceof ContractError ? error.message : 'Chat ID is invalid.'); }
}

/** The reply already reached the student, so a failed save is logged rather than turned into an error. */
async function saveExchange(ownerId: string, chatId: string, studentText: string, reply: string) {
  try { await appendChatMessages(ownerId, chatId, [{ role: 'user', content: studentText }, { role: 'assistant', content: reply }]); }
  catch (error) { console.error('Chat history could not be saved.', error instanceof Error ? error.name : 'unknown error'); }
}

type OptionalContextResult<T> = { available: true; value: T } | { available: false };

async function readOptionalContext<T>(load: () => Promise<T>): Promise<OptionalContextResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = { available: false } as const;
  const timeout = new Promise<typeof unavailable>(resolve => {
    timer = setTimeout(() => resolve(unavailable), OPTIONAL_CONTEXT_TIMEOUT_MS);
  });
  const read = Promise.resolve().then(load)
    .then(value => ({ available: true, value }) as const)
    .catch(() => unavailable);
  try { return await Promise.race([read, timeout]); }
  finally { clearTimeout(timer); }
}

/** Optional durable context; source failures become explicit prompt notices instead of blocking chat. */
async function persistentStudentContext(ownerId: string): Promise<string | undefined> {
  const [memories, courses] = await Promise.all([
    readOptionalContext(() => listActiveStudentMemories(ownerId)),
    readOptionalContext(() => listCourses(ownerId)),
  ]);
  const memoryContext = memories.available
    ? memories.value.map(item => `- [${item.category}] ${item.content}${item.validUntil ? ` (valid until ${item.validUntil})` : ''}`)
    : ['- [availability] Saved student memory is unavailable for this turn. Do not treat it as empty; mention the limitation when relevant.'];
  const courseContext = courses.available ? courses.value.map(course => [
    `- [course] ${course.name}; exam date ${course.examDate}; ${course.lectureHoursPerWeek} lecture hours/week; ${course.exerciseSessionCount} exercise sessions at ${course.exerciseSessionMinutes} minutes each.`,
    `  Must solve: ${course.examPrep.must.join('; ') || 'none listed'}.`,
    `  Optional: ${course.examPrep.optional.join('; ') || 'none listed'}.`,
    `  Not required: ${course.examPrep.not_required.join('; ') || 'none listed'}.`,
  ].join('\n')) : ['- [availability] Saved course data is unavailable for this turn. Do not assume the student has no courses; mention the limitation when relevant.'];
  return [...memoryContext, ...courseContext].join('\n') || undefined;
}

/** Runs one model turn, logs its latency (no content), and always releases the turn. */
async function runTurn(owner: Owner, turn: Turn, message: string, signal: AbortSignal, chat?: ChatBinding, onDelta?: (text: string) => void) {
  let outcome: TurnOutcome = 'error';
  let status: number | undefined;
  let logged = false;
  try {
    const [appContext, persistentContext] = await Promise.all([agentAppContext(owner.userId), persistentStudentContext(owner.userId)]);
    turn.telemetry.contextMs = Date.now() - turn.telemetry.startedAt;
    const context = [persistentContext, chat?.agentContext ? `- [this chat] ${chat.agentContext}` : undefined].filter(Boolean).join('\n') || undefined;
    const input = { turn, message, signal, history: turn.history, draftContext: turn.draftContext, appContext, persistentContext: context };
    let reply: string;
    if (onDelta) {
      const streamed = await streamDirectChatTurn(input);
      for await (const event of streamed) {
        if (event.type === 'raw_model_stream_event' && event.data.type === 'output_text_delta') onDelta(event.data.delta);
      }
      await streamed.completed;
      if (streamed.error) throw streamed.error;
      if (streamed.cancelled) throw new AgentRequestError('The AI assistant response was interrupted. Try again.', 503);
      if (typeof streamed.finalOutput !== 'string' || !streamed.finalOutput.trim()) {
        throw new AgentRequestError('The AI assistant returned an empty response. Try asking again.', 502);
      }
      reply = streamed.finalOutput.slice(0, 20_000);
    } else {
      reply = await runDirectChatTurn(input);
    }
    const body = agentResponseBody(reply, turn, owner.userId);
    if (chat) await saveExchange(owner.userId, chat.chatId, message, body.reply);
    outcome = 'ok';
    const summary = summarizeTurn(turn.telemetry, { endedAt: Date.now(), outcome, cards: body.cards.length });
    logTurn(summary);
    logged = true;
    return { body, timing: serverTimingHeader(summary) };
  } catch (error) {
    if (error instanceof AgentRequestError) status = error.status;
    outcome = signal.aborted ? 'aborted' : status === 504 ? 'timeout' : 'error';
    throw error;
  } finally {
    endAgentTurn(turn.sessionKey);
    if (!logged) logTurn(summarizeTurn(turn.telemetry, { endedAt: Date.now(), outcome, status, cards: turn.cards.length }));
  }
}

/**
 * NDJSON stream: `status` per tool, redacted `delta` text, then `done` with the authoritative reply and
 * cards (which replace the streamed text), or `error`. Errors before the turn starts stay plain JSON.
 */
function streamTurn(request: NextRequest, owner: Owner, turn: Turn, message: string, chat?: ChatBinding): Response {
  const cancelled = new AbortController();
  const signal = AbortSignal.any([request.signal, cancelled.signal]);
  const redactor = new StreamRedactor(turn.privateValues);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentStreamEvent) => { try { controller.enqueue(encodeAgentEvent(event)); } catch { /* client disconnected */ } };
      turn.onEvent = send;
      try {
        const { body, timing } = await runTurn(owner, turn, message, signal, chat, text => {
          const safe = redactor.push(text);
          if (safe) send({ type: 'delta', text: safe });
        });
        send({ type: 'done', ...body, timing });
      } catch (error) {
        if (!signal.aborted) {
          const response = error instanceof AgentRequestError || error instanceof SyntaxError ? agentError(error) : moodleError(error);
          const payload = await response.json().catch(() => null) as { error?: { message?: string } } | null;
          send({ type: 'error', status: response.status, error: { message: payload?.error?.message ?? 'PolyMate could not answer. Try again.' } });
        }
      } finally { try { controller.close(); } catch { /* already closed */ } }
    },
    cancel() { cancelled.abort(); },
  });
  // no-transform and X-Accel-Buffering stop proxies from buffering the stream into one response.
  return new Response(stream, { headers: { 'Content-Type': `${AGENT_STREAM_CONTENT_TYPE}; charset=utf-8`, 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}

export async function POST(request: NextRequest): Promise<Response> {
  let owner: ReturnType<typeof resolveOwner>;
  try {
    owner = resolveOwner(request.headers);
    assertSameOrigin(request);
    const { chatId, payload: body } = splitChatId(await readBody(request));
    if (body && typeof body === 'object' && !Array.isArray(body) && (body as Record<string, unknown>).action === 'confirm_progress') {
      const action = body as Record<string, unknown>;
      if (Object.keys(action).some(key => !['action', 'draftToken', 'confirmAssignmentFinished'].includes(key)) || typeof action.draftToken !== 'string' || action.draftToken.length > 12_000 || (action.confirmAssignmentFinished !== undefined && typeof action.confirmAssignmentFinished !== 'boolean')) throw new AgentRequestError('Confirm the exact progress card supplied by PolyMate.');
      assertAgentCsrf(request);
      const result = await confirmCurrentProgress(owner, action.draftToken, action.confirmAssignmentFinished === true);
      if (chatId) await saveExchange(owner.userId, chatId, 'Confirm this progress change.', result.reply);
      return Response.json({ ...result, pendingPlan: publicPendingPlan(owner.userId) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body && typeof body === 'object' && !Array.isArray(body) && (body as Record<string, unknown>).action === 'schedule_current_plan') {
      const action = body as Record<string, unknown>;
      if (Object.keys(action).some(key => !['action', 'allowPartial', 'timelineId'].includes(key)) || typeof action.allowPartial !== 'boolean' || typeof action.timelineId !== 'string' || action.timelineId.length > 128) {
        throw new AgentRequestError('Choose whether to add only the blocks that fit.');
      }
      const scheduled = await scheduleCurrentPlan(request, owner, action.allowPartial, action.timelineId);
      if (chatId) await saveExchange(owner.userId, chatId, action.allowPartial ? 'Add only the blocks that fit to my calendar.' : 'Add this timeline to my calendar.', scheduled.reply);
      return Response.json({ reply: scheduled.reply, cards: [scheduled.card], pendingPlan: publicPendingPlan(owner.userId), reloadCalendar: scheduled.reloadCalendar }, { headers: { 'Cache-Control': 'no-store' } });
    }
    // Stored chats carry their own history, so PolyMate's opening question is in context when the student replies.
    const stored = chatId ? await chatTurnContext(owner, chatId, typeof (body as { message?: unknown } | null)?.message === 'string' ? (body as { message: string }).message : '') : undefined;
    const { turn, message } = beginAgentTurn(request, owner, body);
    const chat = chatId && stored ? { chatId, agentContext: stored.agentContext } : undefined;
    if (stored) turn.history = stored.history;
    if (wantsAgentStream(request.headers.get('accept'))) return streamTurn(request, owner, turn, message, chat);
    const { body: responseBody, timing } = await runTurn(owner, turn, message, request.signal, chat);
    return Response.json(responseBody, { headers: { 'Cache-Control': 'no-store', 'Server-Timing': timing } });
  } catch (error) {
    if (error instanceof AgentRequestError || error instanceof SyntaxError) return agentError(error);
    if (error instanceof ChatNotFound) return chatRouteError(error);
    return moodleError(error);
  }
}
