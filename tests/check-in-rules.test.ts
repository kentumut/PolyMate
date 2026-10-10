import { describe, expect, it } from 'vitest';
import type { Assignment } from '@polymate/contracts/assignments';
import type { BlockAssignmentLink, ProgressReport } from '@polymate/contracts/study-progress';
import { parseChatMutation } from '../packages/contracts/src/chats';
import { checkInCandidates, dueCheckIns, effortText, inQuietHours, type CheckInSnapshot } from '../packages/core/checkins/rules';
import { runCheckIns, webCheckInChannel, type CheckInChannel, type CheckInStore } from '../packages/core/checkins/service';

// Saturday 10 October 2026, 15:00 in Zurich (UTC+2).
const now = new Date('2026-10-10T13:00:00Z');
const assignment: Assignment = { id: '00000000-0000-4000-8000-000000000001', title: 'Analysis Serie 4', dueAt: '2026-10-16T16:00:00Z', estimatedMinutes: 240, remainingMinutes: 150, status: 'open', version: 1 };
const link: BlockAssignmentLink = { eventId: 'study1', assignmentId: assignment.id, sessionRevision: 2, completion: 'open', startAt: '2026-10-10T11:00:00Z', endAt: '2026-10-10T11:50:00Z', etag: '"2"', deleted: false };
const report = (changes: Partial<ProgressReport> = {}): ProgressReport => ({ id: '00000000-0000-4000-8000-0000000000aa', clientRequestId: '00000000-0000-4000-8000-0000000000ab', eventId: link.eventId, assignmentId: assignment.id,
  sessionRevision: link.sessionRevision, action: 'partly_done', reportedRemainingMinutes: 150, assignmentFinished: false, note: '', reportedAt: '2026-10-10T12:00:00Z', ...changes });
const snapshot = (changes: Partial<CheckInSnapshot> = {}): CheckInSnapshot => ({ assignments: [], links: [], reports: [], courses: [], prior: [], lastStudentMessageAt: now.toISOString(), paused: false, ...changes });
const kinds = (value: CheckInSnapshot, at = now) => checkInCandidates(value, at).map(draft => draft.kind);

