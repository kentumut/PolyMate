import type { Interval } from './intervals';

/** Shared deterministic slot allocation for manual assignments and Moodle tools. */
export function freeStudyGaps(window: Interval, busy: readonly Interval[]): [number, number][] {
  let cursor = Date.parse(window.startAt);
  const limit = Date.parse(window.endAt);
  const gaps: [number, number][] = [];
  for (const event of [...busy].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))) {
    const start = Date.parse(event.startAt), end = Date.parse(event.endAt);
    if (end <= cursor || start >= limit) continue;
    if (start > cursor) gaps.push([cursor, Math.min(start, limit)]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < limit) gaps.push([cursor, limit]);
  return gaps;
}
