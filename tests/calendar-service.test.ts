import { beforeEach, describe, expect, it } from 'vitest';
import { CalendarService } from '../packages/core/calendar/service';
import { GoogleCalendarApi, type GoogleEvent } from '../packages/core/calendar/google-api';
import { MemoryOperationStore } from '../packages/core/calendar/operations';
import { FakeCalendarClient, sampleWeekEvents } from '../packages/core/calendar/fake-client';

const OWNER = '11111111-2222-5333-a444-555555555555';
const op = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Small in-memory stand-in for the Google Calendar v3 events endpoints PolyMate uses. */
class FakeGoogle {
  events = new Map<string, GoogleEvent>();
  calls: string[] = [];
  /** Fail the next matching write after (or before) applying it. */
  dropReply: { method: string; apply: boolean } | null = null;
  private version = 0;

  seed(event: Omit<GoogleEvent, 'etag'>) {
    this.events.set(event.id, { ...event, etag: `"e${++this.version}"` });
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    this.calls.push(`${method} ${url.pathname.split('/events')[1] || '/'}`);
    const id = decodeURIComponent(url.pathname.split('/events/')[1] ?? '');
    const ifMatch = (init?.headers as Record<string, string>)['if-match'];
    const body = init?.body ? JSON.parse(String(init.body)) as GoogleEvent : undefined;
    const reply = (status: number, json?: unknown) => new Response(json === undefined ? null : JSON.stringify(json), { status });
    const drop = this.dropReply?.method === method ? this.dropReply : null;
    if (drop) this.dropReply = null;
    if (drop && !drop.apply) throw new TypeError('network down');

    let response: Response;
    if (method === 'GET' && !id) {
      const min = Date.parse(url.searchParams.get('timeMin')!);
      const max = Date.parse(url.searchParams.get('timeMax')!);
      const items = [...this.events.values()].filter(e =>
        Date.parse(e.start!.dateTime ?? e.start!.date!) < max && Date.parse(e.end!.dateTime ?? e.end!.date!) > min);
      response = reply(200, { items });
    } else if (method === 'POST') {
      if (this.events.has(body!.id)) response = reply(409, { error: { errors: [{ reason: 'duplicate' }] } });
      else { this.seed(body as GoogleEvent); response = reply(200, this.events.get(body!.id)); }
    } else {
      const current = this.events.get(id);
      if (!current) response = reply(404, { error: { errors: [{ reason: 'notFound' }] } });
      else if (method === 'GET') response = reply(200, current);
      else if (ifMatch && ifMatch !== current.etag) response = reply(412, { error: { errors: [{ reason: 'conditionNotMet' }] } });
      else if (method === 'DELETE') { this.events.delete(id); response = reply(204); }
      else {
        const next = { ...current, ...body, etag: `"e${++this.version}"` };
        this.events.set(id, next);
        response = reply(200, next);
      }
    }
    if (drop) throw new TypeError('connection reset after write');
    return response;
  };
}

let google: FakeGoogle;
let service: CalendarService;

beforeEach(() => {
  google = new FakeGoogle();
  google.seed({ id: 'lecture1', summary: 'Analysis I', start: { dateTime: '2026-10-12T08:15:00Z' }, end: { dateTime: '2026-10-12T10:00:00Z' } });
  google.seed({ id: 'holiday1', summary: 'Knabenschiessen', start: { date: '2026-10-13' }, end: { date: '2026-10-14' } });
  google.seed({ id: 'free1', summary: 'Optional talk', transparency: 'transparent', start: { dateTime: '2026-10-12T14:00:00Z' }, end: { dateTime: '2026-10-12T15:00:00Z' } });
  const api = new GoogleCalendarApi({ accessToken: async () => 'token', fetcher: google.fetch });
  service = new CalendarService(OWNER, api, new MemoryOperationStore());
});

const block = { title: 'Linear algebra sheet', startAt: '2026-10-12T10:00:00.000Z', endAt: '2026-10-12T10:50:00.000Z' };

