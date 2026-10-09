import { describe, expect, it } from 'vitest';
import {
  parseCreateRequest, parseDateRange, parseStudyBlockChanges, parseStudyBlockInput, proposeStudyBlock,
} from '../packages/contracts/src/calendar';
import { shiftWeek, weekRange, zonedDateKey, zonedParts, zonedTimeToInstant } from '../packages/contracts/src/time';
import { intervalsOverlap } from '../packages/core/scheduling/intervals';

describe('Zurich time helpers', () => {
  it('starts weeks on Monday midnight in Zurich, in summer and winter time', () => {
    expect(weekRange(new Date('2026-10-09T12:00:00Z'))).toEqual({
      from: '2026-10-04T22:00:00.000Z', to: '2026-10-11T22:00:00.000Z',
    });
    // Sunday late evening UTC is already Monday in Zurich.
    expect(weekRange(new Date('2026-12-06T23:30:00Z')).from).toBe('2026-12-06T23:00:00.000Z');
  });

  it('keeps a seven-day week across the October DST change', () => {
    const week = weekRange(new Date('2026-10-22T10:00:00Z'));
    expect(week).toEqual({ from: '2026-10-18T22:00:00.000Z', to: '2026-10-25T23:00:00.000Z' });
    expect(shiftWeek(week, 1).from).toBe('2026-10-25T23:00:00.000Z');
    expect(shiftWeek(week, -1).from).toBe('2026-10-11T22:00:00.000Z');
  });

  it('converts wall-clock times both ways', () => {
    const instant = zonedTimeToInstant({ year: 2026, month: 3, day: 29, hour: 9, minute: 30 });
    expect(instant.toISOString()).toBe('2026-03-29T07:30:00.000Z');
    expect(zonedParts(instant)).toMatchObject({ hour: 9, minute: 30, weekday: 7 });
    expect(zonedDateKey('2026-10-09T22:30:00Z')).toBe('2026-10-10');
  });
});

describe('calendar contract validation', () => {
  const block = { title: '  Analysis   sheet 3 ', startAt: '2026-10-12T10:00:00+02:00', endAt: '2026-10-12T10:50:00+02:00' };

  it('normalizes a valid study block', () => {
    expect(parseStudyBlockInput(block)).toEqual({
      title: 'Analysis sheet 3', startAt: '2026-10-12T08:00:00.000Z', endAt: '2026-10-12T08:50:00.000Z',
    });
    expect(proposeStudyBlock('2026-10-12T08:00:00Z').endAt).toBe('2026-10-12T08:50:00.000Z');
  });

  it('rejects unsafe or nonsensical input', () => {
    expect(() => parseStudyBlockInput({ ...block, endAt: block.startAt })).toThrow(/end after/);
    expect(() => parseStudyBlockInput({ ...block, endAt: '2026-10-12T10:05:00+02:00' })).toThrow(/at least/);
    expect(() => parseStudyBlockInput({ ...block, startAt: '2026-10-12T10:00:00' })).toThrow(/offset/);
    expect(() => parseStudyBlockInput({ ...block, title: ' ' })).toThrow(/title/);
    expect(() => parseStudyBlockInput({ ...block, ownerId: 'someone-else' })).toThrow(/unsupported/);
    expect(() => parseStudyBlockChanges({ startAt: block.startAt })).toThrow(/together/);
    expect(() => parseStudyBlockChanges({})).toThrow(/Nothing/);
    expect(() => parseCreateRequest({ operationId: 'not-a-uuid', block })).toThrow(/UUID/);
    expect(() => parseDateRange({ from: '2026-10-01T00:00:00Z', to: '2027-01-01T00:00:00Z' })).toThrow(/at most/);
  });

  it('treats touching intervals as free', () => {
    const a = { startAt: '2026-10-12T08:00:00Z', endAt: '2026-10-12T09:00:00Z' };
    expect(intervalsOverlap(a, { startAt: '2026-10-12T09:00:00Z', endAt: '2026-10-12T10:00:00Z' })).toBe(false);
    expect(intervalsOverlap(a, { startAt: '2026-10-12T08:59:00Z', endAt: '2026-10-12T10:00:00Z' })).toBe(true);
  });
});
