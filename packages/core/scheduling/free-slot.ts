import { addZonedDays, startOfZonedDay, zonedParts, zonedTimeToInstant } from '@polymate/contracts/time';
import { freeStudyGaps } from './allocator';
import type { Interval } from './intervals';

export const SLOT_DAY_START_HOUR = 8;
export const SLOT_DAY_END_HOUR = 22;
const QUARTER_HOUR = 15 * 60_000;

/**
 * The nearest free interval of `durationMs` that starts at or after `notBefore` and ends by `notAfter`,
 * inside waking hours (08:00–22:00 Zurich) on a single day. Starts are rounded up to a quarter hour.
 * Returns null when no day in range has a gap that long.
 */
export function findFreeSlot(input: { durationMs: number; notBefore: Date; notAfter: Date; busy: readonly Interval[] }): Interval | null {
  const { durationMs, notBefore, notAfter, busy } = input;
  if (durationMs <= 0 || durationMs > (SLOT_DAY_END_HOUR - SLOT_DAY_START_HOUR) * 3_600_000) return null;
  const first = startOfZonedDay(notBefore);
  for (let day = 0; ; day++) {
    const date = addZonedDays(first, day);
    if (date.getTime() >= notAfter.getTime()) return null;
    const p = zonedParts(date);
    const open = zonedTimeToInstant({ year: p.year, month: p.month, day: p.day, hour: SLOT_DAY_START_HOUR }).getTime();
    const close = zonedTimeToInstant({ year: p.year, month: p.month, day: p.day, hour: SLOT_DAY_END_HOUR }).getTime();
    const from = Math.max(open, notBefore.getTime());
    const to = Math.min(close, notAfter.getTime());
    if (to - from < durationMs) continue;
    for (const [gapStart, gapEnd] of freeStudyGaps({ startAt: new Date(from).toISOString(), endAt: new Date(to).toISOString() }, busy)) {
      const start = Math.ceil(gapStart / QUARTER_HOUR) * QUARTER_HOUR;
      if (start + durationMs <= gapEnd) return { startAt: new Date(start).toISOString(), endAt: new Date(start + durationMs).toISOString() };
    }
  }
}
