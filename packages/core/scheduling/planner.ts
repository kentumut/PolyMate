import type { Assignment } from '@polymate/contracts/assignments';
import { ContractError, type CalendarEvent } from '@polymate/contracts/calendar';
import { parseStudyPreferences, type PlannedBlock, type StudyPlan, type StudyPreferences } from '@polymate/contracts/planning';
import { addZonedDays, startOfZonedDay, zonedDateKey, zonedParts, zonedTimeToInstant } from '@polymate/contracts/time';
import { freeStudyGaps } from './allocator';
import { intervalsOverlap } from './intervals';

const MINUTE = 60_000;
export type LinkedStudyEvent = { assignmentId: string; event: CalendarEvent };

function studyWindowTime(day: ReturnType<typeof zonedParts>, time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  const instant = zonedTimeToInstant({ ...day, hour, minute }).getTime();
  const matches = (value: number) => {
    const parts = zonedParts(new Date(value));
    return parts.year === day.year && parts.month === day.month && parts.day === day.day && parts.hour === hour && parts.minute === minute;
  };
  if (!matches(instant) || matches(instant - 60 * MINUTE) || matches(instant + 60 * MINUTE)) {
    throw new ContractError('A study window crosses a missing or repeated Zurich clock time. Choose different hours for this plan.');
  }
  return instant;
}

/** Pure planner: no model, network, random IDs, or implicit clock. Existing events are never moved. */
export function planStudyWeek(input: {
  assignments: readonly Assignment[]; events: readonly CalendarEvent[]; linkedEvents: readonly LinkedStudyEvent[];
  preferences: StudyPreferences; now: Date; planId: string; operationId: (index: number) => string;
}): StudyPlan {
  const { now, planId, operationId, assignments, events, linkedEvents } = input;
  if (!Number.isFinite(now.getTime())) throw new ContractError('Invalid planning clock.');
  if (assignments.length > 200) throw new ContractError('Plan at most 200 assignments at once.');
  const preferences = parseStudyPreferences(input.preferences);
  const from = new Date(Math.ceil(now.getTime() / MINUTE) * MINUTE);
  const to = addZonedDays(now, 7);
  const blocks: PlannedBlock[] = [], unscheduled: StudyPlan['unscheduled'][number][] = [];
  const existing = events.filter(event => event.source === 'polymate');
  const occupied = events.map(event => ({
    startAt: new Date(Date.parse(event.startAt) - (event.source === 'polymate' ? 10 * MINUTE : 0)).toISOString(),
    endAt: new Date(Date.parse(event.endAt) + (event.source === 'polymate' ? 10 * MINUTE : 0)).toISOString(),
  }));
  // Count study time on each Zurich date, including blocks that cross midnight or the horizon.
  const used = new Map<string, number>();
  let weeklyUsed = 0;
  for (let day = startOfZonedDay(from); day < to; day = addZonedDays(day, 1)) {
    const next = addZonedDays(day, 1).getTime();
    const minutes = existing.reduce((total, event) => total + Math.max(0,
      Math.min(Date.parse(event.endAt), next) - Math.max(Date.parse(event.startAt), day.getTime())) / MINUTE, 0);
    used.set(zonedDateKey(day), minutes);
    weeklyUsed += existing.reduce((total, event) => total + Math.max(0,
      Math.min(Date.parse(event.endAt), next, to.getTime()) - Math.max(Date.parse(event.startAt), day.getTime(), from.getTime())) / MINUTE, 0);
  }
  const preserved = new Map<string, number>();
  for (const { assignmentId, event } of linkedEvents) {
    // Past open sessions need the student's progress report; don't silently recreate missed work.
    const minutes = Math.max(0, (Date.parse(event.endAt) - Date.parse(event.startAt)) / MINUTE);
    preserved.set(assignmentId, (preserved.get(assignmentId) ?? 0) + minutes);
  }
  const tasks = assignments.filter(a => a.status === 'open' || a.status === 'in_progress')
    .map(a => ({ assignment: a, remaining: Math.max(0, a.remainingMinutes - (preserved.get(a.id) ?? 0)) }))
    .sort((a, b) => a.assignment.dueAt.localeCompare(b.assignment.dueAt) || b.remaining - a.remaining || a.assignment.id.localeCompare(b.assignment.id));
  for (const { assignment, remaining: effort } of tasks) {
    let remaining = effort;
    const days: { startAt: string; endAt: string; key: string }[] = [];
    for (let day = startOfZonedDay(from); day < to; day = addZonedDays(day, 1)) {
      const parts = zonedParts(day);
      if (!preferences.weekdays.includes(parts.weekday) || day.getTime() >= Date.parse(assignment.dueAt)) continue;
      const start = Math.max(from.getTime(), studyWindowTime(parts, preferences.startTime));
      const end = Math.min(to.getTime(), Date.parse(assignment.dueAt), studyWindowTime(parts, preferences.endTime));
      if (start < end) days.push({ startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), key: zonedDateKey(day) });
    }
    // Round-robin days for longer work, then fill remaining capacity; deadlines take precedence.
    let progress = true;
    while (remaining >= 10 && progress) {
      progress = false;
      for (const day of days) {
        const capacity = Math.floor(Math.min(preferences.dailyMinutes - (used.get(day.key) ?? 0), preferences.weeklyMinutes - weeklyUsed));
        if (capacity < 10) continue;
        const gap = freeStudyGaps(day, occupied).map(([start, end]) => [Math.ceil(start / MINUTE) * MINUTE, end] as [number, number])
          .find(([start, end]) => end - start >= 10 * MINUTE);
        if (!gap) continue;
        const [start, end] = gap;
        const minutes = Math.min(50, remaining, capacity, Math.floor((end - start) / MINUTE));
        const block = { assignmentId: assignment.id, title: assignment.title,
          startAt: new Date(start).toISOString(), endAt: new Date(start + minutes * MINUTE).toISOString(), operationId: operationId(blocks.length) };
        blocks.push(block);
        occupied.push({ startAt: new Date(start - 10 * MINUTE).toISOString(), endAt: new Date(start + (minutes + 10) * MINUTE).toISOString() });
        used.set(day.key, (used.get(day.key) ?? 0) + minutes); weeklyUsed += minutes; remaining -= minutes; progress = true;
        if (remaining < 10) break;
      }
    }
    if (remaining > 0) unscheduled.push({ assignmentId: assignment.id, title: assignment.title, remainingMinutes: remaining,
      reason: Date.parse(assignment.dueAt) <= now.getTime() ? 'Deadline has passed.' : remaining < 10
        ? 'Fewer than 10 minutes remain; adjust the effort estimate if another block is needed.' : 'Not enough available capacity before the deadline within the next seven days.' });
  }
  return { id: planId, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * MINUTE).toISOString(),
    horizon: { from: from.toISOString(), to: to.toISOString() }, preferences,
    blocks: blocks.sort((a, b) => a.startAt.localeCompare(b.startAt)), unscheduled,
    preservedMinutes: [...preserved.values()].reduce((sum, minutes) => sum + minutes, 0) };
}

