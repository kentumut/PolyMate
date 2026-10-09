import type { CalendarEvent } from '@polymate/contracts/calendar';
import { addZonedDays, CALENDAR_TIMEZONE, zonedDateKey, zonedParts, type DateRange } from '@polymate/contracts/time';

export type WeekDay = Readonly<{ key: string; start: string; end: string; weekday: string; dayOfMonth: number }>;

export type PlacedEvent = Readonly<{
  event: CalendarEvent;
  /** Percentages of the visible hour span and of the day column. */
  top: number;
  height: number;
  left: number;
  width: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}>;

export const DEFAULT_HOURS = { start: 8, end: 20 } as const;
const MINUTE = 60_000;

const weekdayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TIMEZONE, weekday: 'short' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayMonthFormat = new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TIMEZONE, day: 'numeric', month: 'short' });
const fullDayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TIMEZONE, weekday: 'long', day: 'numeric', month: 'long' });

export function weekDays(range: DateRange): WeekDay[] {
  return Array.from({ length: 7 }, (_, index) => {
    const start = addZonedDays(range.from, index);
    return {
      key: zonedDateKey(start),
      start: start.toISOString(),
      end: addZonedDays(range.from, index + 1).toISOString(),
      weekday: weekdayFormat.format(start),
      dayOfMonth: zonedParts(start).day,
    };
  });
}

export function formatTime(instant: string): string {
  return timeFormat.format(new Date(instant));
}

export function formatDay(instant: string): string {
  return fullDayFormat.format(new Date(instant));
}

/** "12 – 18 Oct 2026", or "28 Sept – 4 Oct 2026" across months. */
export function formatWeekLabel(range: DateRange): string {
  const first = new Date(range.from);
  const last = addZonedDays(range.from, 6);
  const a = zonedParts(first);
  const b = zonedParts(last);
  const start = a.month === b.month ? String(a.day) : dayMonthFormat.format(first);
  return `${start} – ${dayMonthFormat.format(last)} ${b.year}`;
}

export function eventLabel(event: CalendarEvent): string {
  const kind = event.source === 'polymate' ? 'Study block' : 'Personal event, read-only';
  const when = event.allDay ? `all day ${formatDay(event.startAt)}` : `${formatDay(event.startAt)}, ${formatTime(event.startAt)} to ${formatTime(event.endAt)}`;
  return `${kind}: ${event.title}, ${when}${event.completion === 'done' ? ', done' : ''}`;
}

/** Visible hours: the default working day, widened to fit every timed event this week. */
export function visibleHours(events: readonly CalendarEvent[], days: readonly WeekDay[]): { start: number; end: number } {
  let start: number = DEFAULT_HOURS.start;
  let end: number = DEFAULT_HOURS.end;
  for (const event of events) {
    if (event.allDay) continue;
    for (const day of days) {
      const from = Math.max(Date.parse(event.startAt), Date.parse(day.start));
      const to = Math.min(Date.parse(event.endAt), Date.parse(day.end));
      if (from >= to) continue;
      const startHour = zonedParts(new Date(from)).hour;
      const endParts = zonedParts(new Date(to));
      const endHour = to === Date.parse(day.end) ? 24 : endParts.hour + (endParts.minute > 0 ? 1 : 0);
      start = Math.min(start, startHour);
      end = Math.max(end, endHour);
    }
  }
  return { start, end };
}

function minutesIntoDay(instant: number, day: WeekDay): number {
  // Wall-clock minutes, so a 09:00 lecture sits at 09:00 even on DST-change days.
  if (instant >= Date.parse(day.end)) return 24 * 60;
  const parts = zonedParts(new Date(instant));
  return parts.hour * 60 + parts.minute;
}

/** Positions timed events in one day column; overlapping events share the width side by side. */
export function placeDayEvents(events: readonly CalendarEvent[], day: WeekDay, hours: { start: number; end: number }): PlacedEvent[] {
  const dayStart = Date.parse(day.start);
  const dayEnd = Date.parse(day.end);
  const span = (hours.end - hours.start) * 60;
  const items = events
    .filter(event => !event.allDay && Date.parse(event.startAt) < dayEnd && Date.parse(event.endAt) > dayStart)
    .map(event => {
      const from = Math.max(Date.parse(event.startAt), dayStart);
      const to = Math.min(Date.parse(event.endAt), dayEnd);
      const startMin = Math.max(minutesIntoDay(from, day), hours.start * 60);
      const endMin = Math.max(Math.min(minutesIntoDay(to, day), hours.end * 60), startMin + 15);
      return { event, from, to, startMin, endMin, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.event.id.localeCompare(b.event.id));

  // Group transitively overlapping events, then give each the first free lane in its group.
  let group: typeof items = [];
  let groupEnd = -Infinity;
  const closeGroup = () => {
    const lanes = Math.max(1, ...group.map(item => item.lane + 1));
    for (const item of group) item.lanes = lanes;
    group = [];
  };
  for (const item of items) {
    if (item.startMin >= groupEnd) { closeGroup(); groupEnd = -Infinity; }
    const laneEnds: number[] = [];
    for (const other of group) laneEnds[other.lane] = Math.max(laneEnds[other.lane] ?? -Infinity, other.endMin);
    let lane = 0;
    while ((laneEnds[lane] ?? -Infinity) > item.startMin) lane++;
    item.lane = lane;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.endMin);
  }
  closeGroup();

  return items.map(item => ({
    event: item.event,
    top: ((item.startMin - hours.start * 60) / span) * 100,
    height: ((item.endMin - item.startMin) / span) * 100,
    left: (item.lane / item.lanes) * 100,
    width: 100 / item.lanes,
    continuesBefore: item.from > Date.parse(item.event.startAt),
    continuesAfter: item.to < Date.parse(item.event.endAt),
  }));
}

export function allDayEventsFor(events: readonly CalendarEvent[], day: WeekDay): CalendarEvent[] {
  return events.filter(event => event.allDay && Date.parse(event.startAt) < Date.parse(day.end) && Date.parse(event.endAt) > Date.parse(day.start));
}

/** Position of `now` as a percentage of the visible hours, or null when off-screen. */
export function nowOffset(now: Date, day: WeekDay, hours: { start: number; end: number }): number | null {
  const time = now.getTime();
  if (time < Date.parse(day.start) || time >= Date.parse(day.end)) return null;
  const minutes = minutesIntoDay(time, day) - hours.start * 60;
  const span = (hours.end - hours.start) * 60;
  return minutes < 0 || minutes > span ? null : (minutes / span) * 100;
}

export function durationMinutes(event: CalendarEvent): number {
  return Math.round((Date.parse(event.endAt) - Date.parse(event.startAt)) / MINUTE);
}
