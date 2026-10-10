import { describe, expect, it, vi } from 'vitest';
import { MoodleAgentTools, studyBlockLabel } from '../packages/core/integrations/moodle/tools';
import { FakeCalendarClient } from '../packages/core/calendar/fake-client';
import type { MoodleReader, MoodleSnapshot, TimelineRequest } from '../packages/contracts/src/moodle';
import type { CalendarEvent } from '../packages/contracts/src/calendar';

const now = () => new Date('2026-10-10T08:00:00Z');
const snapshot: MoodleSnapshot = { courses: [{ id: 3, name: 'Analysis' }], assignments: [
  { id: 9, courseId: 3, courseName: 'Analysis', title: 'Sheet', description: 'Requirements', dueAt: '2026-10-10T14:00:00Z', opensAt: null, sourceUrl: 'https://moodle.test/mod/assign/view.php?id=12' },
], announcements: [], warnings: [], fetchedAt: now().toISOString() };
const input: TimelineRequest = { work: [{ assignmentId: 9, estimatedMinutes: 100 }], availability: [{ startAt: '2026-10-10T09:00:00Z', endAt: '2026-10-10T14:00:00Z' }] };
const reader = (): MoodleReader => ({ snapshot: vi.fn().mockResolvedValue(structuredClone(snapshot)), assignmentStatus: vi.fn().mockResolvedValue({ submitted: false, extensionDueAt: null }) });
const busy: CalendarEvent = { id: 'personal', title: 'Lecture', startAt: '2026-10-10T09:00:00Z', endAt: '2026-10-10T10:00:00Z', timezone: 'Europe/Zurich', allDay: false, source: 'google-personal', editable: false, completion: 'open', etag: '1' };