describe('check-in rules', () => {
  it('asks how a linked session went once it has ended without a report', () => {
    const [draft] = dueCheckIns(snapshot({ assignments: [assignment], links: [link] }), now);
    expect(draft).toMatchObject({ kind: 'session_follow_up', dedupeKey: 'session:study1:2', topic: { assignmentId: assignment.id, eventId: 'study1', sessionRevision: 2 } });
    expect(draft.body).toBe('Your study session for “Analysis Serie 4” ended at 13:50. How did it go?');
    expect(draft.quickReplies).toHaveLength(4);
  });

  it('does not follow up on a session that is running, reported, done, deleted, moved on or a day old', () => {
    const base = { assignments: [assignment] };
    expect(kinds(snapshot({ ...base, links: [{ ...link, endAt: '2026-10-10T12:55:00Z' }] }))).not.toContain('session_follow_up');
    expect(kinds(snapshot({ ...base, links: [link], reports: [report()] }))).not.toContain('session_follow_up');
    expect(kinds(snapshot({ ...base, links: [{ ...link, completion: 'done' }] }))).not.toContain('session_follow_up');
    expect(kinds(snapshot({ ...base, links: [{ ...link, deleted: true }] }))).not.toContain('session_follow_up');
    expect(kinds(snapshot({ ...base, links: [{ ...link, endAt: '2026-10-09T11:00:00Z' }] }))).not.toContain('session_follow_up');
    // A report for the old revision does not answer for the moved session.
    expect(kinds(snapshot({ ...base, links: [link], reports: [report({ sessionRevision: 1 })] }))).toContain('session_follow_up');
  });

  it('warns about a close deadline only when no study time is planned', () => {
    const urgent = { ...assignment, dueAt: '2026-10-11T16:00:00Z' };
    const [draft] = checkInCandidates(snapshot({ assignments: [urgent] }), now);
    expect(draft.kind).toBe('deadline_risk');
    expect(draft.body).toBe('“Analysis Serie 4” is due tomorrow at 18:00. You estimated about 2 h 30 min of work left, and no study time is planned for it. Shall I look for a slot?');
    const planned = { ...link, startAt: '2026-10-11T08:00:00Z', endAt: '2026-10-11T08:50:00Z' };
    expect(kinds(snapshot({ assignments: [urgent], links: [planned] }))).not.toContain('deadline_risk');
    expect(kinds(snapshot({ assignments: [{ ...urgent, status: 'completed', remainingMinutes: 0 }] }))).toEqual([]);
  });

  it('follows up the day after a stuck report, quoting the student’s own note', () => {
    const stuck = report({ action: 'stuck', note: 'Question 2: induction proof', reportedAt: '2026-10-09T15:00:00Z', sessionRevision: 1 });
    const draft = checkInCandidates(snapshot({ assignments: [assignment], reports: [stuck] }), now).find(item => item.kind === 'stuck_follow_up');
    expect(draft?.body).toBe('Last time you got stuck on “Question 2: induction proof” in “Analysis Serie 4”. Want to work through it together?');
    expect(kinds(snapshot({ assignments: [assignment], reports: [{ ...stuck, reportedAt: '2026-10-10T10:00:00Z' }] }))).not.toContain('stuck_follow_up');
    expect(kinds(snapshot({ assignments: [assignment], reports: [stuck, report({ id: '00000000-0000-4000-8000-0000000000ac', reportedAt: '2026-10-10T09:00:00Z' })] }))).not.toContain('stuck_follow_up');
  });

  it('asks about an assignment due within three days that has been quiet for two', () => {
    const soon = { ...assignment, dueAt: '2026-10-13T08:00:00Z' };
    const planned = { ...link, startAt: '2026-10-12T08:00:00Z', endAt: '2026-10-12T08:50:00Z' };
    const value = snapshot({ assignments: [soon], links: [planned] });
    expect(checkInCandidates(value, now)[0]).toMatchObject({ kind: 'assignment', dedupeKey: `assignment:${soon.id}:2026-10-10` });
    expect(checkInCandidates(value, now)[0].body).toContain('It is due on Tuesday at 10:00');
    expect(kinds({ ...value, reports: [report()] })).toEqual([]);
    expect(kinds({ ...value, prior: [{ dedupeKey: `assignment:${soon.id}:2026-10-09`, kind: 'assignment', createdAt: '2026-10-09T10:00:00Z' }] })).toEqual([]);
    expect(kinds({ ...value, prior: [{ dedupeKey: `risk:${soon.id}:2026-10-13`, kind: 'deadline_risk', createdAt: '2026-10-10T10:00:00Z' }] })).toEqual([]);
    expect(kinds(snapshot({ assignments: [assignment] }))).toEqual([]);
  });

  it('asks about a course before its exam, at most weekly', () => {
    const course = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Linear Algebra', examDate: '2026-10-22' };
    const [draft] = checkInCandidates(snapshot({ courses: [course, { ...course, id: '00000000-0000-4000-8000-0000000000c2', name: 'Far away', examDate: '2027-01-20' }] }), now);
    expect(draft.body).toBe('How is studying for Linear Algebra going? The exam is on 22 October, 12 days away.');
    expect(kinds(snapshot({ courses: [course], prior: [{ dedupeKey: `course:${course.id}:2026-10-05`, kind: 'course', createdAt: '2026-10-05T10:00:00Z' }] }))).toEqual([]);
  });

  it('falls back to a general question once a day when the student has been quiet', () => {
    expect(dueCheckIns(snapshot({ lastStudentMessageAt: null }), now)[0]).toMatchObject({ kind: 'general', dedupeKey: 'general:2026-10-10', body: expect.stringContaining('How is studying going this week?') });
    expect(dueCheckIns(snapshot({ lastStudentMessageAt: '2026-10-10T08:00:00Z' }), now)).toEqual([]);
    expect(checkInCandidates(snapshot({ lastStudentMessageAt: null, prior: [{ dedupeKey: 'general:2026-10-10', kind: 'general', createdAt: '2026-10-10T07:00:00Z' }] }), now)).toEqual([]);
  });

  it('opens one check-in at a time, most pressing first', () => {
    const urgent = { ...assignment, id: '00000000-0000-4000-8000-000000000002', title: 'Algorithms sheet', dueAt: '2026-10-11T16:00:00Z' };
    const value = snapshot({ assignments: [assignment, urgent], links: [link], lastStudentMessageAt: null });
    expect(kinds(value)).toEqual(['session_follow_up', 'deadline_risk', 'assignment', 'general']);
    expect(dueCheckIns(value, now).map(draft => draft.kind)).toEqual(['session_follow_up']);
  });

  it('holds unsolicited check-ins while paused, in quiet hours, after three a day and within an hour of the last', () => {
    const value = snapshot({ assignments: [assignment], links: [link] });
    const prior = (createdAt: string, index = 0) => ({ dedupeKey: `general:x${index}`, kind: 'general' as const, createdAt });
    expect(dueCheckIns({ ...value, paused: true }, now)).toEqual([]);
    expect(dueCheckIns({ ...value, prior: [prior('2026-10-10T12:30:00Z')] }, now)).toEqual([]);
    expect(dueCheckIns({ ...value, prior: [prior('2026-10-10T11:30:00Z')] }, now)).toHaveLength(1);
    expect(dueCheckIns({ ...value, prior: [prior('2026-10-10T06:30:00Z', 1), prior('2026-10-10T08:00:00Z', 2), prior('2026-10-10T10:00:00Z', 3)] }, now)).toEqual([]);
    // Yesterday's check-ins (before Zurich midnight) do not count toward today.
    expect(dueCheckIns({ ...value, prior: [prior('2026-10-09T18:00:00Z', 1), prior('2026-10-09T19:00:00Z', 2), prior('2026-10-09T21:30:00Z', 3)] }, now)).toHaveLength(1);
    // 21:59 and 08:00 Zurich are allowed; 22:00 and 07:59 are quiet. The session ended 20 minutes before each.
    const ending = (at: string) => ({ ...value, links: [{ ...link, endAt: new Date(Date.parse(at) - 20 * 60_000).toISOString() }] });
    for (const [at, quiet] of [['2026-10-10T19:59:00Z', false], ['2026-10-10T20:00:00Z', true], ['2026-10-11T05:59:00Z', true], ['2026-10-11T06:00:00Z', false]] as const) {
      expect(inQuietHours(new Date(at))).toBe(quiet);
      expect(dueCheckIns(ending(at), new Date(at))).toHaveLength(quiet ? 0 : 1);
    }
  });

  it('keeps quiet hours on Zurich wall-clock time across the end of daylight saving', () => {
    // 25 October 2026: clocks go back at 03:00. 07:30 Zurich is 06:30Z after the change.
    expect(inQuietHours(new Date('2026-10-25T06:30:00Z'))).toBe(true);
    expect(inQuietHours(new Date('2026-10-25T07:00:00Z'))).toBe(false);
    expect(inQuietHours(new Date('2026-10-24T06:00:00Z'))).toBe(false);
  });

  it('lets the student ask for a check-in at any time, even with nothing specific to ask', () => {
    const night = new Date('2026-10-10T21:30:00Z');
    const forced = dueCheckIns(snapshot({ paused: true, prior: [{ dedupeKey: 'general:2026-10-10', kind: 'general', createdAt: '2026-10-10T21:00:00Z' }] }), night, { force: true });
    expect(forced).toHaveLength(1);
    expect(forced[0]).toMatchObject({ kind: 'general', dedupeKey: `general:2026-10-10:asked:${night.getTime()}` });
    expect(dueCheckIns(snapshot({ assignments: [assignment], links: [{ ...link, endAt: '2026-10-10T21:00:00Z' }], paused: true }), night, { force: true })[0].kind).toBe('session_follow_up');
  });

  it('formats effort and bounds long titles', () => {
    expect([effortText(45), effortText(60), effortText(150)]).toEqual(['45 min', '1 h', '2 h 30 min']);
    const long = { ...assignment, title: 'x'.repeat(200), dueAt: '2026-10-11T16:00:00Z' };
    const [draft] = checkInCandidates(snapshot({ assignments: [long] }), now);
    expect(draft.title.length).toBeLessThanOrEqual(120);
    expect(draft.body).toContain(`“${'x'.repeat(79)}…”`);
  });
});

