import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import type { ChatSummary } from '@polymate/contracts/chats';
import type { CheckInSnapshot } from '../packages/core/checkins/rules';

const mocks = vi.hoisted(() => {
  class ChatNotFound extends Error { constructor() { super('This chat no longer exists.'); this.name = 'ChatNotFound'; } }
  return {
    ChatNotFound, callAgent: vi.fn(), appContext: vi.fn(), ensureUser: vi.fn(), snapshot: vi.fn(), open: vi.fn(), recordDelivery: vi.fn(),
    listChats: vi.fn(), getChat: vi.fn(), markChatRead: vi.fn(), setCheckInsPaused: vi.fn(), checkInsPaused: vi.fn(), listCheckInOwnerIds: vi.fn(),
    chatTurnContext: vi.fn(), appendChatMessages: vi.fn(), memories: vi.fn(), courses: vi.fn(),
  };
});
vi.mock('../packages/db/src/chats', () => ({
  ChatNotFound: mocks.ChatNotFound, checkInStore: { snapshot: mocks.snapshot, open: mocks.open, recordDelivery: mocks.recordDelivery },
  listChats: mocks.listChats, getChat: mocks.getChat, markChatRead: mocks.markChatRead, setCheckInsPaused: mocks.setCheckInsPaused, checkInsPaused: mocks.checkInsPaused,
  listCheckInOwnerIds: mocks.listCheckInOwnerIds, chatTurnContext: mocks.chatTurnContext, appendChatMessages: mocks.appendChatMessages,
}));
vi.mock('../packages/db/src/google-oauth', () => ({ ensureUser: mocks.ensureUser, getConnectionStatus: vi.fn() }));
vi.mock('../packages/db/src/coaching', () => ({ listActiveStudentMemories: mocks.memories, rememberStudentContext: vi.fn() }));
vi.mock('../packages/db/src/courses', () => ({ listCourses: mocks.courses }));
vi.mock('../packages/db/src/study-progress', () => ({ studyProgressStore: {}, syncStudyCalendarRead: vi.fn(), observeStudyCalendarChange: vi.fn() }));
vi.mock('../packages/db/src/agent-automations', () => ({ findAutomationForGatewayJob: vi.fn() }));
vi.mock('../apps/web/lib/moodle', () => ({ executeMoodleTool: vi.fn(), moodleConnectionAvailable: vi.fn(), calendarSnapshotForOwner: vi.fn(), moodleError: () => Response.json({ error: { message: 'Unavailable.' } }, { status: 500 }) }));
vi.mock('../apps/web/lib/agent-runtime', async original => ({ ...await original<typeof import('../apps/web/lib/agent-runtime')>(), callOpenClawAgent: mocks.callAgent, agentAppContext: mocks.appContext }));

import { GET as listRoute, POST as mutateRoute } from '../apps/web/app/api/chats/route';
import { GET as threadRoute } from '../apps/web/app/api/chats/[id]/route';
import { POST as tick } from '../apps/web/app/api/internal/check-ins/tick/route';
import { POST as chat } from '../apps/web/app/api/agent/chat/route';
import { resolveOwner } from '../packages/core/src/identity';
import { fetchChat, fetchChats, mutateChats, unreadCheckIns } from '../apps/web/components/agent/chat-client';