describe('Moodle assignment planning and calendar tools', () => {
  it('plans before deadline around existing commitments and retries without duplicate calendar events', async () => {
    const calendar = new FakeCalendarClient([busy]);
    const tools = new MoodleAgentTools('owner', reader(), calendar, now);
    const plan = await tools.planAssignments(input);
    expect(plan.blocks.map(b => b.startAt)).toEqual(['2026-10-10T10:00:00.000Z', '2026-10-10T11:05:00.000Z']);
    expect(plan.blocks.map(b => b.title)).toEqual(['Analysis · Sheet · Session 1/2', 'Analysis · Sheet · Session 2/2']);
    expect(plan.unscheduled).toEqual([]);
    expect((await tools.scheduleTimeline(plan)).complete).toBe(true);
    expect((await tools.scheduleTimeline(plan)).complete).toBe(true);
    expect(await calendar.listWeek({ from: input.availability[0].startAt, to: input.availability[0].endAt })).toHaveLength(3);
    expect(plan.blocks[0].sourceUrl).toContain('moodle.test');
  });

  it('refuses to draft or write a timeline with more than 20 study blocks', async () => {
    const big = { ...snapshot, assignments: [{ ...snapshot.assignments[0], dueAt: '2026-10-25T00:00:00Z' }] };
    const tools = new MoodleAgentTools('owner', { ...reader(), snapshot: vi.fn().mockResolvedValue(big) }, new FakeCalendarClient([]), now);
    const day = (d: number) => ({ startAt: `2026-10-${d}T08:00:00Z`, endAt: `2026-10-${d}T18:00:00Z` });
    // Two 90-minute sessions per day stay under the daily cap, so 20 sessions need ten days.
    const request = (minutes: number) => ({ work: [{ assignmentId: 9, estimatedMinutes: minutes }], availability: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20].map(day) });
    expect((await tools.planAssignments(request(1800))).blocks).toHaveLength(20);
    await expect(tools.planAssignments(request(1810))).rejects.toThrow('at most 20 study blocks');
    const plan = await tools.planAssignments(request(1800));
    const calendar = new FakeCalendarClient([]);
    const writer = new MoodleAgentTools('owner', { ...reader(), snapshot: vi.fn().mockResolvedValue(big) }, calendar, now);
    await expect(writer.scheduleTimeline({ ...plan, blocks: [...plan.blocks, { ...plan.blocks[0], operationId: 'extra' }] })).rejects.toThrow('at most 20 study blocks');
    expect(await calendar.listWeek({ from: '2026-10-11T00:00:00Z', to: '2026-10-14T00:00:00Z' })).toHaveLength(0);
  });

  it('keeps short work in one block, avoids tiny fragments and leaves a break between assignments', async () => {
    const event = (id: string, startAt: string, endAt: string): CalendarEvent => ({ ...busy, id, startAt, endAt });
    // Free: 09:00–09:10, 10:00–10:20, 11:00–14:00.
    const calendar = new FakeCalendarClient([event('a', '2026-10-10T09:10:00Z', '2026-10-10T10:00:00Z'), event('b', '2026-10-10T10:20:00Z', '2026-10-10T11:00:00Z')]);
    const quiz = { ...snapshot.assignments[0], id: 10, title: 'Quiz' };
    const moodle = { ...reader(), snapshot: vi.fn().mockResolvedValue({ ...snapshot, assignments: [...snapshot.assignments, quiz] }) };
    const tools = new MoodleAgentTools('owner', moodle, calendar, now);
    const plan = await tools.planAssignments({ work: [{ assignmentId: 10, estimatedMinutes: 60 }, { assignmentId: 9, estimatedMinutes: 100 }],
      availability: [{ startAt: '2026-10-10T09:00:00Z', endAt: '2026-10-10T14:00:00Z' }] });
    expect(plan.blocks.map(b => [b.assignmentId, b.startAt.slice(11, 16), b.endAt.slice(11, 16)])).toEqual([
      [9, '11:00', '11:50'], [9, '12:05', '12:55'], [10, '13:10', '13:40'],
    ]);
    expect(plan.unscheduled).toMatchObject([{ assignmentId: 10, remainingMinutes: 30 }]);
  });

  it('rests between sessions and caps study per day, counting existing study blocks', async () => {
    const longDay = { ...snapshot, assignments: [{ ...snapshot.assignments[0], dueAt: '2026-10-12T20:00:00Z' }] };
    const existing: CalendarEvent = { ...busy, id: 'study', source: 'polymate', startAt: '2026-10-11T06:00:00Z', endAt: '2026-10-11T07:00:00Z' };
    const tools = new MoodleAgentTools('owner', { ...reader(), snapshot: vi.fn().mockResolvedValue(longDay) }, new FakeCalendarClient([existing]), now);
    const plan = await tools.planAssignments({ work: [{ assignmentId: 9, estimatedMinutes: 480 }],
      availability: [{ startAt: '2026-10-11T08:00:00Z', endAt: '2026-10-11T18:00:00Z' }, { startAt: '2026-10-12T08:00:00Z', endAt: '2026-10-12T18:00:00Z' }] });
    const day = (key: string) => plan.blocks.filter(b => b.startAt.startsWith(key)).reduce((sum, b) => sum + (Date.parse(b.endAt) - Date.parse(b.startAt)) / 60000, 0);
    expect(day('2026-10-11')).toBeLessThanOrEqual(180);
    expect(day('2026-10-12')).toBeLessThanOrEqual(240);
    for (const [a, b] of plan.blocks.slice(1).map((b, i) => [plan.blocks[i], b])) {
      expect(Date.parse(b.startAt) - Date.parse(a.endAt)).toBeGreaterThanOrEqual((Date.parse(a.endAt) - Date.parse(a.startAt) > 3600000 ? 30 : 15) * 60000);
    }
    expect(plan.unscheduled[0]?.reason ?? '').toMatch(/4 hours of study per day/);
  });

  it('titles blocks with the agent label or a cleaned Moodle title', async () => {
    expect(studyBlockLabel('252-0057-00L 2026W', 'Abgabe: Blatt 4 / Sheet 4 ist fällig.')).toBe('252-0057-00L · Sheet 4');
    expect(studyBlockLabel('Moodle calendar', 'Quiz 2 is due')).toBe('Quiz 2');
    const tools = new MoodleAgentTools('owner', reader(), new FakeCalendarClient([]), now);
    const plan = await tools.planAssignments({ ...input, work: [{ assignmentId: 9, estimatedMinutes: 50, label: '  Algorithms   & Probability · Sheet 4 ' }] });
    expect(plan.blocks.map(b => b.title)).toEqual(['Algorithms & Probability · Sheet 4']);
    await expect(tools.planAssignments({ ...input, work: [{ assignmentId: 9, estimatedMinutes: 50, label: 'a\nb' }] })).rejects.toThrow('single line');
  });

  it('reports insufficient capacity and requires explicit partial scheduling', async () => {
    const tools = new MoodleAgentTools('owner', reader(), new FakeCalendarClient([]), now);
    const plan = await tools.planAssignments({ ...input, availability: [{ startAt: '2026-10-10T13:30:00Z', endAt: '2026-10-10T15:00:00Z' }] });
    expect(plan.blocks[0].endAt).toBe('2026-10-10T14:00:00.000Z');
    expect(plan.unscheduled[0].remainingMinutes).toBe(70);
    await expect(tools.scheduleTimeline(plan)).rejects.toThrow('cannot fit');
    // The approved partial request is fully done once every fitting block is written.
    expect((await tools.scheduleTimeline(plan, true)).complete).toBe(true);
  });

  it('uses student extensions, excludes submitted work, and refuses changed deadlines', async () => {
    const moodle = reader();
    vi.mocked(moodle.assignmentStatus).mockResolvedValue({ submitted: false, extensionDueAt: '2026-10-10T16:00:00Z' });
    const tools = new MoodleAgentTools('owner', moodle, new FakeCalendarClient([]), now);
    const plan = await tools.planAssignments({ ...input, availability: [{ startAt: '2026-10-10T14:00:00Z', endAt: '2026-10-10T16:00:00Z' }] });
    expect(plan.unscheduled).toEqual([]);
    vi.mocked(moodle.assignmentStatus).mockResolvedValue({ submitted: false, extensionDueAt: null });
    await expect(tools.scheduleTimeline(plan)).rejects.toThrow('dates or submission status changed');
    vi.mocked(moodle.assignmentStatus).mockResolvedValue({ submitted: true, extensionDueAt: null });
    expect((await tools.planAssignments(input)).blocks).toEqual([]);
  });

  it('handles missing deadlines and rejects invented assignments, duplicate work and overlapping windows', async () => {
    const moodle = reader();
    vi.mocked(moodle.snapshot).mockResolvedValue({ ...snapshot, assignments: [{ ...snapshot.assignments[0], dueAt: null }] });
    const tools = new MoodleAgentTools('owner', moodle, new FakeCalendarClient([]), now);
    expect((await tools.planAssignments(input)).unscheduled[0].reason).toBe('No verified deadline.');
    await expect(tools.planAssignments({ ...input, work: [{ assignmentId: 123, estimatedMinutes: 50 }] })).rejects.toThrow('not available');
    await expect(tools.planAssignments({ ...input, work: [...input.work, ...input.work] })).rejects.toThrow('unique');
    await expect(tools.planAssignments({ ...input, availability: [...input.availability, ...input.availability] })).rejects.toThrow('must not overlap');
  });

  it('stops on uncertain calendar writes and returns exact partial outcomes', async () => {
    const calendar = new FakeCalendarClient([]);
    const tools = new MoodleAgentTools('owner', reader(), calendar, now);
    const plan = await tools.planAssignments(input);
    const create = vi.spyOn(calendar, 'createStudyBlock').mockResolvedValue({ status: 'unknown', operationId: plan.blocks[0].operationId });
    const result = await tools.scheduleTimeline(plan);
    expect(result.complete).toBe(false);
    expect(result.results[0].status).toBe('unknown');
    expect(create).toHaveBeenCalledTimes(1);
  });
});
