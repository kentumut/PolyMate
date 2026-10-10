import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assignment } from '@polymate/contracts/assignments';
import { parseProgressRequest, type ProgressRequest } from '../packages/contracts/src/study-progress';
import { StudyProgressService } from '../packages/core/progress/service';
import { MemoryStudyProgressStore } from '../packages/core/progress/memory';
import { FakeCalendarClient } from '../packages/core/calendar/fake-client';

const assignmentId = '00000000-0000-4000-8000-000000000001';
const event = { id: 'study1', title: 'Questions 1–2', startAt: '2026-10-12T09:00:00.000Z', endAt: '2026-10-12T09:50:00.000Z', timezone: 'Europe/Zurich', allDay: false,
  source: 'polymate' as const, editable: true, completion: 'open' as const, etag: '"1"' };
let assignment: Assignment;
let calendar: FakeCalendarClient;
let store: MemoryStudyProgressStore;
let service: StudyProgressService;
const request = (action: ProgressRequest['action'], extra: Partial<ProgressRequest> = {}) => ({
  clientRequestId: crypto.randomUUID(), eventId: event.id, assignmentId, action, expectedAssignmentVersion: assignment.version,
  expectedSessionRevision: 1, expectedEtag: event.etag, ...extra,
});

beforeEach(async () => {
  assignment = { id: assignmentId, title: 'Algorithms sheet 4', dueAt: '2026-10-16T16:00:00.000Z', estimatedMinutes: 150, remainingMinutes: 150, status: 'open', version: 1 };
  calendar = new FakeCalendarClient([event, { ...event, id: 'lecture', source: 'google-personal', editable: false }]);
  store = new MemoryStudyProgressStore('student', async () => [{ ...assignment }], next => { assignment = next; });
  service = new StudyProgressService('student', calendar, store);
  await service.link({ eventId: event.id, assignmentId, expectedAssignmentVersion: 1, expectedEtag: event.etag });
});

describe('progress permissions and explicit completion', () => {
  it.each([
    { remainingMinutes: -1 }, { remainingMinutes: 1.5 }, { expectedSessionRevision: 0 }, { expectedAssignmentVersion: 0 },
    { assignmentFinished: 'yes' }, { action: 'invented' }, { note: 'x'.repeat(2001) },
  ])('rejects invalid report fields %j', changes => {
    expect(() => parseProgressRequest({ ...request('partly_done', { remainingMinutes: 100 }), ...changes })).toThrow();
  });
  it('requires explicit full-assignment confirmation, and positive partial effort', () => {
    expect(() => parseProgressRequest(request('partly_done', { remainingMinutes: 0 }))).toThrow();
    expect(() => parseProgressRequest(request('done', { remainingMinutes: 0 }))).toThrow('Confirm');
    expect(parseProgressRequest(request('done', { assignmentFinished: true, remainingMinutes: 0 })).assignmentFinished).toBe(true);
  });
  it('preserves effort for missed sessions and requires a specific difficulty for stuck reports', () => {
    expect(() => parseProgressRequest(request('missed', { remainingMinutes: 100 }))).toThrow('does not change');
    expect(() => parseProgressRequest(request('stuck'))).toThrow('which question');
    expect(() => parseProgressRequest({ ...request('missed'), ownerId: 'other' })).toThrow('unsupported');
  });
  it('rejects personal calendar events and cross-owner context', async () => {
    await expect(service.link({ eventId: 'lecture', assignmentId, expectedAssignmentVersion: 1, expectedEtag: '"1"' })).rejects.toThrow();
    await expect(new StudyProgressService('other', calendar, store).state()).rejects.toThrow('owner mismatch');
    expect(assignment.version).toBe(1);
  });
  it('rejects changed request payloads, stale assignment versions, and outdated ETags', async () => {
    const first = request('partly_done', { remainingMinutes: 100 }); await service.record(first);
    await expect(service.record({ ...first, remainingMinutes: 50 })).rejects.toThrow('different progress');
    await expect(service.record(request('missed', { expectedAssignmentVersion: 1 }))).rejects.toThrow('Progress changed');
    await expect(service.record(request('missed', { expectedEtag: '"old"' }))).rejects.toThrow('calendar block changed');
  });
});

