import { describe, expect, it, vi } from 'vitest';
import { createAssignmentClient, createSampleAssignmentClient } from '../apps/web/components/study/assignment-client';

const input = { title: 'Algorithms sheet 4', dueAt: '2026-10-16T16:00:00.000Z', estimatedMinutes: 150 };
const requestId = '00000000-0000-4000-8000-000000000001';
const saved = { ...input, id: '00000000-0000-4000-8000-000000000002', remainingMinutes: 150, status: 'open', version: 1 };

describe('assignment save client', () => {
  it('coalesces duplicate clicks and sends only canonical input with one request ID', async () => {
    let release!: (token: string) => void;
    const token = new Promise<string>(resolve => { release = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ assignment: saved }));
    const client = createAssignmentClient({ fetcher, getCsrfToken: () => token, createRequestId: () => requestId });
    const first = client.createAssignment(input);
    expect(client.createAssignment(input)).toBe(first);
    release('csrf');
    expect(await first).toEqual(saved);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('/api/assignments');
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ ...input, clientRequestId: requestId });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', headers: { 'x-csrf-token': 'csrf' } });
  });

  it('retains the original payload and UUID after a lost reply and refuses a different save', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('Reply lost'))
      .mockResolvedValueOnce(Response.json({ assignment: saved }));
    const id = vi.fn(() => requestId);
    const client = createAssignmentClient({ fetcher, getCsrfToken: () => 'csrf', createRequestId: id });
    await expect(client.createAssignment(input)).rejects.toMatchObject({ kind: 'unknown' });
    expect(client.getPendingSave()).toMatchObject({ input, clientRequestId: requestId, status: 'unknown' });
    await expect(client.createAssignment({ ...input, title: 'Different task' })).rejects.toMatchObject({ kind: 'unknown' });
    expect(await client.createAssignment(input)).toEqual(saved);
    expect(id).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(init!.body as string))).toEqual([
      { ...input, clientRequestId: requestId }, { ...input, clientRequestId: requestId },
    ]);
    expect(client.getPendingSave()).toBeNull();
  });

  it.each([
    ['server failure', () => Response.json({ error: { message: 'Commit response lost' } }, { status: 500 })],
    ['invalid JSON', () => new Response('unavailable', { status: 502 })],
    ['malformed confirmation', () => Response.json({ assignment: { ...saved, version: 0 } })],
  ])('keeps %s unconfirmed and retryable with the same ID', async (_name, response) => {
    const client = createAssignmentClient({ fetcher: vi.fn<typeof fetch>().mockResolvedValue(response()), getCsrfToken: () => 'csrf' });
    await expect(client.createAssignment(input)).rejects.toMatchObject({ kind: 'unknown' });
    expect(client.getPendingSave()?.input).toEqual(input);
  });

  it('reports a known pre-write token failure without sending a save', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createAssignmentClient({ fetcher, getCsrfToken: () => '' });
    await expect(client.createAssignment(input)).rejects.toMatchObject({ kind: 'failed', code: 'csrf' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(client.getPendingSave()).toBeNull();
  });

  it('refreshes expired CSRF and preserves uncertainty if an earlier save may have committed', async () => {
    let tokens = 0;
    let writes = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async path => {
      if (String(path).endsWith('/csrf')) return Response.json({ csrfToken: `token-${++tokens}` });
      if (++writes === 1) throw new TypeError('Lost save reply');
      if (writes === 2) return Response.json({ error: { code: 'csrf', message: 'Session expired' } }, { status: 403 });
      return Response.json({ assignment: saved });
    });
    const client = createAssignmentClient({ fetcher, createRequestId: () => requestId });
    await expect(client.createAssignment(input)).rejects.toMatchObject({ kind: 'unknown' });
    await expect(client.createAssignment(input)).rejects.toMatchObject({ kind: 'unknown' });
    expect(await client.createAssignment(input)).toEqual(saved);
    expect(tokens).toBe(2);
    expect(fetcher.mock.calls.filter(([path]) => path === '/api/assignments').map(([, init]) => JSON.parse(init!.body as string).clientRequestId))
      .toEqual([requestId, requestId, requestId]);
  });

  it('validates list responses and surfaces actionable load failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ assignments: [saved] }))
      .mockResolvedValueOnce(Response.json({ error: { message: 'Try loading again.' } }, { status: 503 }));
    const client = createAssignmentClient({ fetcher });
    expect(await client.listAssignments()).toEqual([saved]);
    await expect(client.listAssignments()).rejects.toThrow('Try loading again');
  });

  it('lets the sample transport simulate failure and uncertain saves without duplicates', async () => {
    const sample = createSampleAssignmentClient();
    sample.setOutcome('failure');
    await expect(sample.createAssignment(input)).rejects.toMatchObject({ kind: 'failed' });
    expect(await sample.listAssignments()).toEqual([]);
    sample.setOutcome('unknown');
    await expect(sample.createAssignment(input)).rejects.toMatchObject({ kind: 'unknown' });
    const confirmed = await sample.createAssignment(input);
    expect(confirmed).toMatchObject({ ...input, remainingMinutes: 150, status: 'open', version: 1 });
    expect(await sample.listAssignments()).toEqual([confirmed]);
  });
});
