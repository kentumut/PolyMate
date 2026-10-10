import { describe, expect, it } from 'vitest';
import { PRIVATE_REPLACEMENT, StreamRedactor, readChatCompletionStream, wantsAgentStream } from '../apps/web/lib/agent-stream';

function sse(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } });
}
const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;

describe('agent chat streaming', () => {
  it('only streams for clients that ask for NDJSON', () => {
    expect(wantsAgentStream('application/x-ndjson, application/json')).toBe(true);
    expect(wantsAgentStream('application/json')).toBe(false);
    expect(wantsAgentStream(null)).toBe(false);
  });

  it('never emits a private value, even when it is split across deltas', () => {
    const secrets = new Set(['pm.secret-session-key']);
    const redactor = new StreamRedactor(secrets);
    const shown = ['Your key is pm.sec', 'ret-sess', 'ion-key, done.'].map(text => redactor.push(text)).join('');
    expect(shown).toBe(`Your key is ${PRIVATE_REPLACEMENT}, done.`);
    expect(shown).not.toContain('pm.sec');
  });

  it('holds back only a possible private prefix and releases it once it stops matching', () => {
    const redactor = new StreamRedactor(new Set(['token-abc']));
    expect(redactor.push('A tok')).toBe('A ');
    // A trailing 't' could start another 'token-abc', so it waits for the next delta.
    expect(redactor.push('en list')).toBe('token lis');
    expect(redactor.push('.')).toBe('t.');
  });

  it('redacts values added while the turn is running', () => {
    const secrets = new Set<string>();
    const redactor = new StreamRedactor(secrets);
    expect(redactor.push('Before. ')).toBe('Before. ');
    secrets.add('sealed-draft-token');
    expect(redactor.push('Use sealed-draft-token now.')).toBe(`Use ${PRIVATE_REPLACEMENT} now.`);
  });

  it('parses SSE deltas across chunk boundaries and keeps the usage chunk', async () => {
    const usage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 64 } } })}\n\n`;
    const whole = `data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n${delta('Hel')}${delta('lo')}${usage}data: [DONE]\n\n`;
    const deltas: string[] = [];
    const result = await readChatCompletionStream(sse([whole.slice(0, 37), whole.slice(37, 90), whole.slice(90)]), text => deltas.push(text), 10_000);
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(result.content).toBe('Hello');
    expect(result.usage).toMatchObject({ usage: { prompt_tokens: 100 } });
    expect(result.bytes).toBe(new TextEncoder().encode(whole).byteLength);
  });

  it('rejects an oversized stream', async () => {
    await expect(readChatCompletionStream(sse([delta('x'.repeat(200))]), () => undefined, 100)).rejects.toThrow('too large');
  });
});
