import { describe, expect, it } from 'vitest';
import type { Assignment } from '../packages/contracts/src/assignments';
import type { CalendarEvent, OperationResult } from '../packages/contracts/src/calendar';
import { DEFAULT_STUDY_PREFERENCES, type StudyPlan } from '../packages/contracts/src/planning';
import type { BlockAssignmentLink, ProgressReport } from '../packages/contracts/src/study-progress';
import { weekRange } from '../packages/contracts/src/time';
import { assignmentLabels, proposedBlocks, unscheduledWork } from '../apps/web/components/calendar/plan-overlay';
import { eventLabel, placeDayEvents, proposedLabel, visibleHours, weekDays } from '../apps/web/components/calendar/week-layout';

const now = new Date('2026-10-09T10:00:00Z');
const op = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const assignment = (id: string, extra: Partial<Assignment> = {}): Assignment => ({
  id, title: `Sheet ${id}`, dueAt: '2026-10-14T22:00:00Z', estimatedMinutes: 150, remainingMinutes: 150, status: 'open', version: 1, ...extra,
});
const link = (eventId: string, assignmentId: string, startAt: string, endAt: string, extra: Partial<BlockAssignmentLink> = {}): BlockAssignmentLink => ({
  eventId, assignmentId, sessionRevision: 1, completion: 'open', startAt, endAt, etag: '"1"', deleted: false, ...extra,
});
const plan = (extra: Partial<StudyPlan> = {}): StudyPlan => ({
  id: op(9), createdAt: now.toISOString(), expiresAt: '2026-10-09T10:30:00Z',
  horizon: { from: now.toISOString(), to: '2026-10-16T10:00:00Z' }, preferences: DEFAULT_STUDY_PREFERENCES,
  blocks: [
    { assignmentId: 'a', operationId: op(1), title: 'Sheet a', startAt: '2026-10-09T12:00:00Z', endAt: '2026-10-09T12:50:00Z' },
    { assignmentId: 'a', operationId: op(2), title: 'Sheet a', startAt: '2026-10-12T07:00:00Z', endAt: '2026-10-12T07:50:00Z' },
    { assignmentId: 'b', operationId: op(3), title: 'Sheet b', startAt: '2026-10-12T08:00:00Z', endAt: '2026-10-12T08:50:00Z' },
  ],
  unscheduled: [{ assignmentId: 'b', title: 'Sheet b', remainingMinutes: 40, reason: 'Not enough study time before the deadline.' }],
  preservedMinutes: 0, ...extra,
});
const result = (operationId: string, status: OperationResult['status']): OperationResult => ({ operationId, status });

