import { describe, expect, it } from 'vitest';
import { readBoundedText } from '../packages/core/agent/http';

describe('agent stream limits', () => {
  it('decodes UTF-8 across chunks and rejects oversized streamed bodies without Content-Length', async () => {
    const bytes = new TextEncoder().encode('été');
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 1)); controller.enqueue(bytes.slice(1)); controller.close(); } });
    expect(await readBoundedText(stream, bytes.length)).toBe('été');
    let cancelled = false;
    const oversized = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(11)); }, cancel() { cancelled = true; } });
    await expect(readBoundedText(oversized, 10)).rejects.toThrow('size limit');
    expect(cancelled).toBe(true);
  });
});
