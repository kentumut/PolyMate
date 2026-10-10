import type { CalendarEvent } from '@polymate/contracts/calendar';
import { addZonedDays, CALENDAR_TIMEZONE, zonedDateKey, zonedParts, zonedTimeToInstant, type DateRange } from '@polymate/contracts/time';

export type WeekDay = Readonly<{ key: string; start: string; end: string; weekday: string; dayOfMonth: number }>;

/** Anything with a time span: Google events and proposed plan blocks share one layout. */
export type TimedItem = Readonly<{ id: string; startAt: string; endAt: string; allDay: boolean }>;

export type PlacedEvent<T extends TimedItem = CalendarEvent> = Readonly<{
  event: T;
  /** Percentages of the visible hour span and of the day column. */
  top: number;
  height: number;
  left: number;
  width: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}>;

export const DEFAULT_HOURS = { start: 8, end: 20 } as const;
export const CALENDAR_SNAP_MINUTES = 15;
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

function whenLabel(item: TimedItem): string {
  return item.allDay ? `all day ${formatDay(item.startAt)}` : `${formatDay(item.startAt)}, ${formatTime(item.startAt)} to ${formatTime(item.endAt)}`;
}

export function eventLabel(event: CalendarEvent, assignmentTitle?: string): string {
  const kind = event.source === 'polymate' ? 'Study block' : 'Personal event, read-only';
  const assignment = assignmentTitle ? `, for ${assignmentTitle}` : '';
  return `${kind}: ${event.title}${assignment}, ${whenLabel(event)}${event.completion === 'done' ? ', done' : ''}`;
}

const proposedStatus = { proposed: 'not in Google Calendar yet', unknown: 'apply uncertain, check the plan', failed: 'could not be added' } as const;

export function proposedLabel(block: Readonly<TimedItem & { title: string; status: keyof typeof proposedStatus }>): string {
  return `Proposed study block: ${block.title}, ${whenLabel(block)}, ${proposedStatus[block.status]}`;
}

/** Visible hours: the default working day, widened to fit every timed event this week. */
export function visibleHours(events: readonly TimedItem[], days: readonly WeekDay[]): { start: number; end: number } {
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
export function placeDayEvents<T extends TimedItem>(events: readonly T[], day: WeekDay, hours: { start: number; end: number }): PlacedEvent<T>[] {
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

export function allDayEventsFor<T extends TimedItem>(events: readonly T[], day: WeekDay): T[] {
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

export function durationMinutes(event: TimedItem): number {
  return Math.round((Date.parse(event.endAt) - Date.parse(event.startAt)) / MINUTE);
}

/** Convert a pointer's vertical position in the time grid to a snapped wall-clock minute. */
export function snappedGridMinute(offsetY: number, height: number, hours: { start: number; end: number }): number {
  const span = (hours.end - hours.start) * 60;
  const raw = hours.start * 60 + (Math.max(0, Math.min(offsetY, height)) / Math.max(height, 1)) * span;
  return Math.max(hours.start * 60, Math.min(hours.end * 60, Math.round(raw / CALENDAR_SNAP_MINUTES) * CALENDAR_SNAP_MINUTES));
}

/** Resolve a dragged wall-clock range to transport instants in the calendar timezone. */
export function calendarSelectionRange(day: WeekDay, anchorMinute: number, focusMinute: number): { startAt: string; endAt: string } {
  const startMinute = Math.min(anchorMinute, focusMinute);
  const endMinute = anchorMinute === focusMinute ? startMinute + 50 : Math.max(anchorMinute, focusMinute);
  const parts = zonedParts(day.start);
  const instant = (minute: number) => zonedTimeToInstant({
    year: parts.year, month: parts.month, day: parts.day,
    hour: Math.floor(minute / 60), minute: minute % 60,
  }).toISOString();
  return { startAt: instant(startMinute), endAt: instant(endMinute) };
}
