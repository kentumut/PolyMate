/** Streaming helpers for agent chat: gateway SSE parsing, safe text deltas, and NDJSON events to the browser. */

export const AGENT_STREAM_CONTENT_TYPE = 'application/x-ndjson';
export const PRIVATE_REPLACEMENT = '[private draft reference]';

export type AgentStreamEvent =
  | { type: 'status'; tool: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; reply: string; cards: unknown[]; pendingPlan: unknown; reloadCalendar: boolean; timing: string }
  | { type: 'error'; status: number; error: { message: string } };

export function wantsAgentStream(accept: string | null): boolean {
  return Boolean(accept?.split(',').some(part => part.trim().split(';')[0] === AGENT_STREAM_CONTENT_TYPE));
}

/**
 * Redacts private values from streamed text before it reaches the browser. Text that could be the start
 * of a private value is held back until it either completes (and is replaced) or stops matching, so a
 * value split across deltas is never shown in pieces. `privateValues` is read live: tools add to it mid-turn.
 */
export class StreamRedactor {
  private pending = '';
  constructor(private readonly privateValues: ReadonlySet<string>) {}

  push(text: string): string {
    let buffer = this.pending + text;
    for (const value of this.privateValues) if (value) buffer = buffer.replaceAll(value, PRIVATE_REPLACEMENT);
    let hold = 0;
    for (const value of this.privateValues) {
      for (let length = Math.min(buffer.length, value.length - 1); length > hold; length--) {
        if (buffer.endsWith(value.slice(0, length))) { hold = length; break; }
      }
    }
    this.pending = buffer.slice(buffer.length - hold);
    return buffer.slice(0, buffer.length - hold);
  }
  // No flush: held-back text is a possible private prefix, and the final `done` event carries the full redacted reply.
}

/**
 * Reads an OpenAI-compatible chat-completions SSE stream. Calls `onDelta` for each content delta and
 * returns the full content plus the last `usage` object seen (sent when stream_options.include_usage is set).
 */
export async function readChatCompletionStream(body: ReadableStream<Uint8Array> | null, onDelta: (text: string) => void, maxBytes: number): Promise<{ content: string; usage: unknown; bytes: number }> {
  if (!body) throw new Error('Empty stream.');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', content = '', usage: unknown, bytes = 0, done = false;
  const handle = (event: string) => {
    for (const line of event.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') { done = true; return; }
      let chunk: { choices?: Array<{ delta?: { content?: unknown } }>; usage?: unknown };
      try { chunk = JSON.parse(data); } catch { continue; }
      if (chunk.usage) usage = chunk;
      const text = chunk.choices?.[0]?.delta?.content;
      if (typeof text === 'string' && text) { content += text; onDelta(text); }
    }
  };
  try {
    while (!done) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Stream too large.');
      buffer += decoder.decode(value, { stream: true });
      let boundary: number;
      while (!done && (boundary = buffer.indexOf('\n\n')) >= 0) { handle(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
    }
    if (!done && buffer.trim()) handle(buffer + decoder.decode());
  } finally { reader.cancel().catch(() => undefined); }
  return { content, usage, bytes };
}

export function encodeAgentEvent(event: AgentStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}
