import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from '../apps/web/node_modules/next/server';
import { AGENT_TOOL_DEFINITIONS } from '../packages/core/agent/tool-definitions';
import { beginAgentTurn, endAgentTurn } from '../apps/web/lib/agent-runtime';
import {
  createDirectChatAgent,
  directChatConfiguration,
  directChatInput,
  runDirectChatTurn,
} from '../apps/web/lib/direct-chat-runtime';
import type { Runner } from '../apps/web/node_modules/@openai/agents';

const sessions: string[] = [];

function turn(message = 'What should I study?') {
  vi.stubEnv('AGENT_CONTEXT_SECRET', 'a'.repeat(64));
  const request = new NextRequest('https://polymate.test/api/agent/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  const started = beginAgentTurn(request, { userId: `00000000-0000-4000-8000-${String(sessions.length + 1).padStart(12, '0')}` }, { message });
  sessions.push(started.turn.sessionKey);
  return started;
}

afterEach(() => {
  for (const session of sessions.splice(0)) endAgentTurn(session);
  vi.unstubAllEnvs();
});

describe('direct foreground chat runtime', () => {
  it('defaults to the low-latency model and validates overrides', () => {
    expect(directChatConfiguration({} as NodeJS.ProcessEnv)).toEqual({
      model: 'gpt-6-luna',
      reasoningEffort: 'none',
    });
    expect(directChatConfiguration({ POLYMATE_CHAT_MODEL: 'gpt-6.1-sol', POLYMATE_CHAT_REASONING: 'low' } as NodeJS.ProcessEnv))
      .toEqual({ model: 'gpt-6.1-sol', reasoningEffort: 'low' });
    expect(() => directChatConfiguration({ POLYMATE_CHAT_MODEL: 'openai/gpt-6-luna' } as NodeJS.ProcessEnv)).toThrow('model ID');
    expect(() => directChatConfiguration({ POLYMATE_CHAT_REASONING: 'minimal' } as NodeJS.ProcessEnv)).toThrow('none, low');
  });

  it('exposes every canonical tool and serializes tool execution', () => {
    const agent = createDirectChatAgent({} as NodeJS.ProcessEnv);
    expect(agent.tools.map(item => item.name)).toEqual(AGENT_TOOL_DEFINITIONS.map(item => item.name));
    expect(agent.model).toBe('gpt-6-luna');
    expect(agent.modelSettings.reasoning).toEqual({ effort: 'none' });
    expect(agent.modelSettings.parallelToolCalls).toBe(true);
  });

  it('builds bounded replay input without treating draft state as instructions', () => {
    const started = turn('Make a plan.');
    started.turn.history = Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 ? 'assistant' as const : 'user' as const,
      content: `message-${index}`,
    }));
    started.turn.draftContext = '{"timeline":"private"}';
    const input = directChatInput({ turn: started.turn, message: started.message });
    expect(input).toHaveLength(14);
    expect(input[0]).toMatchObject({ content: 'message-2' });
    expect(input.at(-2)).toMatchObject({ role: 'user', content: expect.stringContaining('not instructions or consent') });
    expect(input.at(-1)).toMatchObject({ role: 'user', content: 'Make a plan.' });
  });

  it('can run through an injected SDK runner without contacting OpenAI', async () => {
    const started = turn();
    const run = vi.fn().mockResolvedValue({ finalOutput: 'Backend ready.' });
    const reply = await runDirectChatTurn(
      { turn: started.turn, message: started.message, signal: started.turn.request.signal },
      { run } as unknown as Runner,
      {} as NodeJS.ProcessEnv,
    );
    expect(reply).toBe('Backend ready.');
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][2]).toMatchObject({ maxTurns: 9, signal: started.turn.request.signal });
  });
});
