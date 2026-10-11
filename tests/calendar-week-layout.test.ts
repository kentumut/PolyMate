import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../packages/contracts/src/calendar';
import { weekRange } from '../packages/contracts/src/time';
import { sampleWeekEvents } from '../packages/core/calendar/fake-client';
import {
  allDayEventsFor, calendarSelectionRange, daysWithItems, fittedHours, formatWeekLabel, nowOffset, placeDayEvents, snappedGridMinute, visibleHours, weekDays,
} from '../apps/web/components/calendar/week-layout';

const range = weekRange(new Date('2026-10-09T12:00:00Z'));
const days = weekDays(range);
const event = (id: string, startAt: string, endAt: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id, title: id, startAt, endAt, timezone: 'Europe/Zurich', allDay: false, source: 'google-personal',
  editable: false, completion: 'open', etag: '"1"', ...extra,
});

describe('week layout', () => {
  it('lists Monday to Sunday in Zurich and labels the week', () => {
    expect(days.map(day => `${day.weekday} ${day.dayOfMonth}`)).toEqual(['Mon 5', 'Tue 6', 'Wed 7', 'Thu 8', 'Fri 9', 'Sat 10', 'Sun 11']);
    expect(formatWeekLabel(range)).toBe('5 – 11 Oct 2026');
    expect(formatWeekLabel(weekRange(new Date('2026-09-30T12:00:00Z')))).toBe('28 Sept – 4 Oct 2026');
  });

  it('places events by Zurich wall-clock time', () => {
    const lecture = event('lecture', '2026-10-05T08:15:00Z', '2026-10-05T10:00:00Z'); // 10:15–12:00 Zurich
    const [placed] = placeDayEvents([lecture], days[0], { start: 8, end: 20 });
    expect(placed.top).toBeCloseTo((135 / 720) * 100);
    expect(placed.height).toBeCloseTo((105 / 720) * 100);
    expect(placed.width).toBe(100);
  });

  it('puts overlapping events side by side and reuses free lanes', () => {
    const a = event('a', '2026-10-07T11:00:00Z', '2026-10-07T13:00:00Z');
    const b = event('b', '2026-10-07T11:30:00Z', '2026-10-07T12:30:00Z');
    const c = event('c', '2026-10-07T12:30:00Z', '2026-10-07T13:30:00Z');
    const d = event('d', '2026-10-07T15:00:00Z', '2026-10-07T16:00:00Z');
    const placed = Object.fromEntries(placeDayEvents([a, b, c, d], days[2], { start: 8, end: 20 }).map(p => [p.event.id, p]));
    expect([placed.a.left, placed.b.left, placed.c.left]).toEqual([0, 50, 50]);
    expect(placed.a.width).toBe(50);
    expect(placed.d).toMatchObject({ left: 0, width: 100 });
  });

  it('splits overnight events across days and widens visible hours', () => {
    const night = event('night', '2026-10-05T20:00:00Z', '2026-10-06T06:00:00Z'); // 22:00 → 08:00
    expect(visibleHours([night], days)).toEqual({ start: 0, end: 24 });
    const [monday] = placeDayEvents([night], days[0], { start: 0, end: 24 });
    const [tuesday] = placeDayEvents([night], days[1], { start: 0, end: 24 });
    expect(monday).toMatchObject({ continuesBefore: false, continuesAfter: true });
    expect(monday.top + monday.height).toBeCloseTo(100);
    expect(tuesday).toMatchObject({ top: 0, continuesBefore: true, continuesAfter: false });
  });

  it('keeps all-day events out of the time grid', () => {
    const events = sampleWeekEvents(new Date('2026-10-09T12:00:00Z'));
    const wednesday = days[2];
    expect(allDayEventsFor(events, wednesday).map(e => e.title)).toEqual(['Lab report due']);
    expect(placeDayEvents(events, wednesday, { start: 8, end: 20 }).some(p => p.event.allDay)).toBe(false);
    expect(visibleHours(events, days)).toEqual({ start: 8, end: 20 });
  });

  it('shows the now line only on today within visible hours', () => {
    const now = new Date('2026-10-09T10:30:00Z'); // Friday 12:30 Zurich
    expect(nowOffset(now, days[4], { start: 8, end: 20 })).toBeCloseTo((270 / 720) * 100);
    expect(nowOffset(now, days[3], { start: 8, end: 20 })).toBeNull();
    expect(nowOffset(new Date('2026-10-09T20:30:00Z'), days[4], { start: 8, end: 20 })).toBeNull();
  });

  it('snaps pointer positions and resolves dragged ranges in Zurich', () => {
    expect(snappedGridMinute(70, 560, { start: 8, end: 18 })).toBe(9 * 60 + 15);
    expect(calendarSelectionRange(days[0], 10 * 60 + 30, 9 * 60)).toEqual({
      startAt: '2026-10-05T07:00:00.000Z', endAt: '2026-10-05T08:30:00.000Z',
    });
  });

  it('keeps only days with blocks and fits the hours around them', () => {
    // Zurich is UTC+2 in October: 10:55–11:55, 12:10–13:10 on Sun 11, 10:00–11:30 and 14:00–15:00 on Mon 12.
    const blocks = [
      event('a', '2026-10-11T08:55:00Z', '2026-10-11T09:55:00Z'), event('b', '2026-10-11T10:10:00Z', '2026-10-11T11:10:00Z'),
      event('c', '2026-10-12T08:00:00Z', '2026-10-12T09:30:00Z'), event('d', '2026-10-12T12:00:00Z', '2026-10-12T13:00:00Z'),
    ];
    const shown = daysWithItems(blocks);
    expect(shown.map(day => `${day.weekday} ${day.dayOfMonth}`)).toEqual(['Sun 11', 'Mon 12']);
    expect(fittedHours(blocks, shown)).toEqual({ start: 10, end: 15 });
    expect(fittedHours([blocks[0]], daysWithItems([blocks[0]]))).toEqual({ start: 9, end: 13 });
    expect(daysWithItems([])).toEqual([]);
  });
});
