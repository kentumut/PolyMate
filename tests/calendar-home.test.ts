import { beforeEach, describe, expect, it } from 'vitest';
import { GoogleCalendarApi, type GoogleEvent } from '../packages/core/calendar/google-api';
import { googleStudyBlockHome, moveStudyBlocks, parseCalendarHome, type MovableBlock, type StudyBlockHome } from '../packages/core/calendar/home';
import { newStudyBlockEvent } from '../packages/core/calendar/mapping';

const OWNER = '11111111-2222-5333-a444-555555555555';
const RANGE = { from: '2026-10-10T00:00:00.000Z', to: '2027-10-10T00:00:00.000Z' };
const block = (n: number, overrides: Partial<MovableBlock> = {}): MovableBlock => ({
  id: `pm${String(n).padStart(32, '0')}`, title: `Sheet ${n}`, completion: 'open',
  startAt: `2026-10-${String(11 + n).padStart(2, '0')}T10:00:00.000Z`, endAt: `2026-10-${String(11 + n).padStart(2, '0')}T10:50:00.000Z`, ...overrides,
});

/** Google keeps deleted events as cancelled and refuses to reuse their IDs, like the real API. */
class FakeGoogle {
  events = new Map<string, GoogleEvent>();
  failNext: string | null = null;
  private version = 0;

  seed(event: Omit<GoogleEvent, 'etag'>) { this.events.set(event.id, { ...event, etag: `"e${++this.version}"` }); }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (this.failNext === method) { this.failNext = null; return new Response(JSON.stringify({ error: { errors: [{ reason: 'backendError' }] } }), { status: 503 }); }
    const id = decodeURIComponent(url.pathname.split('/events/')[1] ?? '');
    const body = init?.body ? JSON.parse(String(init.body)) as GoogleEvent : undefined;
    const reply = (status: number, json?: unknown) => new Response(json === undefined ? null : JSON.stringify(json), { status });
    if (method === 'GET' && !id) return reply(200, { items: [...this.events.values()].filter(event => event.status !== 'cancelled') });
    if (method === 'POST') {
      if (this.events.has(body!.id)) return reply(409, { error: { errors: [{ reason: 'duplicate' }] } });
      this.seed(body!);
      return reply(200, this.events.get(body!.id));
    }
    const current = this.events.get(id);
    if (!current) return reply(404, { error: { errors: [{ reason: 'notFound' }] } });
    if (method === 'GET') return reply(200, current);
    if (method === 'DELETE') { this.events.set(id, { ...current, status: 'cancelled', etag: `"e${++this.version}"` }); return reply(204); }
    const next = { ...current, ...body, etag: `"e${++this.version}"` };
    this.events.set(id, next);
    return reply(200, next);
  };
}

function memoryHome(initial: MovableBlock[] = []) {
  const blocks = new Map(initial.map(item => [item.id, item]));
  const home: StudyBlockHome & { blocks: Map<string, MovableBlock> } = {
    blocks,
    listOwnBlocks: async () => [...blocks.values()],
    put: async item => { blocks.set(item.id, item); },
    remove: async id => { blocks.delete(id); },
  };
  return home;
}

let google: FakeGoogle;
let home: StudyBlockHome;

beforeEach(() => {
  google = new FakeGoogle();
  google.seed({ id: 'lecture1', summary: 'Analysis I', start: { dateTime: '2026-10-12T08:15:00Z' }, end: { dateTime: '2026-10-12T10:00:00Z' } });
  home = googleStudyBlockHome(new GoogleCalendarApi({ accessToken: async () => 'token', fetcher: google.fetch }), OWNER);
});

describe('calendar home choice', () => {
  it('accepts only the two supported homes', () => {
    expect(parseCalendarHome('google')).toBe('google');
    expect(parseCalendarHome('polymate')).toBe('polymate');
    for (const value of ['outlook', '', null, undefined]) expect(() => parseCalendarHome(value)).toThrow();
  });
});

describe('moving study blocks between calendars', () => {
  it('moves every block and keeps IDs and completion', async () => {
    const from = memoryHome([block(1), block(2, { completion: 'done' })]);
    const to = memoryHome();
    expect(await moveStudyBlocks(from, to, RANGE)).toEqual({ total: 2, moved: 2, complete: true });
    expect([...to.blocks.values()]).toEqual([block(1), block(2, { completion: 'done' })]);
    expect(from.blocks.size).toBe(0);
  });

  it('never removes a block whose copy failed, and a retry finishes without duplicates', async () => {
    const from = memoryHome([block(1), block(2), block(3)]);
    const to = memoryHome();
    let puts = 0;
    const put = to.put;
    to.put = async item => { if (++puts === 2) throw new Error('down'); return put(item); };
    expect(await moveStudyBlocks(from, to, RANGE)).toEqual({ total: 3, moved: 1, complete: false });
    expect([...from.blocks.keys()]).toEqual([block(2).id, block(3).id]);
    expect([...to.blocks.keys()]).toEqual([block(1).id]);
    expect(await moveStudyBlocks(from, to, RANGE)).toEqual({ total: 2, moved: 2, complete: true });
    expect([...to.blocks.keys()].sort()).toEqual([block(1).id, block(2).id, block(3).id]);
  });
});

describe('Google as the study-block home', () => {
  it('lists only this owner’s study blocks, never personal events', async () => {
    await home.put(block(1));
    expect(await home.listOwnBlocks(RANGE)).toEqual([block(1)]);
  });

  it('writes the block under its existing ID with completion intact', async () => {
    await home.put(block(1, { completion: 'done' }));
    const stored = google.events.get(block(1).id)!;
    expect(stored.summary).toBe('✓ Sheet 1');
    expect(stored.extendedProperties?.private).toMatchObject({ polymateOwner: OWNER, polymateKind: 'study-block', polymateCompletion: 'done' });
    expect(await home.listOwnBlocks(RANGE)).toEqual([block(1, { completion: 'done' })]);
  });

  it('treats a block copied by an earlier attempt as done', async () => {
    await home.put(block(1));
    const etag = google.events.get(block(1).id)!.etag;
    await home.put(block(1));
    expect(google.events.get(block(1).id)!.etag).toBe(etag);
  });

  it('restores a block Google kept as deleted from an earlier move', async () => {
    await home.put(block(1));
    await home.remove(block(1).id);
    expect(google.events.get(block(1).id)!.status).toBe('cancelled');
    await home.put(block(1, { title: 'Moved back' }));
    expect(google.events.get(block(1).id)).toMatchObject({ status: 'confirmed', summary: 'Moved back' });
    expect(await home.listOwnBlocks(RANGE)).toEqual([block(1, { title: 'Moved back' })]);
  });

  it('refuses to take over an ID that belongs to someone else', async () => {
    google.seed({ ...newStudyBlockEvent(block(1), 'another-owner', 'x'), id: block(1).id });
    await expect(home.put(block(1))).rejects.toThrow();
    await expect(home.remove(block(1).id)).rejects.toThrow();
    expect(google.events.get(block(1).id)!.status).toBeUndefined();
  });

  it('reports a Google failure so the block is not removed from the old calendar', async () => {
    const from = memoryHome([block(1)]);
    google.failNext = 'POST';
    expect(await moveStudyBlocks(from, home, RANGE)).toMatchObject({ moved: 0, complete: false });
    expect(from.blocks.has(block(1).id)).toBe(true);
  });
});
