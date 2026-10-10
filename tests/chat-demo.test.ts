import { describe, expect, it } from 'vitest';
import { AGENT_TOOL_NAMES } from '../packages/core/agent/contracts';
import { FakeCalendarClient } from '../packages/core/calendar/fake-client';
import { zonedParts, zonedTimeToInstant } from '../packages/contracts/src/time';
import {
  DEMO_ONBOARDING_OPTIONS,
  demoCalendarEvents,
  demoCapturedAssignment,
  demoCoachingState,
  demoCommitmentMemory,
  demoMoodleSnapshot,
  demoMovedBlock,
  demoTimeline,
  demoTradeoffExplanation,
  demoVolunteerMemory,
  demoWeekRange,
} from '../apps/web/lib/demo-fixtures';

const NOW = '2026-10-10T12:00:00.000Z';
const overlaps = (left: { startAt: string; endAt: string }, right: { startAt: string; endAt: string }) =>
  Date.parse(left.startAt) < Date.parse(right.endAt) && Date.parse(right.startAt) < Date.parse(left.endAt);

function commitmentWindow(commitment: 'volunteering' | 'rehearsal') {
  const monday = zonedParts(demoWeekRange(NOW).from);
  const volunteering = commitment === 'volunteering';
  const day = monday.day + (volunteering ? 2 : 3);
  return {
    startAt: zonedTimeToInstant({ year: monday.year, month: monday.month, day, hour: 17 }).toISOString(),
    endAt: zonedTimeToInstant({ year: monday.year, month: monday.month, day, hour: volunteering ? 20 : 19 }).toISOString(),
  };
}

describe('guided chat demo', () => {
  it('maps every demonstrated AI action to a shipped production capability', () => {
    expect(AGENT_TOOL_NAMES).toEqual(expect.arrayContaining([
      'moodle_get_calendar_events',
      'polymate_remember_student_context',
      'polymate_create_assignment',
      'polymate_get_calendar',
      'moodle_plan_assignment_timeline',
      'moodle_schedule_assignment_timeline',
      'polymate_move_study_block',
    ]));
  });

  it('captures the demo assignment at the intended Zurich wall time', () => {
    const assignment = demoCapturedAssignment(NOW);
    const due = zonedParts(assignment.dueAt);
    expect(assignment).toMatchObject({ title: 'Computer Vision exercise sheet 4', estimatedMinutes: 180 });
    expect(due).toMatchObject({ weekday: 4, hour: 18, minute: 0 });
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

  it('explains the actual draft trade-off without implying a calendar write', () => {
    const explanation = demoTradeoffExplanation(demoTimeline(NOW), {
      sessionMinutes: 50,
      style: 'spread',
      commitment: 'volunteering',
    });

    expect(explanation).toContain('Monday 16:00');
    expect(explanation).toContain('Wednesday volunteering');
    expect(explanation).toContain('less buffer if a later session slips');
    expect(explanation).toContain('calendar is still unchanged');
  });

  it('offers complete onboarding choices and a response-required proactive coach', () => {
    for (const options of Object.values(DEMO_ONBOARDING_OPTIONS)) {
      expect(options.length).toBeGreaterThanOrEqual(2);
      expect(new Set(options.map(option => option.value)).size).toBe(options.length);
    }

    const pending = demoCoachingState(NOW, [], true);
    const answered = demoCoachingState(NOW, [], true, 2);
    expect(pending.messages.filter(message => message.requiresResponse && message.status !== 'responded')).toHaveLength(2);
    expect(demoCoachingState(NOW, [], false).messages.filter(message => message.requiresResponse && message.status !== 'responded')).toHaveLength(1);
    expect(answered.messages.filter(message => message.requiresResponse && message.status !== 'responded')).toHaveLength(0);
  });

  it('keeps every onboarding plan branch at 150 minutes and clear of commitments', () => {
    const busy = demoCalendarEvents(NOW);
    const deadline = demoMoodleSnapshot(NOW).assignments[0].dueAt!;

    for (const sessionMinutes of [30, 50] as const) {
      for (const style of ['spread', 'frontload'] as const) {
        for (const commitment of ['volunteering', 'rehearsal'] as const) {
          const timeline = demoTimeline(NOW, { sessionMinutes, style, commitment });
          const protectedTime = commitmentWindow(commitment);
          const totalMinutes = timeline.blocks.reduce(
            (sum, block) => sum + (Date.parse(block.endAt) - Date.parse(block.startAt)) / 60_000,
            0,
          );

          expect(totalMinutes).toBe(150);
          expect(timeline.blocks).toHaveLength(150 / sessionMinutes);
          expect(timeline.blocks.every(block => Date.parse(block.endAt) <= Date.parse(deadline))).toBe(true);
          expect(timeline.blocks.every(block => busy.every(event => !overlaps(block, event)))).toBe(true);
          expect(timeline.blocks.every(block => !overlaps(block, protectedTime))).toBe(true);
          expect(demoCommitmentMemory(NOW, commitment).validUntil).toBe(demoWeekRange(NOW).to);
        }
      }
    }
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

  it('moves short-session review blocks to either demonstrated Friday choice', () => {
    const atThree = demoMovedBlock(NOW, 'friday-15', 30);
    const atFour = demoMovedBlock(NOW, 'friday-16', 30);

    expect(Date.parse(atThree.endAt) - Date.parse(atThree.startAt)).toBe(30 * 60_000);
    expect(Date.parse(atFour.startAt) - Date.parse(atThree.startAt)).toBe(60 * 60_000);
  });
});

