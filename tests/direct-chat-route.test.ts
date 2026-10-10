import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';

const direct = vi.hoisted(() => ({ run: vi.fn(), stream: vi.fn() }));
const optionalContext = vi.hoisted(() => ({
  listActiveStudentMemories: vi.fn(),
  listCourses: vi.fn(),
  moodleConnectionAvailable: vi.fn(),
}));
vi.mock('../apps/web/lib/direct-chat-runtime', () => ({
  runDirectChatTurn: direct.run,
  streamDirectChatTurn: direct.stream,
}));
vi.mock('../packages/db/src/coaching', () => ({
  listActiveStudentMemories: optionalContext.listActiveStudentMemories,
  rememberStudentContext: vi.fn(),
}));
vi.mock('../packages/db/src/courses', () => ({ listCourses: optionalContext.listCourses }));
vi.mock('../apps/web/lib/moodle', async original => ({
  ...await original<typeof import('../apps/web/lib/moodle')>(),
  moodleConnectionAvailable: optionalContext.moodleConnectionAvailable,
}));

import { POST } from '../apps/web/app/api/agent/chat/route';

const origin = 'https://polymate.test';
const headers = { origin, 'x-user-id': 'student@example.test', 'content-type': 'application/json' };

function request(accept?: string) {
  return new NextRequest(`${origin}/api/agent/chat`, {
    method: 'POST',
    headers: accept ? { ...headers, accept } : headers,
    body: JSON.stringify({ message: 'What should I study?' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  optionalContext.listActiveStudentMemories.mockResolvedValue([]);
  optionalContext.listCourses.mockResolvedValue([]);
  optionalContext.moodleConnectionAvailable.mockResolvedValue(false);
  delete (globalThis as typeof globalThis & { __polymateAgentRuntime?: unknown }).__polymateAgentRuntime;
  vi.stubEnv('AUTH_MODE', 'managed-proxy');
  vi.stubEnv('MANAGED_PROXY_ONLY', 'true');
  vi.stubEnv('APP_ORIGIN', origin);
  vi.stubEnv('AGENT_CONTEXT_SECRET', 'context-test-secret-with-at-least-32-bytes');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('direct chat route', () => {
  it('uses the Agents SDK runtime for a complete response', async () => {
    direct.run.mockResolvedValue('Direct answer.');

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reply: 'Direct answer.', cards: [] });
    expect(direct.run).toHaveBeenCalledOnce();
    expect(direct.run.mock.calls[0][0]).toMatchObject({ message: 'What should I study?', persistentContext: undefined });
    expect(direct.stream).not.toHaveBeenCalled();
  });

  it('continues with prompt warnings when optional context dependencies fail', async () => {
    optionalContext.listActiveStudentMemories.mockRejectedValue(new Error('database unavailable'));
    optionalContext.listCourses.mockRejectedValue(new Error('database unavailable'));
    optionalContext.moodleConnectionAvailable.mockRejectedValue(new Error('moodle unavailable'));
    direct.run.mockResolvedValue('I can still help without connected data.');

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reply: 'I can still help without connected data.' });
    expect(direct.run).toHaveBeenCalledOnce();
    expect(direct.run.mock.calls[0][0]).toMatchObject({
      appContext: expect.stringContaining('unavailable'),
      persistentContext: expect.stringContaining('unavailable'),
    });
  });

  it('continues after optional database context times out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    optionalContext.listActiveStudentMemories.mockImplementation(() => new Promise(() => undefined));
    optionalContext.listCourses.mockImplementation(() => new Promise(() => undefined));
    direct.run.mockResolvedValue('I can answer without saved context.');

    const responsePromise = POST(request());
    await vi.advanceTimersByTimeAsync(1_500);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(direct.run).toHaveBeenCalledOnce();
    expect(direct.run.mock.calls[0][0].persistentContext).toContain('unavailable');
  });

  it('forwards only SDK output-text deltas and finishes with the authoritative response', async () => {
    const streamed = {
      finalOutput: 'Hello from the direct agent.',
      completed: Promise.resolve(),
      cancelled: false,
      error: undefined,
      async *[Symbol.asyncIterator]() {
        yield { type: 'raw_model_stream_event', data: { type: 'output_text_delta', delta: 'Hello ' } };
        yield { type: 'run_item_stream_event', name: 'tool_called', item: {} };
        yield { type: 'raw_model_stream_event', data: { type: 'output_text_delta', delta: 'from the direct agent.' } };
      },
    };
    direct.stream.mockResolvedValue(streamed);

    const response = await POST(request('application/x-ndjson, application/json'));
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>);

    expect(response.status).toBe(200);
    expect(events.filter(event => event.type === 'delta')).toEqual([
      { type: 'delta', text: 'Hello ' },
      { type: 'delta', text: 'from the direct agent.' },
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'done', reply: 'Hello from the direct agent.', cards: [] });
    expect(direct.stream).toHaveBeenCalledOnce();
    expect(direct.run).not.toHaveBeenCalled();
  });
});