const origin = 'https://polymate.test';
const headers = { 'x-user-id': 'student@example.test', origin, 'content-type': 'application/json' };
const owner = resolveOwner(new Headers(headers), { AUTH_MODE: 'managed-proxy', MANAGED_PROXY_ONLY: 'true' });
const chatId = '00000000-0000-4000-8000-0000000000c1';
const tickSecret = 'tick-test-secret-with-at-least-32-bytes';
const summary: ChatSummary = { id: chatId, origin: 'check_in', checkInKind: 'general', title: 'How is studying going?', preview: 'How is studying going this week?', unread: true, quickReplies: ['Going well'], createdAt: '2026-10-10T13:00:00.000Z', updatedAt: '2026-10-10T13:00:00.000Z' };
const quiet: CheckInSnapshot = { assignments: [], links: [], reports: [], courses: [], prior: [], lastStudentMessageAt: null, paused: false };
const get = (path: string, changes: Record<string, string> = {}) => new NextRequest(`${origin}${path}`, { headers: { ...headers, ...changes } });
const post = (path: string, body: unknown, changes: Record<string, string> = {}) => new NextRequest(`${origin}${path}`, { method: 'POST', headers: { ...headers, ...changes }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as typeof globalThis & { __polymateAgentRuntime?: unknown }).__polymateAgentRuntime;
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-10T13:00:00Z'));
  vi.stubEnv('AUTH_MODE', 'managed-proxy'); vi.stubEnv('MANAGED_PROXY_ONLY', 'true'); vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('AGENT_CONTEXT_SECRET', 'context-test-secret-with-at-least-32-bytes');
  vi.stubEnv('CHECK_IN_TICK_SECRET', tickSecret);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.snapshot.mockResolvedValue(quiet);
  mocks.open.mockResolvedValue(chatId);
  mocks.listChats.mockResolvedValue([summary]);
  mocks.checkInsPaused.mockResolvedValue(false);
  mocks.memories.mockResolvedValue([]); mocks.courses.mockResolvedValue([]);
  mocks.appContext.mockResolvedValue(undefined);
  mocks.callAgent.mockResolvedValue('Glad to hear it.');
  mocks.chatTurnContext.mockResolvedValue({ history: [{ role: 'assistant', content: 'How is studying going this week?' }], agentContext: 'PolyMate opened this chat with a general check-in.' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('chat list API', () => {
  it('opens a due check-in while listing chats, for the signed-in student only', async () => {
    const response = await listRoute(get('/api/chats'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ chats: [summary], checkInsPaused: false });
    expect(mocks.ensureUser).toHaveBeenCalledWith(owner);
    expect(mocks.open).toHaveBeenCalledWith(owner.userId, expect.objectContaining({ kind: 'general', dedupeKey: 'general:2026-10-10' }));
    expect(mocks.recordDelivery).toHaveBeenCalledWith(owner.userId, chatId, 'web', { status: 'sent' });
    expect(mocks.listChats).toHaveBeenCalledWith(owner.userId);
  });

  it('still lists chats when the check-in run fails, and requires an identity', async () => {
    mocks.snapshot.mockRejectedValue(new Error('database timeout'));
    expect(await (await listRoute(get('/api/chats'))).json()).toEqual({ chats: [summary], checkInsPaused: false });
    expect(mocks.open).not.toHaveBeenCalled();
    expect((await listRoute(get('/api/chats', { 'x-user-id': '' }))).status).toBe(401);
  });

  it('opens nothing while check-ins are paused', async () => {
    mocks.snapshot.mockResolvedValue({ ...quiet, paused: true });
    mocks.checkInsPaused.mockResolvedValue(true);
    expect(await (await listRoute(get('/api/chats'))).json()).toMatchObject({ checkInsPaused: true });
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it('marks a chat read and pauses check-ins from the application origin only', async () => {
    expect((await mutateRoute(post('/api/chats', { action: 'read', chatId }))).status).toBe(200);
    expect(mocks.markChatRead).toHaveBeenCalledWith(owner.userId, chatId);
    expect((await mutateRoute(post('/api/chats', { action: 'pause_check_ins', paused: true }))).status).toBe(200);
    expect(mocks.setCheckInsPaused).toHaveBeenCalledWith(owner, true);
    expect((await mutateRoute(post('/api/chats', { action: 'read', chatId }, { origin: 'https://attacker.example' }))).status).toBe(403);
    expect((await mutateRoute(post('/api/chats', { action: 'read', chatId, ownerId: chatId }))).status).toBe(422);
    expect((await mutateRoute(post('/api/chats', { action: 'delete_everything' }))).status).toBe(422);
    expect(mocks.markChatRead).toHaveBeenCalledTimes(1);
  });

  it('checks in on request even when paused and outside the usual limits', async () => {
    vi.setSystemTime(new Date('2026-10-10T21:30:00Z'));
    mocks.snapshot.mockResolvedValue({ ...quiet, paused: true, prior: [{ dedupeKey: 'general:2026-10-10', kind: 'general', createdAt: '2026-10-10T21:00:00Z' }] });
    const response = await mutateRoute(post('/api/chats', { action: 'check_in_now' }));
    expect(await response.json()).toMatchObject({ openedChatId: chatId });
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.open.mock.calls[0][1].dedupeKey).toMatch(/^general:2026-10-10:asked:/);
  });

  it('returns one chat thread and hides chats that are missing or belong to someone else', async () => {
    mocks.getChat.mockResolvedValue({ chat: summary, messages: [{ id: '1', role: 'assistant', content: summary.preview, createdAt: summary.createdAt }] });
    const response = await threadRoute(get(`/api/chats/${chatId}`), params(chatId));
    expect((await response.json()).messages).toHaveLength(1);
    expect(mocks.getChat).toHaveBeenCalledWith(owner.userId, chatId);
    mocks.getChat.mockRejectedValue(new mocks.ChatNotFound());
    expect((await threadRoute(get(`/api/chats/${chatId}`), params(chatId))).status).toBe(404);
    expect((await threadRoute(get('/api/chats/nope'), params('nope'))).status).toBe(422);
  });
});

describe('check-in timer API', () => {
  const run = (authorization?: string) => tick(new NextRequest(`${origin}/api/internal/check-ins/tick`, { method: 'POST', headers: authorization ? { authorization } : {} }));

  it('checks in with every student and survives one student failing', async () => {
    mocks.listCheckInOwnerIds.mockResolvedValue(['owner-a', 'owner-b', 'owner-c']);
    mocks.snapshot.mockImplementation(async (ownerId: string) => { if (ownerId === 'owner-b') throw new Error('timeout'); return quiet; });
    const response = await run(`Bearer ${tickSecret}`);
    expect(await response.json()).toEqual({ students: 3, opened: 2, failed: 1 });
    expect(mocks.open.mock.calls.map(call => call[0])).toEqual(['owner-a', 'owner-c']);
  });

  it('rejects a missing or wrong secret, and stays off when unconfigured', async () => {
    expect((await run()).status).toBe(401);
    expect((await run('Bearer wrong-secret-with-at-least-32-bytes-xx')).status).toBe(401);
    expect((await run(`Bearer ${tickSecret}`, )).status).toBe(200);
    vi.stubEnv('CHECK_IN_TICK_SECRET', 'short');
    expect((await run('Bearer short')).status).toBe(503);
    expect(mocks.listCheckInOwnerIds).toHaveBeenCalledTimes(1);
  });
});

describe('chat turns in a stored chat', () => {
  it('answers with the stored history and check-in context, then saves the exchange', async () => {
    const response = await chat(post('/api/agent/chat', { message: 'Going well', conversationId: chatId }));
    expect(response.status).toBe(200);
    expect((await response.json()).reply).toBe('Glad to hear it.');
    expect(mocks.chatTurnContext).toHaveBeenCalledWith(owner, chatId, 'Going well');
    expect(mocks.callAgent).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Going well', history: [{ role: 'assistant', content: 'How is studying going this week?' }],
      persistentContext: '- [this chat] PolyMate opened this chat with a general check-in.',
    }));
    expect(mocks.appendChatMessages).toHaveBeenCalledWith(owner.userId, chatId, [{ role: 'user', content: 'Going well' }, { role: 'assistant', content: 'Glad to hear it.' }]);
  });

  it('keeps answering when saving fails, and saves nothing when the agent fails', async () => {
    mocks.appendChatMessages.mockRejectedValueOnce(new Error('database timeout'));
    expect((await chat(post('/api/agent/chat', { message: 'Going well', conversationId: chatId }))).status).toBe(200);
    mocks.appendChatMessages.mockClear();
    mocks.callAgent.mockRejectedValueOnce(new Error('gateway down'));
    expect((await chat(post('/api/agent/chat', { message: 'Again', conversationId: chatId }))).status).toBeGreaterThanOrEqual(500);
    expect(mocks.appendChatMessages).not.toHaveBeenCalled();
    // The failed turn was released, so the next message is accepted.
    expect((await chat(post('/api/agent/chat', { message: 'Once more', conversationId: chatId }))).status).toBe(200);
  });

  it('rejects a chat that belongs to someone else or an invalid chat ID before calling the agent', async () => {
    mocks.chatTurnContext.mockRejectedValueOnce(new mocks.ChatNotFound());
    expect((await chat(post('/api/agent/chat', { message: 'Hello', conversationId: chatId }))).status).toBe(404);
    expect((await chat(post('/api/agent/chat', { message: 'Hello', conversationId: 'nope' }))).status).toBe(422);
    expect(mocks.callAgent).not.toHaveBeenCalled();
  });

  it('leaves turns without a chat ID unchanged', async () => {
    expect((await chat(post('/api/agent/chat', { message: 'Hello' }))).status).toBe(200);
    expect(mocks.chatTurnContext).not.toHaveBeenCalled();
    expect(mocks.appendChatMessages).not.toHaveBeenCalled();
    expect(mocks.callAgent).toHaveBeenCalledWith(expect.objectContaining({ history: [], persistentContext: undefined }));
  });
});

describe('chat client', () => {
  const respond = (body: unknown, status = 200) => vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;

  it('loads chats and threads and sends actions as JSON', async () => {
    const list = respond({ chats: [summary], checkInsPaused: false });
    expect((await fetchChats(list)).chats).toEqual([summary]);
    expect(list).toHaveBeenCalledWith('/api/chats', expect.objectContaining({ cache: 'no-store' }));
    const thread = respond({ chat: summary, messages: [] });
    await fetchChat(chatId, thread);
    expect(thread).toHaveBeenCalledWith(`/api/chats/${chatId}`, expect.anything());
    const action = respond({ chats: [], checkInsPaused: true });
    expect((await mutateChats({ action: 'pause_check_ins', paused: true }, action)).checkInsPaused).toBe(true);
    expect(action).toHaveBeenCalledWith('/api/chats', expect.objectContaining({ method: 'POST', body: '{"action":"pause_check_ins","paused":true}' }));
  });

  it('surfaces the server message on failure', async () => {
    await expect(fetchChat(chatId, respond({ error: { message: 'This chat no longer exists.' } }, 404))).rejects.toThrow('This chat no longer exists.');
    await expect(fetchChats(vi.fn(async () => new Response('gateway', { status: 502 })) as unknown as typeof fetch)).rejects.toThrow('Chats could not be loaded.');
  });

  it('counts only unopened chats PolyMate started, excluding the open one', () => {
    const student = { ...summary, id: '00000000-0000-4000-8000-0000000000c2', origin: 'student' as const, unread: false };
    const read = { ...summary, id: '00000000-0000-4000-8000-0000000000c3', unread: false };
    expect(unreadCheckIns([summary, student, read])).toEqual([summary]);
    expect(unreadCheckIns([summary, student, read], chatId)).toEqual([]);
  });
});