/** Revalidate the exact approved times and capacity against fresh Google events. */
export function assertStudyPlanFits(plan: StudyPlan, events: readonly CalendarEvent[], pendingBlocks: readonly PlannedBlock[]): void {
  for (const block of pendingBlocks) {
    const padded = { startAt: new Date(Date.parse(block.startAt) - 10 * MINUTE).toISOString(), endAt: new Date(Date.parse(block.endAt) + 10 * MINUTE).toISOString() };
    if (events.some(event => intervalsOverlap(event.source === 'polymate' ? padded : block, event))) {
      throw new ContractError('Google commitments changed or a study break no longer fits. Generate a fresh plan.');
    }
  }
  const study = [...events.filter(event => event.source === 'polymate'), ...pendingBlocks];
  let total = 0;
  for (let day = startOfZonedDay(plan.horizon.from); day.getTime() < Date.parse(plan.horizon.to); day = addZonedDays(day, 1)) {
    const next = addZonedDays(day, 1).getTime();
    const daily = study.reduce((sum, block) => sum + Math.max(0, Math.min(Date.parse(block.endAt), next)
      - Math.max(Date.parse(block.startAt), day.getTime())) / MINUTE, 0);
    total += study.reduce((sum, block) => sum + Math.max(0, Math.min(Date.parse(block.endAt), next, Date.parse(plan.horizon.to))
      - Math.max(Date.parse(block.startAt), day.getTime(), Date.parse(plan.horizon.from))) / MINUTE, 0);
    // An already-over-cap day is permitted only when this plan adds no work on that day.
    if (daily > plan.preferences.dailyMinutes && pendingBlocks.some(block => zonedDateKey(block.startAt) === zonedDateKey(day))) {
      throw new ContractError('Daily study capacity changed. Generate a fresh plan.');
    }
  }
  if (pendingBlocks.length && total > plan.preferences.weeklyMinutes) throw new ContractError('Weekly study capacity changed. Generate a fresh plan.');
}
