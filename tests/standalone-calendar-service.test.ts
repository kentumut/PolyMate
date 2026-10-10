import { beforeEach, describe, expect, it } from 'vitest';
import type { CalendarEvent, StudyBlockChanges, StudyBlockInput } from '@polymate/contracts/calendar';
import type { DateRange } from '@polymate/contracts/time';
import type { OwnerContext } from '../packages/core/src/identity';
import { StandaloneCalendarService, type StandaloneEventStore } from '../packages/core/calendar/standalone-service';
import { MemoryOperationStore } from '../packages/core/calendar/operations';

const owner: OwnerContext = { userId: '11111111-2222-5333-a444-555555555555', externalId: 'student', displayName: 'Student' };
const operation = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const block = { title: 'Study locally', startAt: '2026-10-12T10:00:00.000Z', endAt: '2026-10-12T10:50:00.000Z' };

class MemoryEvents implements StandaloneEventStore {
  events = new Map<string, CalendarEvent>();
  version = 0;
  async ensureOwner() {}
  async list(_ownerId: string, range: DateRange) { return [...this.events.values()].filter(event => event.startAt < range.to && event.endAt > range.from); }
  async find(_ownerId: string, id: string) { return this.events.get(id) ?? null; }
  async create(_owner: OwnerContext, id: string, input: StudyBlockInput) {
    if (this.events.has(id)) return null;
    return this.save({ id, ...input, timezone: 'Europe/Zurich', allDay: false, source: 'polymate', editable: true, completion: 'open', etag: '' });
  }
  async update(_ownerId: string, id: string, changes: StudyBlockChanges, expectedVersion: number) {
    const current = this.events.get(id); if (!current || current.etag !== `"${expectedVersion}"`) return null;
    return this.save({ ...current, ...changes });
  }
  async complete(_ownerId: string, id: string, expectedVersion: number) {
    const current = this.events.get(id); if (!current || current.etag !== `"${expectedVersion}"`) return null;
    return this.save({ ...current, completion: 'done' });
  }
  async delete(_ownerId: string, id: string, expectedVersion: number) {
    const current = this.events.get(id); if (!current || current.etag !== `"${expectedVersion}"`) return false;
    return this.events.delete(id);
  }
  private save(event: CalendarEvent) { const saved = { ...event, etag: `"${++this.version}"` }; this.events.set(saved.id, saved); return saved; }
}

let events: MemoryEvents;
let service: StandaloneCalendarService;
beforeEach(() => { events = new MemoryEvents(); service = new StandaloneCalendarService(owner, events, new MemoryOperationStore()); });

describe('standalone calendar service', () => {
  it('supports persistent-calendar CRUD without a Google adapter', async () => {
    const created = await service.createStudyBlock(block, operation(1));
    expect(created).toMatchObject({ status: 'synced', event: { title: block.title, source: 'polymate' } });
    const moved = await service.updateStudyBlock(created.event!.id, { startAt: '2026-10-12T12:00:00.000Z', endAt: '2026-10-12T12:50:00.000Z' }, created.event!.etag, operation(2));
    expect(moved).toMatchObject({ status: 'synced', event: { startAt: '2026-10-12T12:00:00.000Z' } });
    const done = await service.completeStudyBlock(moved.event!.id, moved.event!.etag, operation(3));
    expect(done.event?.completion).toBe('done');
    expect(await service.getStudyBlock(done.event!.id)).toEqual(done.event);
    expect(await service.listBusy({ from: '2026-10-12T00:00:00.000Z', to: '2026-10-13T00:00:00.000Z' })).toContainEqual(done.event);
    expect(await service.deleteStudyBlock(done.event!.id, done.event!.etag, operation(4))).toMatchObject({ status: 'synced' });
    expect(events.events.size).toBe(0);
  });

  it('rejects overlaps and stale versions', async () => {
    const created = await service.createStudyBlock(block, operation(1));
    expect((await service.createStudyBlock({ ...block, title: 'Overlap' }, operation(2))).error?.code).toBe('overlap');
    expect((await service.updateStudyBlock(created.event!.id, { title: 'Changed' }, '"999"', operation(3))).error?.code).toBe('conflict');
  });

  it('ignores an unavailable optional Google overlay', async () => {
    service = new StandaloneCalendarService(owner, events, new MemoryOperationStore(), async () => { throw new Error('Google unavailable'); });
    await service.createStudyBlock(block, operation(1));
    expect(await service.listWeek({ from: '2026-10-12T00:00:00.000Z', to: '2026-10-13T00:00:00.000Z' })).toHaveLength(1);
  });
});