describe('progress and missed-session recovery', () => {
  it('deduplicates concurrent reports and records only student-reported remaining effort', async () => {
    const value = request('partly_done', { remainingMinutes: 100 });
    const [a, b] = await Promise.all([service.record(value), service.record(value)]);
    expect(a.report.id).toBe(b.report.id); expect(assignment.remainingMinutes).toBe(100); expect(assignment.version).toBe(2);
    expect((await service.state()).reports).toHaveLength(1);
  });
  it('accepts a larger revised effort estimate and saves the difficult question', async () => {
    await service.record(request('stuck', { remainingMinutes: 200, note: 'Question 2: induction proof.' }));
    expect(assignment.remainingMinutes).toBe(200); expect(assignment.estimatedMinutes).toBe(150);
    expect((await service.state()).reports[0].note).toBe('Question 2: induction proof.');
  });
  it('preserves remaining work on missed sessions and starts a new revision after a move', async () => {
    await service.record(request('missed', { note: 'Met friends.' }));
    expect(assignment.remainingMinutes).toBe(150);
    const moved = await calendar.updateStudyBlock(event.id, { startAt: '2026-10-13T09:00:00.000Z', endAt: '2026-10-13T09:50:00.000Z' }, event.etag, crypto.randomUUID());
    store.observe('update', event.id, moved);
    const state = await service.state();
    expect(state.links[0]).toMatchObject({ assignmentId, sessionRevision: 2 });
    expect(state.reports[0]).toMatchObject({ action: 'missed', sessionRevision: 1 });
    expect(state.reports.filter(report => report.sessionRevision === 2)).toHaveLength(0);
    await expect(service.record(request('partly_done', { remainingMinutes: 100, expectedEtag: moved.event!.etag }))).rejects.toThrow('Progress changed');
    await service.record(request('partly_done', { remainingMinutes: 100, expectedSessionRevision: 2, expectedEtag: moved.event!.etag }));
    expect(assignment.remainingMinutes).toBe(100);
  });
  it('does not move a missed session into a conflicting personal commitment', async () => {
    await service.record(request('missed'));
    await calendar.createStudyBlock({ title: 'Busy block', startAt: '2026-10-13T09:00:00Z', endAt: '2026-10-13T09:50:00Z' }, crypto.randomUUID());
    const result = await calendar.updateStudyBlock(event.id, { startAt: '2026-10-13T09:00:00Z', endAt: '2026-10-13T09:50:00Z' }, event.etag, crypto.randomUUID());
    store.observe('update', event.id, result);
    expect(result.status).toBe('failed'); expect((await service.state()).links[0].sessionRevision).toBe(1);
    expect(assignment.remainingMinutes).toBe(150);
  });
  it('completes the session once and finishes the assignment only with explicit confirmation', async () => {
    const complete = vi.spyOn(calendar, 'completeStudyBlock');
    const value = request('done');
    const first = await service.record(value); await service.record(value);
    expect(first.calendarOperation?.status).toBe('synced'); expect(complete).toHaveBeenCalledTimes(1);
    expect(assignment).toMatchObject({ status: 'in_progress', remainingMinutes: 150 });
    const latest = await calendar.readStudyBlock(event.id);
    const allDone = await service.record(request('done', { assignmentFinished: true, expectedEtag: latest.etag }));
    expect(allDone.calendarAlreadyDone).toBe(true); expect(assignment).toMatchObject({ status: 'completed', remainingMinutes: 0 });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it('retains saved progress while Google completion is uncertain and recovers the original report', async () => {
    const complete = vi.spyOn(calendar, 'completeStudyBlock');
    complete.mockImplementationOnce(async (_id, _etag, operationId) => ({ operationId, status: 'unknown' }));
    const value = request('done', { remainingMinutes: 100 });
    const result = await service.record(value);
    expect(result.report.action).toBe('done'); expect(result.calendarOperation?.status).toBe('unknown');
    expect(assignment.remainingMinutes).toBe(100);
    expect((await service.state()).pendingCompletions).toEqual([parseProgressRequest(value)]);
    await service.record(value);
    expect(assignment.version).toBe(2); expect((await service.state()).reports).toHaveLength(1);
    expect((await service.state()).pendingCompletions).toHaveLength(0);
  });
  it('retains history after deletion and rejects reports against the removed session', async () => {
    await service.record(request('stuck', { note: 'Question 2.' }));
    store.observe('delete', event.id, await calendar.deleteStudyBlock(event.id, event.etag, crypto.randomUUID()));
    expect((await service.state()).links[0].deleted).toBe(true);
    expect((await service.state()).reports).toHaveLength(1);
    await expect(service.record(request('missed'))).rejects.toThrow();
  });
});
