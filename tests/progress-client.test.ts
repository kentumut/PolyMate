import { describe, expect, it, vi } from 'vitest';
import { createProgressClient } from '../apps/web/components/study/progress-client';

const assignmentId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
const input = { eventId: 'study1', assignmentId, action: 'partly_done' as const, expectedAssignmentVersion: 1, expectedSessionRevision: 1, expectedEtag: '"1"', remainingMinutes: 100 };
const receipt = {
  report: { id: '00000000-0000-4000-8000-000000000003', clientRequestId: requestId, eventId: 'study1', assignmentId, action: 'partly_done', sessionRevision: 1, reportedRemainingMinutes: 100, assignmentFinished: false, note: '', reportedAt: '2026-10-12T10:00:00Z' },
  assignment: { id: assignmentId, title: 'Sheet', dueAt: '2026-10-16T16:00:00Z', estimatedMinutes: 150, remainingMinutes: 100, status: 'in_progress', version: 2 },
};

describe('progress client save acknowledgement', () => {
  it('retains the exact payload/ID after a lost reply, rejects changed values, and retries without duplicates', async () => {
    let first = true;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async path => {
      if (String(path).endsWith('/csrf')) return Response.json({ csrfToken: 'nonce' });
      if (first) { first = false; throw new TypeError('Reply lost'); }
      return Response.json({ receipt });
    });
    const client = createProgressClient({ fetcher, createRequestId: () => requestId });
    await expect(client.record(input)).rejects.toMatchObject({ kind: 'unknown' });
    await expect(client.record({ ...input, remainingMinutes: 50 })).rejects.toMatchObject({ kind: 'unknown' });
    expect(await client.retry()).toEqual(receipt);
    expect(fetcher.mock.calls.filter(([path]) => String(path).endsWith('/reports')).map(([, init]) => JSON.parse(init!.body as string).clientRequestId)).toEqual([requestId, requestId]);
    expect(client.getPendingReport()).toBeNull();
  });
  it('does not acknowledge a mismatched response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async path => String(path).endsWith('/csrf')
      ? Response.json({ csrfToken: 'nonce' }) : Response.json({ receipt: { ...receipt, report: { ...receipt.report, eventId: 'different' } } }));
    await expect(createProgressClient({ fetcher, createRequestId: () => requestId }).record(input)).rejects.toMatchObject({ kind: 'unknown' });
  });
  it('surfaces local validation errors as editable failures, not uncertain saved writes', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createProgressClient({ fetcher });
    await expect(client.record({ ...input, remainingMinutes: 0 })).rejects.toMatchObject({ kind: 'failed', code: 'validation' });
    expect(fetcher).not.toHaveBeenCalled(); expect(client.getPendingReport()).toBeNull();
  });
  it('keeps uncertainty across expired-session retries', async () => {
    let calls = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async path => {
      if (String(path).endsWith('/csrf')) return Response.json({ csrfToken: 'nonce' });
      if (++calls === 1) throw new TypeError('Lost reply');
      if (calls === 2) return Response.json({ error: { code: 'identity', message: 'Reconnect.' } }, { status: 401 });
      return Response.json({ receipt });
    });
    const client = createProgressClient({ fetcher, createRequestId: () => requestId });
    await expect(client.record(input)).rejects.toMatchObject({ kind: 'unknown' });
    await expect(client.retry()).rejects.toMatchObject({ kind: 'unknown' });
    expect(client.getPendingReport()?.clientRequestId).toBe(requestId);
    expect(await client.retry()).toEqual(receipt);
  });
  it('recovers pending completion after reload and clears it after calendar reconciliation', async () => {
    const doneRequest = { ...input, action: 'done', clientRequestId: requestId };
    let unresolved = true;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
      assignments: [receipt.assignment], links: [], reports: [{ ...receipt.report, action: 'done' }],
      pendingCompletions: unresolved ? [doneRequest] : [],
    }));
    const client = createProgressClient({ fetcher });
    await client.state(); expect(client.getPendingReport()?.clientRequestId).toBe(requestId);
    unresolved = false;
    await client.state(); expect(client.getPendingReport()).toBeNull();
  });
});
