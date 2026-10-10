import { describe, expect, it } from 'vitest';
import { AGENT_TOOL_NAMES } from '../packages/core/agent/contracts';
import { FakeCalendarClient } from '../packages/core/calendar/fake-client';
import {
  demoCalendarEvents,
  demoMoodleSnapshot,
  demoMovedBlock,
  demoTimeline,
  demoVolunteerMemory,
  demoWeekRange,
} from '../apps/web/lib/demo-fixtures';

const NOW = '2026-10-10T12:00:00.000Z';
const overlaps = (left: { startAt: string; endAt: string }, right: { startAt: string; endAt: string }) =>
  Date.parse(left.startAt) < Date.parse(right.endAt) && Date.parse(right.startAt) < Date.parse(left.endAt);

describe('guided chat demo', () => {
  it('maps every demonstrated AI action to a shipped production capability', () => {
    expect(AGENT_TOOL_NAMES).toEqual(expect.arrayContaining([
      'moodle_get_calendar_events',
      'polymate_remember_student_context',
      'polymate_get_calendar',
      'moodle_plan_assignment_timeline',
      'moodle_schedule_assignment_timeline',
      'polymate_move_study_block',
    ]));
  });

  it('builds a conflict-free draft before the fixture deadline and remembered commitment', () => {
    const timeline = demoTimeline(NOW);
    const busy = demoCalendarEvents(NOW);
    const deadline = demoMoodleSnapshot(NOW).assignments[0].dueAt!;
    const volunteering = demoVolunteerMemory(NOW);
    const range = demoWeekRange(NOW);
    const wednesday = timeline.blocks.filter(block => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', weekday: 'long' }).format(new Date(block.startAt)) === 'Wednesday');

    expect(timeline.blocks).toHaveLength(3);
    expect(timeline.blocks.every(block => Date.parse(block.endAt) <= Date.parse(deadline))).toBe(true);
    expect(timeline.blocks.every(block => busy.every(event => !overlaps(block, event)))).toBe(true);
    expect(wednesday).toHaveLength(0);
    expect(volunteering.validUntil).toBe(range.to);
  });

  it('creates the approved blocks and moves the existing review without duplicating it', async () => {
    const client = new FakeCalendarClient(demoCalendarEvents(NOW));
    const timeline = demoTimeline(NOW);
    for (const block of timeline.blocks) {
      expect((await client.createStudyBlock(block, block.operationId)).status).toBe('synced');
    }

    const range = demoWeekRange(NOW);
    const created = (await client.listWeek(range)).filter(event => event.source === 'polymate');
    const review = created.find(event => event.title.includes('Final review'))!;
    const moved = demoMovedBlock(NOW);
    const result = await client.updateStudyBlock(review.id, moved, review.etag, '20000000-0000-5000-a000-000000000001');
    const after = (await client.listWeek(range)).filter(event => event.source === 'polymate');

    expect(result).toMatchObject({ status: 'synced', event: moved });
    expect(after).toHaveLength(3);
    expect(after.filter(event => event.title.includes('Final review'))).toHaveLength(1);
  });
});