describe('plan overlay', () => {
  it('shows unconfirmed preview blocks with distinct, collision-free IDs', () => {
    const blocks = proposedBlocks(plan(), [], now);
    expect(blocks.map(block => [block.id, block.status])).toEqual([
      [`proposed:${op(1)}`, 'proposed'], [`proposed:${op(2)}`, 'proposed'], [`proposed:${op(3)}`, 'proposed'],
    ]);
    expect(blocks.every(block => block.kind === 'proposed' && !block.allDay)).toBe(true);
  });

  it('drops Google-confirmed blocks and marks failed or uncertain ones', () => {
    const blocks = proposedBlocks(plan(), [result(op(1), 'synced'), result(op(2), 'failed'), result(op(3), 'unknown')], now);
    expect(blocks.map(block => [block.operationId, block.status])).toEqual([[op(2), 'failed'], [op(3), 'unknown']]);
    expect(proposedBlocks(plan(), plan().blocks.map(block => result(block.operationId, 'synced')), now)).toEqual([]);
  });

  it('retires expired previews unless an apply was already attempted', () => {
    const later = new Date('2026-10-09T11:00:00Z');
    expect(proposedBlocks(plan(), [], later)).toEqual([]);
    expect(proposedBlocks(plan(), [result(op(1), 'unknown')], later).map(block => block.operationId)).toEqual([op(1), op(2), op(3)]);
    expect(proposedBlocks(null, [], now)).toEqual([]);
  });

  it('labels live linked blocks with their assignment title', () => {
    const labels = assignmentLabels([
      link('e1', 'a', '2026-10-09T12:00:00Z', '2026-10-09T12:50:00Z'),
      link('e2', 'a', '2026-10-09T13:00:00Z', '2026-10-09T13:50:00Z', { deleted: true }),
      link('e3', 'missing', '2026-10-09T14:00:00Z', '2026-10-09T14:50:00Z'),
    ], [assignment('a')]);
    expect([...labels]).toEqual([['e1', 'Sheet a']]);
  });

  it("uses a current preview's shortfall as the unscheduled work", () => {
    expect(unscheduledWork({ assignments: [assignment('a'), assignment('b')], links: [], reports: [], plan: plan(), now }))
      .toEqual([{ assignmentId: 'b', title: 'Sheet b', minutes: 40, reason: 'Not enough study time before the deadline.' }]);
  });

  it('otherwise subtracts unreported linked sessions from remaining effort, like the planner', () => {
    const links = [
      link('e1', 'a', '2026-10-09T12:00:00Z', '2026-10-09T12:50:00Z'),
      link('e2', 'a', '2026-10-08T12:00:00Z', '2026-10-08T12:50:00Z', { sessionRevision: 2 }), // reported: already in remaining
      link('e3', 'a', '2026-10-10T12:00:00Z', '2026-10-10T12:50:00Z', { deleted: true }),
      link('e4', 'c', '2026-10-10T12:00:00Z', '2026-10-10T14:30:00Z'),
    ];
    const reports = [{ eventId: 'e2', sessionRevision: 2 } as ProgressReport];
    const work = unscheduledWork({
      assignments: [
        assignment('a', { remainingMinutes: 100 }),
        assignment('b', { status: 'completed', remainingMinutes: 0 }),
        assignment('c'), // fully covered by e4
        assignment('d', { dueAt: '2026-10-08T22:00:00Z' }), // past its deadline; not schedulable
      ],
      links, reports, plan: plan({ expiresAt: '2026-10-09T09:00:00Z' }), now,
    });
    expect(work).toEqual([{ assignmentId: 'a', title: 'Sheet a', minutes: 50 }]);
  });
});

describe('proposed blocks in the week layout', () => {
  const days = weekDays(weekRange(now));
  const event: CalendarEvent = {
    id: 'lecture', title: 'Lecture', startAt: '2026-10-09T12:00:00Z', endAt: '2026-10-09T13:00:00Z', timezone: 'Europe/Zurich',
    allDay: false, source: 'google-personal', editable: false, completion: 'open', etag: '"1"',
  };

  it('shares lanes with real events and widens visible hours', () => {
    const [proposal] = proposedBlocks(plan({ blocks: [{ ...plan().blocks[0], startAt: '2026-10-09T12:30:00Z', endAt: '2026-10-09T19:00:00Z' }] }), [], now);
    const placed = placeDayEvents([event, proposal], days[4], { start: 8, end: 21 });
    expect(placed.map(item => [item.event.id, item.left, item.width])).toEqual([['lecture', 0, 50], [proposal.id, 50, 50]]);
    expect(visibleHours([proposal], days)).toEqual({ start: 8, end: 21 });
  });

  it('describes proposals and assignment links for screen readers', () => {
    const [proposal] = proposedBlocks(plan(), [], now);
    expect(proposedLabel(proposal)).toBe('Proposed study block: Sheet a, Friday 9 October, 14:00 to 14:50, not in Google Calendar yet');
    expect(proposedLabel({ ...proposal, status: 'failed' })).toMatch(/could not be added$/);
    expect(eventLabel({ ...event, source: 'polymate', editable: true, title: 'Focus' }, 'Sheet a'))
      .toBe('Study block: Focus, for Sheet a, Friday 9 October, 14:00 to 15:00');
  });
});
