/** All calendar display and week boundaries use Zurich wall-clock time; transport stays in ISO instants. */
export const CALENDAR_TIMEZONE = 'Europe/Zurich';

export type DateRange = Readonly<{ from: string; to: string }>;

export type ZonedParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
}>;

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function zonedParts(instant: Date | string, timeZone = CALENDAR_TIMEZONE): ZonedParts {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const parts: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) parts[part.type] = part.value;
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), weekday: WEEKDAYS[parts.weekday] ?? 1,
  };
}

function offsetAt(epochMs: number, timeZone: string): number {
  const p = zonedParts(new Date(epochMs), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(epochMs / 60_000) * 60_000;
}

/** Converts a Zurich wall-clock time to an instant. Day/month overflow is normalized like Date.UTC. */
export function zonedTimeToInstant(
  local: { year: number; month: number; day: number; hour?: number; minute?: number },
  timeZone = CALENDAR_TIMEZONE,
): Date {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour ?? 0, local.minute ?? 0);
  const first = wall - offsetAt(wall, timeZone);
  const second = wall - offsetAt(first, timeZone);
  return new Date(second);
}

/** Calendar date (YYYY-MM-DD) of an instant in Zurich. */
export function zonedDateKey(instant: Date | string, timeZone = CALENDAR_TIMEZONE): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function startOfZonedDay(instant: Date | string, timeZone = CALENDAR_TIMEZONE): Date {
  const p = zonedParts(instant, timeZone);
  return zonedTimeToInstant({ year: p.year, month: p.month, day: p.day }, timeZone);
}

/** Adds whole Zurich calendar days, keeping the wall-clock time across DST changes. */
export function addZonedDays(instant: Date | string, days: number, timeZone = CALENDAR_TIMEZONE): Date {
  const p = zonedParts(instant, timeZone);
  return zonedTimeToInstant({ year: p.year, month: p.month, day: p.day + days, hour: p.hour, minute: p.minute }, timeZone);
}

/** Monday 00:00 to the following Monday 00:00 in Zurich for the week containing `instant`. */
export function weekRange(instant: Date | string = new Date(), timeZone = CALENDAR_TIMEZONE): DateRange {
  const p = zonedParts(instant, timeZone);
  const from = zonedTimeToInstant({ year: p.year, month: p.month, day: p.day - (p.weekday - 1) }, timeZone);
  return { from: from.toISOString(), to: addZonedDays(from, 7, timeZone).toISOString() };
}

export function shiftWeek(range: DateRange, weeks: number, timeZone = CALENDAR_TIMEZONE): DateRange {
  return weekRange(addZonedDays(range.from, weeks * 7, timeZone), timeZone);
}
