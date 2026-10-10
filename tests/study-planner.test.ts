import { describe, expect, it } from 'vitest';
import type { Assignment } from '../packages/contracts/src/assignments';
import type { CalendarEvent } from '../packages/contracts/src/calendar';
import { DEFAULT_STUDY_PREFERENCES, parsePlanningRequest, parseStudyPreferences } from '../packages/contracts/src/planning';
import { assertStudyPlanFits, planStudyWeek } from '../packages/core/scheduling/planner';

const now = new Date('2026-10-12T06:00:00Z'); // Monday, 08:00 Zurich.
const assignment = (id = 'a', remainingMinutes = 150, dueAt = '2026-10-16T16:00:00Z'): Assignment => ({
  id, title: `Sheet ${id}`, dueAt, estimatedMinutes: remainingMinutes, remainingMinutes, status: 'open', version: 1,
});
const event = (startAt: string, endAt: string, source: CalendarEvent['source'] = 'google-personal'): CalendarEvent => ({
  id: 'existing', title: 'Busy', startAt, endAt, source, timezone: 'Europe/Zurich', allDay: false, editable: source === 'polymate', completion: 'open', etag: 'v1',
});
const build = (overrides: Partial<Parameters<typeof planStudyWeek>[0]> = {}) => planStudyWeek({
  assignments: [assignment()], events: [], linkedEvents: [], preferences: DEFAULT_STUDY_PREFERENCES, now,
  planId: 'preview', operationId: index => `op-${index}`, ...overrides,
});

describe('deterministic seven-day study planning', () => {
  it('spreads larger work across permitted days, respects deadlines, and is deterministic', () => {
    const plan = build();
    expect(plan).toEqual(build());
    expect(plan.blocks.map(block => block.startAt)).toEqual(['2026-10-12T07:00:00.000Z', '2026-10-13T07:00:00.000Z', '2026-10-14T07:00:00.000Z']);
    expect(plan.blocks.every(block => Date.parse(block.endAt) <= Date.parse(assignment().dueAt))).toBe(true);
    expect(plan.unscheduled).toEqual([]);
  });

  it('subtracts overlapping commitments and leaves breaks between different assignments', () => {
    const plan = build({ assignments: [assignment('b', 50, '2026-10-12T16:00:00Z'), assignment('a', 50, '2026-10-12T16:00:00Z')],
      events: [event('2026-10-12T07:00:00Z', '2026-10-12T08:00:30Z'), event('2026-10-12T07:30:00Z', '2026-10-12T08:30:30Z')] });
    expect(plan.blocks.map(block => [block.assignmentId, block.startAt])).toEqual([
      ['a', '2026-10-12T08:31:00.000Z'], ['b', '2026-10-12T09:31:00.000Z'],
    ]);
    expect(plan.unscheduled).toEqual([]);
  });

  it('counts existing study blocks against daily and weekly capacity and keeps them in place', () => {
    const existing = event('2026-10-12T07:00:00Z', '2026-10-12T07:50:00Z', 'polymate');
    const plan = build({ assignments: [assignment('a', 150, '2026-10-12T16:00:00Z')], events: [existing],
      preferences: { ...DEFAULT_STUDY_PREFERENCES, dailyMinutes: 100, weeklyMinutes: 100 } });
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].startAt).toBe('2026-10-12T08:00:00.000Z');
    expect(plan.unscheduled[0].remainingMinutes).toBe(100);
    expect(existing.endAt).toBe('2026-10-12T07:50:00Z');
  });

  it('deducts current linked work so a second generation does not duplicate already planned effort', () => {
    const existing = event('2026-10-12T07:00:00Z', '2026-10-12T07:50:00Z', 'polymate');
    expect(build({ assignments: [assignment('a', 50)], events: [existing], linkedEvents: [{ assignmentId: 'a', event: existing }] }))
      .toMatchObject({ blocks: [], unscheduled: [], preservedMinutes: 50 });
    expect(build({ assignments: [{ ...assignment(), status: 'completed' }] }).blocks).toEqual([]);
  });

  it('reports expired deadlines and tiny remainders instead of inventing feasible time', () => {
    const plan = build({ assignments: [assignment('past', 100, '2026-10-11T12:00:00Z'), assignment('small', 51)] });
    expect(plan.unscheduled).toEqual([
      expect.objectContaining({ assignmentId: 'past', remainingMinutes: 100, reason: 'Deadline has passed.' }),
      expect.objectContaining({ assignmentId: 'small', remainingMinutes: 1 }),
    ]);
    expect(plan.blocks).toHaveLength(1);
  });

  it('handles Zurich DST boundaries using wall-clock study windows and all-day busy intervals', () => {
    const plan = build({ now: new Date('2026-10-24T06:00:00Z'), assignments: [assignment('a', 100, '2026-10-26T18:00:00Z')],
      preferences: { ...DEFAULT_STUDY_PREFERENCES, weekdays: [6, 7, 1] } });
    expect(plan.blocks.map(block => block.startAt)).toEqual(['2026-10-24T07:00:00.000Z', '2026-10-25T08:00:00.000Z']);
    const blocked = build({ assignments: [assignment('a', 50, '2026-10-12T16:00:00Z')],
      events: [{ ...event('2026-10-11T22:00:00Z', '2026-10-12T22:00:00Z'), allDay: true }] });
    expect(blocked.blocks).toEqual([]);
    expect(blocked.unscheduled[0].remainingMinutes).toBe(50);
  });

  it('rejects fresh conflicts, new break violations, and changed capacity before applying exact times', () => {
    const plan = build({ assignments: [assignment('a', 50)] });
    expect(() => assertStudyPlanFits(plan, [event('2026-10-12T07:10:00Z', '2026-10-12T08:10:00Z')], plan.blocks)).toThrow('commitments changed');
    expect(() => assertStudyPlanFits(plan, [event('2026-10-12T06:20:00Z', '2026-10-12T06:55:00Z', 'polymate')], plan.blocks)).toThrow('study break');
    expect(() => assertStudyPlanFits({ ...plan, preferences: { ...plan.preferences, dailyMinutes: 60 } },
      [event('2026-10-12T10:00:00Z', '2026-10-12T10:50:00Z', 'polymate')], plan.blocks)).toThrow('Daily study capacity');
  });

  it('asks for different hours when a Zurich window boundary is missing or repeated during DST', () => {
    for (const [clock, due] of [['2026-03-28T06:00:00Z', '2026-03-30T16:00:00Z'], ['2026-10-24T06:00:00Z', '2026-10-26T16:00:00Z']]) {
      expect(() => build({ now: new Date(clock), assignments: [assignment('a', 50, due)],
        preferences: { ...DEFAULT_STUDY_PREFERENCES, weekdays: [7], startTime: '02:30', endTime: '04:00' } })).toThrow('missing or repeated');
    }
  });

  it('does not allow caller-supplied blocks, identities, or unconfirmed preferences', () => {
    expect(() => parsePlanningRequest({ action: 'apply', planId: crypto.randomUUID(), allowPartial: true, blocks: [] })).toThrow();
    expect(() => parsePlanningRequest({ action: 'apply', planId: crypto.randomUUID() })).toThrow();
    for (const change of [{ weekdays: [] }, { weekdays: [1, 1] }, { startTime: '18:00', endTime: '09:00' }, { dailyMinutes: 0 }, { ownerId: 'other' }]) {
      expect(() => parseStudyPreferences({ ...DEFAULT_STUDY_PREFERENCES, ...change })).toThrow();
    }
  });
});
