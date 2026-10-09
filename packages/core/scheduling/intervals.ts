export type Interval = Readonly<{ startAt: string; endAt: string }>;

/** Half-open intervals: a block ending at 10:00 does not overlap one starting at 10:00. */
export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(b.startAt) < Date.parse(a.endAt);
}

export function findConflicts<T extends Interval>(candidate: Interval, busy: readonly T[]): T[] {
  return busy.filter(item => intervalsOverlap(candidate, item));
}