describe('CalendarService against Google', () => {
  it('lists personal events as read-only and all-day events at Zurich midnight', async () => {
    const events = await service.listWeek({ from: '2026-10-11T22:00:00.000Z', to: '2026-10-18T22:00:00.000Z' });
    expect(events.find(e => e.id === 'lecture1')).toMatchObject({ source: 'google-personal', editable: false, allDay: false });
    expect(events.find(e => e.id === 'holiday1')).toMatchObject({ allDay: true, startAt: '2026-10-12T22:00:00.000Z' });
  });

  it('creates, moves, completes and deletes an owned study block', async () => {
    const created = await service.createStudyBlock(block, op(1));
    expect(created).toMatchObject({ status: 'synced', event: { source: 'polymate', editable: true, title: block.title, completion: 'open' } });
    const id = created.event!.id;
    expect(google.events.get(id)?.extendedProperties?.private).toMatchObject({ polymateKind: 'study-block', polymateOwner: OWNER });

    const moved = await service.updateStudyBlock(id, { startAt: '2026-10-12T15:00:00.000Z', endAt: '2026-10-12T15:50:00.000Z' }, created.event!.etag, op(2));
    expect(moved).toMatchObject({ status: 'synced', event: { startAt: '2026-10-12T15:00:00.000Z' } });

    const done = await service.completeStudyBlock(id, moved.event!.etag, op(3));
    expect(done.event).toMatchObject({ completion: 'done', title: block.title });
    expect(google.events.get(id)?.summary).toBe(`✓ ${block.title}`);

    expect(await service.deleteStudyBlock(id, done.event!.etag, op(4))).toEqual({ operationId: op(4), status: 'synced' });
    expect(google.events.has(id)).toBe(false);
  });

  it('rejects overlaps with busy time but ignores free and all-day events', async () => {
    const overlap = await service.createStudyBlock({ ...block, startAt: '2026-10-12T09:30:00.000Z' }, op(1));
    expect(overlap).toMatchObject({ status: 'failed', error: { code: 'overlap' } });
    expect(overlap.error?.message).toContain('Analysis I');
    expect(await service.createStudyBlock({ ...block, startAt: '2026-10-12T14:00:00.000Z', endAt: '2026-10-12T14:50:00.000Z' }, op(2)))
      .toMatchObject({ status: 'synced' });
    expect(google.calls.filter(c => c.startsWith('POST'))).toHaveLength(1);
  });

  it('never mutates personal events', async () => {
    const etag = google.events.get('lecture1')!.etag;
    for (const result of [
      await service.updateStudyBlock('lecture1', { title: 'Hacked' }, etag, op(1)),
      await service.completeStudyBlock('lecture1', etag, op(2)),
      await service.deleteStudyBlock('lecture1', etag, op(3)),
    ]) expect(result).toMatchObject({ status: 'failed', error: { code: 'forbidden' } });
    expect(google.events.get('lecture1')?.summary).toBe('Analysis I');
    expect(google.calls.some(c => c.startsWith('PATCH') || c.startsWith('DELETE'))).toBe(false);
  });

  it('does not treat another owner’s PolyMate event as editable', async () => {
    const other = new CalendarService('99999999-2222-5333-a444-555555555555',
      new GoogleCalendarApi({ accessToken: async () => 'token', fetcher: google.fetch }), new MemoryOperationStore());
    const created = await other.createStudyBlock(block, op(1));
    const result = await service.completeStudyBlock(created.event!.id, created.event!.etag, op(2));
    expect(result.error?.code).toBe('forbidden');
  });

  it('returns a conflict for a stale etag instead of overwriting', async () => {
    const created = await service.createStudyBlock(block, op(1));
    await service.updateStudyBlock(created.event!.id, { title: 'Renamed elsewhere' }, created.event!.etag, op(2));
    const stale = await service.updateStudyBlock(created.event!.id, { title: 'Mine' }, created.event!.etag, op(3));
    expect(stale).toMatchObject({ status: 'failed', error: { code: 'conflict' } });
  });

  it('replays a finished operation without writing twice', async () => {
    const first = await service.createStudyBlock(block, op(1));
    const again = await service.createStudyBlock(block, op(1));
    expect(again).toEqual(first);
    expect(google.calls.filter(c => c.startsWith('POST'))).toHaveLength(1);
    expect(await service.deleteStudyBlock('lecture1', 'x', op(1))).toMatchObject({ error: { code: 'validation' } });
  });

  it('reconciles a create whose reply was lost', async () => {
    google.dropReply = { method: 'POST', apply: true };
    const result = await service.createStudyBlock(block, op(1));
    expect(result).toMatchObject({ status: 'synced', event: { title: block.title } });
    expect(google.events.size).toBe(4);
  });

  it('reports a create that never reached Google as retryable, and the retry does not duplicate', async () => {
    google.dropReply = { method: 'POST', apply: false };
    expect(await service.createStudyBlock(block, op(1))).toMatchObject({ status: 'failed', error: { code: 'google_unavailable' } });
    // A failed result is final for that operation ID; the UI retries with a new one.
    expect(await service.createStudyBlock(block, op(2))).toMatchObject({ status: 'synced' });
    expect(google.events.size).toBe(4);
  });

  it('reconciles a move whose reply was lost, and an unknown verification stays unknown', async () => {
    const created = await service.createStudyBlock(block, op(1));
    google.dropReply = { method: 'PATCH', apply: true };
    const moved = await service.updateStudyBlock(created.event!.id, { title: 'Renamed' }, created.event!.etag, op(2));
    expect(moved).toMatchObject({ status: 'synced', event: { title: 'Renamed' } });

    // The PATCH reply is lost and Google stays unreachable while PolyMate tries to verify it.
    let googleDown = false;
    const flaky = new CalendarService(OWNER, new GoogleCalendarApi({
      accessToken: async () => 'token',
      fetcher: async (input, init) => {
        if (googleDown) throw new TypeError('down');
        if (init?.method === 'PATCH') { googleDown = true; await google.fetch(input, init); throw new TypeError('reset'); }
        return google.fetch(input, init);
      },
    }), new MemoryOperationStore());
    const result = await flaky.updateStudyBlock(created.event!.id, { title: 'Again' }, moved.event!.etag, op(3));
    expect(result.status).toBe('unknown');
  });

  it('reports a missing Google connection without throwing', async () => {
    const disconnected = new CalendarService(OWNER, new GoogleCalendarApi({
      accessToken: async () => { throw new Error('Google Calendar is not connected.'); }, fetcher: google.fetch,
    }), new MemoryOperationStore());
    expect(await disconnected.createStudyBlock(block, op(1))).toMatchObject({ status: 'failed', error: { code: 'not_connected' } });
  });
});

describe('FakeCalendarClient', () => {
  it('follows the same ownership and overlap rules', async () => {
    const now = new Date('2026-10-09T12:00:00Z');
    const client = new FakeCalendarClient(sampleWeekEvents(now));
    const events = await client.listWeek({ from: '2026-10-04T22:00:00.000Z', to: '2026-10-11T22:00:00.000Z' });
    const personal = events.find(e => !e.editable)!;
    expect((await client.deleteStudyBlock(personal.id, personal.etag, op(1))).error?.code).toBe('forbidden');
    expect((await client.createStudyBlock({ title: 'x', startAt: personal.startAt, endAt: personal.endAt }, op(2))).error?.code)
      .toBe(personal.allDay ? undefined : 'overlap');
  });
});
