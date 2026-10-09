import { describe, expect, it, vi } from 'vitest';
import { createStudyCalendarClient } from '../apps/web/components/study/study-calendar-client';
import type { StudyBlockInput } from '../apps/web/components/study/study-block-form';

const input: StudyBlockInput = { title: 'Attempt questions 1–2', startAt: '2026-10-09T07:00:00Z', endAt: '2026-10-09T07:50:00Z', timezone: 'Europe/Zurich' };
const response = (body: unknown, status = 200) => Response.json(body, { status });

describe('study calendar browser adapter', () => {
  it('sends only editable data and a stable operation ID with same-origin credentials and CSRF', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ operationId: 'op-1', status: 'synced' }));
    const client = createStudyCalendarClient({ fetcher, getCsrfToken: () => 'csrf-token', createOperationId: () => 'op-1' });
    const result = await client.onCreate({ ...input, ownerId: 'not-allowed' } as StudyBlockInput);
    expect(result.status).toBe('synced');
    const [path, init] = fetcher.mock.calls[0];
    expect(path).toBe('/api/calendar/study-blocks');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { 'x-csrf-token': 'csrf-token' } });
    expect(JSON.parse(init!.body as string)).toEqual({ ...input, operationId: 'op-1' });
  });

  it('maps update, complete, and delete to the documented routes with original ETags', async () => {
    let counter = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => response({ operationId: JSON.parse(init!.body as string).operationId, status: 'synced' }));
    const client = createStudyCalendarClient({ fetcher, getCsrfToken: () => 'csrf', createOperationId: () => `op-${++counter}` });
    await client.onUpdate('event/1', input, '"v1"');
    await client.onComplete('event/1', '"v2"');
    await client.onDelete('event/1', '"v3"');
    expect(fetcher.mock.calls.map(([path, init]) => [path, init!.method, JSON.parse(init!.body as string)])).toEqual([
      ['/api/calendar/study-blocks/event%2F1', 'PATCH', { ...input, expectedEtag: '"v1"', operationId: 'op-1' }],
      ['/api/calendar/study-blocks/event%2F1/complete', 'POST', { expectedEtag: '"v2"', operationId: 'op-2' }],
      ['/api/calendar/study-blocks/event%2F1', 'DELETE', { expectedEtag: '"v3"', operationId: 'op-3' }],
    ]);
  });

  it('does not send a write without a CSRF token', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = createStudyCalendarClient({ fetcher, getCsrfToken: () => '' });
    expect((await client.onCreate(input)).status).toBe('failed');
    expect(fetcher).not.toHaveBeenCalled();
    expect(client.getBlockingOperation()).toBeNull();
  });

  it('retains overlap/reconnect errors as known failures and retries the same request ID', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ error: { code: 'overlap', message: 'Choose another slot.', recoverable: true } }, 409))
      .mockResolvedValueOnce(response({ operationId: 'op-1', status: 'synced' }));
    const client = createStudyCalendarClient({ fetcher, getCsrfToken: () => 'csrf', createOperationId: () => 'op-1' });
    expect(await client.onCreate(input)).toMatchObject({ status: 'failed', error: { code: 'overlap', message: 'Choose another slot.' } });
    expect((await client.retryFailed('op-1')).status).toBe('synced');
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(init!.body as string).operationId)).toEqual(['op-1', 'op-1']);
  });

  it('treats transport failures as uncertain and blocks subsequent writes across dialog reopenings', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('Connection lost after sending.'));
    const newId = vi.fn(() => 'op-1');
    const client = createStudyCalendarClient({ fetcher, getCsrfToken: () => 'csrf', createOperationId: newId });
    expect((await client.onCreate(input)).status).toBe('unknown');
    expect((await client.onDelete('event', '"v1"')).status).toBe('unknown');
    expect((await client.retryFailed('op-1')).status).toBe('unknown');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(newId).toHaveBeenCalledTimes(1);
    expect(client.getBlockingOperation()?.operationId).toBe('op-1');
  });

  it.each([
    ['unconfirmed 2xx', () => response({ ok: true })],
    ['wrong operation ID', () => response({ operationId: 'different-op', status: 'synced' })],
    ['server failure', () => response({ error: { message: 'Server failed after writing.' } }, 500)],
    ['invalid JSON', () => new Response('<html>error</html>', { status: 502 })],
  ])('does not claim success for %s', async (_name, makeResponse) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(makeResponse());
    const client = createStudyCalendarClient({ fetcher, getCsrfToken: () => 'csrf', createOperationId: () => 'op-1' });
    expect((await client.onCreate(input)).status).toBe('unknown');
    expect(client.getBlockingOperation()).not.toBeNull();
  });

  it('reconciles a returned pending operation without issuing another mutation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ operationId: 'op-1', status: 'pending' }));
    const reconcileOperation = vi.fn().mockResolvedValue({ operationId: 'op-1', status: 'synced' });
    const client = createStudyCalendarClient({ fetcher, getCsrfToken: () => 'csrf', createOperationId: () => 'op-1', reconcileOperation });
    expect((await client.onComplete('event', '"v1"')).status).toBe('pending');
    expect((await client.reconcile('op-1')).status).toBe('synced');
    expect(reconcileOperation).toHaveBeenCalledWith('op-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.getBlockingOperation()).toBeNull();
    await client.retryFailed('op-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('blocks concurrent submissions while awaiting the CSRF provider', async () => {
    let release!: (token: string) => void;
    const token = new Promise<string>(resolve => { release = resolve; });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ operationId: 'op-1', status: 'synced' }));
    const client = createStudyCalendarClient({ fetcher, getCsrfToken: () => token, createOperationId: () => 'op-1' });
    const first = client.onCreate(input);
    expect((await client.onComplete('event', '"v1"')).status).toBe('pending');
    release('csrf');
    await first;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reuses the failed intent ID on a dialog retry but allocates a new ID for corrected values', async () => {
    let counter = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => response({
      operationId: JSON.parse(init!.body as string).operationId, status: 'failed', error: { message: 'Choose another slot.' },
    }));
    const client = createStudyCalendarClient({ fetcher, getCsrfToken: () => 'csrf', createOperationId: () => `op-${++counter}` });
    await client.onCreate(input);
    await client.onCreate(input);
    await client.onCreate({ ...input, title: 'Corrected task' });
    expect(fetcher.mock.calls.map(([, init]) => JSON.parse(init!.body as string).operationId)).toEqual(['op-1', 'op-1', 'op-2']);
  });

  it('cannot release the write lock by reconciling while a local request is still in flight', async () => {
    let release!: (token: string) => void;
    const token = new Promise<string>(resolve => { release = resolve; });
    const reconcileOperation = vi.fn().mockResolvedValue({ operationId: 'op-1', status: 'synced' });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ operationId: 'op-1', status: 'synced' }));
    const client = createStudyCalendarClient({ fetcher, getCsrfToken: () => token, createOperationId: () => 'op-1', reconcileOperation });
    const first = client.onCreate(input);
    expect((await client.reconcile('op-1')).status).toBe('pending');
    expect(reconcileOperation).not.toHaveBeenCalled();
    expect((await client.onDelete('event', '"v1"')).status).toBe('pending');
    release('csrf');
    await first;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