describe('check-in delivery', () => {
  function memoryStore(value: CheckInSnapshot) {
    const chats = new Map<string, string>();
    const deliveries: Array<{ chatId: string; channel: string; status: string }> = [];
    const store: CheckInStore = {
      snapshot: async () => ({ ...value, prior: [...chats.keys()].map(dedupeKey => ({ dedupeKey, kind: 'general' as const, createdAt: '2026-10-01T00:00:00Z' })) }),
      open: async (_owner, draft) => { if (chats.has(draft.dedupeKey)) return null; chats.set(draft.dedupeKey, `chat-${chats.size + 1}`); return chats.get(draft.dedupeKey)!; },
      recordDelivery: async (_owner, chatId, channel, outcome) => { deliveries.push({ chatId, channel, status: outcome.status }); },
    };
    return { store, chats, deliveries };
  }

  it('opens a due chat once and records a delivery per channel', async () => {
    const { store, chats, deliveries } = memoryStore(snapshot({ assignments: [assignment], links: [link] }));
    const failing: CheckInChannel = { id: 'telegram', deliver: async () => { throw new Error('timeout'); } };
    const opened = await runCheckIns('owner', store, [webCheckInChannel, failing], now);
    expect(opened.map(item => item.draft.dedupeKey)).toEqual(['session:study1:2']);
    // A send that may have gone out is recorded as unknown, not retried.
    expect(deliveries).toEqual([{ chatId: 'chat-1', channel: 'web', status: 'sent' }, { chatId: 'chat-1', channel: 'telegram', status: 'unknown' }]);
    expect(await runCheckIns('owner', store, [webCheckInChannel], now)).toEqual([]);
    expect(chats.size).toBe(1);
  });

  it('announces nothing when another run already opened the same question', async () => {
    const { store, deliveries } = memoryStore(snapshot({ assignments: [assignment], links: [link] }));
    store.open = async () => null;
    expect(await runCheckIns('owner', store, [webCheckInChannel], now)).toEqual([]);
    expect(deliveries).toEqual([]);
  });
});

describe('chat contracts', () => {
  it('accepts only the supported chat actions', () => {
    const chatId = '00000000-0000-4000-8000-000000000001';
    expect(parseChatMutation({ action: 'read', chatId: chatId.toUpperCase() })).toEqual({ action: 'read', chatId });
    expect(parseChatMutation({ action: 'pause_check_ins', paused: true })).toEqual({ action: 'pause_check_ins', paused: true });
    expect(parseChatMutation({ action: 'check_in_now' })).toEqual({ action: 'check_in_now' });
    for (const value of [null, {}, { action: 'read', chatId: 'nope' }, { action: 'pause_check_ins', paused: 'yes' }, { action: 'check_in_now', ownerId: chatId }, { action: 'read', chatId, ownerId: chatId }]) {
      expect(() => parseChatMutation(value)).toThrow();
    }
  });
});
