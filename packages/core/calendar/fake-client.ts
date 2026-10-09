import {
  validateStudyInterval, type CalendarClient, type CalendarEvent, type OperationResult, type StudyBlockChanges, type StudyBlockInput,
} from '@polymate/contracts/calendar';
import { CALENDAR_TIMEZONE, weekRange, zonedParts, zonedTimeToInstant, type DateRange } from '@polymate/contracts/time';
import { findConflicts, intervalsOverlap } from '../scheduling/intervals';

/**
 * In-memory CalendarClient for local development and component work. It follows the same rules
 * as the Google service but talks to nothing. Never use it as release or Google evidence.
 */
export const FAKE_CALENDAR_LABEL = 'Sample data — not connected to Google Calendar';

type Seed = { day: number; start: [number, number]; end: [number, number]; title: string; polymate?: boolean; done?: boolean; allDay?: boolean };

const SAMPLE_WEEK: Seed[] = [
  { day: 0, start: [10, 15], end: [12, 0], title: 'Analysis I lecture' },
  { day: 0, start: [14, 0], end: [14, 50], title: 'Linear Algebra: exercise sheet 3', polymate: true, done: true },
  { day: 1, start: [8, 15], end: [10, 0], title: 'Discrete Mathematics' },
  { day: 1, start: [12, 0], end: [13, 0], title: 'Lunch with Mia' },
  { day: 1, start: [16, 0], end: [16, 50], title: 'Analysis I: review proofs', polymate: true },
  { day: 2, start: [0, 0], end: [0, 0], title: 'Lab report due', allDay: true },
  { day: 2, start: [13, 15], end: [15, 0], title: 'Physics exercise class' },
  { day: 2, start: [13, 45], end: [14, 30], title: 'Study group (tentative)' },
  { day: 3, start: [9, 0], end: [9, 50], title: 'Discrete Mathematics: problem set', polymate: true },
  { day: 4, start: [17, 30], end: [19, 0], title: 'Climbing' },
];

/** Sample events for the week containing `now`, shared by fixture-backed components and tests. */
export function sampleWeekEvents(now: Date = new Date()): CalendarEvent[] {
  const monday = zonedParts(weekRange(now).from);
  return SAMPLE_WEEK.map((seed, index) => {
    const day = monday.day + seed.day;
    const startAt = zonedTimeToInstant({ year: monday.year, month: monday.month, day, hour: seed.start[0], minute: seed.start[1] });
    const endAt = seed.allDay
      ? zonedTimeToInstant({ year: monday.year, month: monday.month, day: day + 1 })
      : zonedTimeToInstant({ year: monday.year, month: monday.month, day, hour: seed.end[0], minute: seed.end[1] });
    return {
      id: `sample${index}`,
      title: seed.title,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      timezone: CALENDAR_TIMEZONE,
      allDay: Boolean(seed.allDay),
      source: seed.polymate ? 'polymate' : 'google-personal',
      editable: Boolean(seed.polymate),
      completion: seed.done ? 'done' : 'open',
      etag: '"1"',
    } satisfies CalendarEvent;
  });
}

export class FakeCalendarClient implements CalendarClient {
  readonly label = FAKE_CALENDAR_LABEL;
  private readonly events = new Map<string, CalendarEvent>();
  private readonly results = new Map<string, OperationResult>();
  private version = 1;

  constructor(seed: CalendarEvent[] = sampleWeekEvents(), private readonly latencyMs = 0) {
    for (const event of seed) this.events.set(event.id, event);
  }

  async listWeek(range: DateRange): Promise<CalendarEvent[]> {
    await this.pause();
    return [...this.events.values()]
      .filter(event => intervalsOverlap(event, { startAt: range.from, endAt: range.to }))
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  createStudyBlock(input: StudyBlockInput, operationId: string): Promise<OperationResult> {
    return this.once(operationId, () => {
      validateStudyInterval(input.startAt, input.endAt);
      this.assertFree(input, null);
      return this.save({
        id: `pm${operationId.replace(/-/g, '')}`, title: input.title, startAt: input.startAt, endAt: input.endAt,
        timezone: CALENDAR_TIMEZONE, allDay: false, source: 'polymate', editable: true, completion: 'open', etag: '',
      });
    });
  }

  updateStudyBlock(id: string, changes: StudyBlockChanges, expectedEtag: string, operationId: string): Promise<OperationResult> {
    return this.once(operationId, () => {
      const current = this.owned(id, expectedEtag);
      const next = { ...current, ...changes };
      validateStudyInterval(next.startAt, next.endAt);
      this.assertFree(next, id);
      return this.save(next);
    });
  }

  completeStudyBlock(id: string, expectedEtag: string, operationId: string): Promise<OperationResult> {
    return this.once(operationId, () => this.save({ ...this.owned(id, expectedEtag), completion: 'done' }));
  }

  deleteStudyBlock(id: string, expectedEtag: string, operationId: string): Promise<OperationResult> {
    return this.once(operationId, () => {
      this.owned(id, expectedEtag);
      this.events.delete(id);
      return undefined;
    });
  }

  private async once(operationId: string, change: () => CalendarEvent | undefined): Promise<OperationResult> {
    await this.pause();
    const previous = this.results.get(operationId);
    if (previous) return previous;
    let result: OperationResult;
    try {
      const event = change();
      result = { operationId, status: 'synced', ...(event ? { event } : {}) };
    } catch (error) {
      const [code, message] = error instanceof FakeError ? [error.code, error.message] : ['validation' as const, (error as Error).message];
      result = { operationId, status: 'failed', error: { code, message } };
    }
    this.results.set(operationId, result);
    return result;
  }

  private owned(id: string, expectedEtag: string): CalendarEvent {
    const current = this.events.get(id);
    if (!current) throw new FakeError('not_found', 'This study block no longer exists.');
    if (!current.editable) throw new FakeError('forbidden', 'Only PolyMate study blocks can be changed.');
    if (current.etag !== expectedEtag) throw new FakeError('conflict', 'This block changed since you opened it.');
    return current;
  }

  private assertFree(candidate: { startAt: string; endAt: string }, ownId: string | null): void {
    const busy = [...this.events.values()].filter(event => event.id !== ownId);
    const [first] = findConflicts(candidate, busy);
    if (first) throw new FakeError('overlap', `This time overlaps “${first.title}”.`);
  }

  private save(event: CalendarEvent): CalendarEvent {
    const saved = { ...event, etag: `"${++this.version}"` };
    this.events.set(saved.id, saved);
    return saved;
  }

  private pause(): Promise<void> {
    return this.latencyMs ? new Promise(resolve => setTimeout(resolve, this.latencyMs)) : Promise.resolve();
  }
}

class FakeError extends Error {
  constructor(readonly code: 'not_found' | 'forbidden' | 'conflict' | 'overlap', message: string) {
    super(message);
  }
}
