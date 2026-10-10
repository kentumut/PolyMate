import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import type { OnboardingProfile } from '../packages/contracts/src/onboarding';

const mocks = vi.hoisted(() => ({
  onboarding: { completed: false, profile: null as OnboardingProfile | null },
  memories: [] as Array<{ id: string; category: 'goal' | 'preference'; content: string; validUntil: null; createdAt: string }>,
  getOnboarding: vi.fn(), completeOnboarding: vi.fn(),
  consumeState: vi.fn(), exchangeCode: vi.fn(), verifyCalendar: vi.fn(), saveConnection: vi.fn(), connectionStatus: vi.fn(), validToken: vi.fn(),
  callAgent: vi.fn(), appContext: vi.fn(), chatContext: vi.fn(), appendMessages: vi.fn(), listMemories: vi.fn(), listCourses: vi.fn(),
}));

vi.mock('../packages/db/src/onboarding', () => ({ getOnboardingState: mocks.getOnboarding, completeOnboarding: mocks.completeOnboarding }));
vi.mock('../packages/core/integrations/google-auth/oauth', () => ({
  consumeCallbackState: mocks.consumeState, exchangeAuthorizationCode: mocks.exchangeCode, verifyGoogleCalendarAccess: mocks.verifyCalendar,
}));
vi.mock('../packages/core/integrations/google-auth/crypto', () => ({
  openBrowserBinding: () => 'browser-binding', randomToken: () => 'csrf-token', constantTimeEqual: (left: string, right: string) => left === right,
}));
vi.mock('../packages/db/src/google-oauth', () => ({
  oauthStateStore: {}, ensureUser: vi.fn(), saveConnection: mocks.saveConnection, getConnectionStatus: mocks.connectionStatus, getValidAccessToken: mocks.validToken,
}));
vi.mock('../packages/db/src/chats', () => {
  class ChatNotFound extends Error {}
  return { ChatNotFound, chatTurnContext: mocks.chatContext, appendChatMessages: mocks.appendMessages };
});
vi.mock('../packages/db/src/coaching', () => ({ listActiveStudentMemories: mocks.listMemories, rememberStudentContext: vi.fn() }));
vi.mock('../packages/db/src/courses', () => ({ listCourses: mocks.listCourses }));
vi.mock('../packages/db/src/study-progress', () => ({ studyProgressStore: {}, syncStudyCalendarRead: vi.fn(), observeStudyCalendarChange: vi.fn() }));
vi.mock('../packages/db/src/agent-automations', () => ({ findAutomationForGatewayJob: vi.fn() }));
vi.mock('../apps/web/lib/moodle', () => ({
  executeMoodleTool: vi.fn(), moodleConnectionAvailable: vi.fn(), calendarSnapshotForOwner: vi.fn(),
  moodleError: () => Response.json({ error: { message: 'Unavailable.' } }, { status: 500 }),
}));
vi.mock('../apps/web/lib/agent-runtime', async original => ({
  ...await original<typeof import('../apps/web/lib/agent-runtime')>(), agentAppContext: mocks.appContext,
}));
vi.mock('../apps/web/lib/direct-chat-runtime', () => ({ runDirectChatTurn: mocks.callAgent, streamDirectChatTurn: vi.fn() }));

import { GET as getOnboarding, POST as saveOnboarding } from '../apps/web/app/api/onboarding/route';
import { GET as googleCallback } from '../apps/web/app/api/integrations/google/callback/route';
import { GET as googleStatus } from '../apps/web/app/api/integrations/google/status/route';
import { POST as sendMessage } from '../apps/web/app/api/agent/chat/route';
import { resolveOwner } from '../packages/core/src/identity';

const origin = 'https://polymate.test';
const headers = { 'x-user-id': 'first.student@example.test', 'x-user-name': 'First Student', origin, 'content-type': 'application/json' };
const owner = resolveOwner(new Headers(headers), { AUTH_MODE: 'managed-proxy', MANAGED_PROXY_ONLY: 'true' });
const conversationId = '00000000-0000-4000-8000-0000000000f1';
const request = (path: string, init: RequestInit = {}) => new NextRequest(`${origin}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });

beforeEach(() => {
  delete (globalThis as typeof globalThis & { __polymateAgentRuntime?: unknown }).__polymateAgentRuntime;
  vi.clearAllMocks();
  mocks.onboarding.completed = false; mocks.onboarding.profile = null; mocks.memories.length = 0;
  vi.stubEnv('AUTH_MODE', 'managed-proxy'); vi.stubEnv('MANAGED_PROXY_ONLY', 'true'); vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('GOOGLE_ENABLED', 'true'); vi.stubEnv('GOOGLE_CLIENT_ID', 'google-client'); vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-secret');
  vi.stubEnv('GOOGLE_REDIRECT_URI', `${origin}/api/integrations/google/callback`); vi.stubEnv('AGENT_CONTEXT_SECRET', 'context-test-secret-with-at-least-32-bytes');
  mocks.getOnboarding.mockImplementation(async () => ({ completed: mocks.onboarding.completed, profile: mocks.onboarding.profile }));
  mocks.completeOnboarding.mockImplementation(async (_owner, profile: OnboardingProfile) => {
    mocks.onboarding.completed = true; mocks.onboarding.profile = profile;
    mocks.memories.push(
      { id: 'goal', category: 'goal', content: 'Primary study goal: finish urgent work.', validUntil: null, createdAt: '2026-10-10T12:00:00Z' },
      { id: 'focus', category: 'preference', content: 'Preferred focus session length: 50 minutes.', validUntil: null, createdAt: '2026-10-10T12:00:00Z' },
    );
    return { completed: true, profile };
  });
  mocks.consumeState.mockResolvedValue(owner.userId);
  mocks.exchangeCode.mockResolvedValue({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: new Date('2026-10-10T13:00:00Z'), scopes: ['calendar.events.owned'] });
  mocks.verifyCalendar.mockResolvedValue(undefined);
  mocks.saveConnection.mockResolvedValue(undefined);
  mocks.connectionStatus.mockImplementation(async () => ({ connected: mocks.saveConnection.mock.calls.length > 0 }));
  mocks.validToken.mockResolvedValue('access-token');
  mocks.listMemories.mockImplementation(async () => [...mocks.memories]); mocks.listCourses.mockResolvedValue([]);
  mocks.chatContext.mockResolvedValue({ history: [], agentContext: null }); mocks.appContext.mockResolvedValue(undefined);
  mocks.callAgent.mockResolvedValue('Let’s start with your closest deadline.'); mocks.appendMessages.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); delete (globalThis as typeof globalThis & { __polymateAgentRuntime?: unknown }).__polymateAgentRuntime; });

describe('first-time student journey', () => {
  it('onboards, connects Google Calendar, and sends the first persisted chat message', async () => {
    expect(await (await getOnboarding(request('/api/onboarding'))).json()).toEqual({ completed: false, profile: null });

    const profile = { goal: 'deadline', sessionMinutes: 50, coachCadence: 'proactive' } as const;
    const onboarding = await saveOnboarding(request('/api/onboarding', { method: 'POST', body: JSON.stringify(profile) }));
    expect(onboarding.status).toBe(200);
    expect(await onboarding.json()).toEqual({ completed: true, profile });

    const callback = await googleCallback(request('/api/integrations/google/callback?code=google-code&state=oauth-state', {
      headers: { cookie: 'polymate_google_binding=sealed-binding' },
    }));
    expect(callback.status).toBe(303);
    expect(callback.headers.get('location')).toBe(`${origin}/calendar?view=settings&google=connected`);
    expect(mocks.saveConnection).toHaveBeenCalledWith(owner.userId, expect.objectContaining({ accessToken: 'access-token' }));
    expect(await (await googleStatus(request('/api/integrations/google/status'))).json()).toMatchObject({ connected: true, enabled: true });

    const chat = await sendMessage(request('/api/agent/chat', { method: 'POST', body: JSON.stringify({ message: 'What should I study first?', conversationId }) }));
    const chatBody = await chat.json();
    expect(chat.status, JSON.stringify(chatBody)).toBe(200);
    expect(chatBody.reply).toBe('Let’s start with your closest deadline.');
    expect(mocks.callAgent).toHaveBeenCalledWith(expect.objectContaining({
      message: 'What should I study first?',
      persistentContext: expect.stringContaining('Preferred focus session length: 50 minutes.'),
    }));
    expect(mocks.appendMessages).toHaveBeenCalledWith(owner.userId, conversationId, [
      { role: 'user', content: 'What should I study first?' },
      { role: 'assistant', content: 'Let’s start with your closest deadline.' },
    ]);
  });
});
