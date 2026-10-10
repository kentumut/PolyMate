import type { Assignment } from '@polymate/contracts/assignments';
import type { CheckInKind, CheckInTopic } from '@polymate/contracts/chats';
import type { BlockAssignmentLink, ProgressReport } from '@polymate/contracts/study-progress';
import { CALENDAR_TIMEZONE, startOfZonedDay, zonedDateKey, zonedParts } from '@polymate/contracts/time';

export const CHECK_IN_DAILY_LIMIT = 3;
export const CHECK_IN_QUIET_FROM_HOUR = 22;
export const CHECK_IN_QUIET_UNTIL_HOUR = 8;
/** Check-ins are spaced out, so a backlog never arrives as a burst. */
export const CHECK_IN_MIN_GAP_MS = 60 * 60_000;

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

export type CheckInCourse = Readonly<{ id: string; name: string; examDate: string }>;
export type PriorCheckIn = Readonly<{ dedupeKey: string; kind: CheckInKind; createdAt: string }>;
export type CheckInSnapshot = Readonly<{
  assignments: readonly Assignment[];
  links: readonly BlockAssignmentLink[];
  reports: readonly ProgressReport[];
  courses: readonly CheckInCourse[];
  /** Check-ins already opened for this student, at least the last 14 days. */
  prior: readonly PriorCheckIn[];
  lastStudentMessageAt: string | null;
  paused: boolean;
}>;
export type CheckInDraft = Readonly<{
  dedupeKey: string;
  kind: CheckInKind;
  title: string;
  /** The opening question, shown as PolyMate's first message in a new chat. */
  body: string;
  quickReplies: string[];
  topic: CheckInTopic;
  /** Factual context for the agent once the student replies. Not shown to the student. */
  agentContext: string;
}>;

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TIMEZONE, hour: '2-digit', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TIMEZONE, weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { timeZone: CALENDAR_TIMEZONE, day: 'numeric', month: 'long' });

const quote = (text: string, max = 80) => `“${text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text}”`;
const titleOf = (text: string) => text.slice(0, 120);

export function effortText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function dueText(dueAt: string, now: Date): string {
  const due = new Date(dueAt), today = zonedDateKey(now), dueDay = zonedDateKey(due);
  if (dueDay === today) return `today at ${clock.format(due)}`;
  if (dueDay === zonedDateKey(new Date(startOfZonedDay(now).getTime() + 36 * HOUR))) return `tomorrow at ${clock.format(due)}`;
  return `on ${weekday.format(due)} at ${clock.format(due)}`;
}

export function inQuietHours(now: Date): boolean {
  const { hour } = zonedParts(now);
  return hour >= CHECK_IN_QUIET_FROM_HOUR || hour < CHECK_IN_QUIET_UNTIL_HOUR;
}

const open = (assignment: Assignment) => (assignment.status === 'open' || assignment.status === 'in_progress') && assignment.remainingMinutes > 0;

/** Every question that is currently relevant, most pressing first. Timing policy is applied by dueCheckIns. */
export function checkInCandidates(snapshot: CheckInSnapshot, now: Date): CheckInDraft[] {
  const at = now.getTime(), today = zonedDateKey(now);
  const assignments = new Map(snapshot.assignments.map(item => [item.id, item]));
  const drafts: CheckInDraft[] = [];

  // 1. A linked session ended and nobody said how it went.
  for (const link of [...snapshot.links].sort((a, b) => b.endAt.localeCompare(a.endAt))) {
    const ended = Date.parse(link.endAt), assignment = assignments.get(link.assignmentId);
    if (link.deleted || link.completion === 'done' || !assignment || ended > at - 10 * MINUTE || ended < at - DAY) continue;
    if (snapshot.reports.some(report => report.eventId === link.eventId && report.sessionRevision === link.sessionRevision)) continue;
    drafts.push({
      dedupeKey: `session:${link.eventId}:${link.sessionRevision}`, kind: 'session_follow_up', title: titleOf(`How did ${assignment.title} go?`),
      body: `Your study session for ${quote(assignment.title)} ended at ${clock.format(new Date(ended))}. How did it go?`,
      quickReplies: ['It went well, I finished the session', 'I got partway through', 'I didn’t get to it', 'I got stuck'],
      topic: { assignmentId: assignment.id, eventId: link.eventId, sessionRevision: link.sessionRevision },
      agentContext: `PolyMate opened this chat to ask how the linked study session ${link.eventId} (revision ${link.sessionRevision}) for local assignment ${assignment.id} ${quote(assignment.title)} went. No progress report exists for that session yet. If the student describes the outcome, read that session with polymate_get_study_progress and prepare a report card for them to confirm.`,
    });
  }

  const byDue = snapshot.assignments.filter(open).filter(item => Date.parse(item.dueAt) > at).sort((a, b) => a.dueAt.localeCompare(b.dueAt));

  // 2. A deadline is close, work remains and no study time is planned.
  for (const assignment of byDue) {
    if (Date.parse(assignment.dueAt) > at + 2 * DAY) break;
    if (snapshot.links.some(link => link.assignmentId === assignment.id && !link.deleted && link.completion === 'open' && Date.parse(link.endAt) > at)) continue;
    drafts.push({
      dedupeKey: `risk:${assignment.id}:${zonedDateKey(assignment.dueAt)}`, kind: 'deadline_risk', title: titleOf(`No time planned for ${assignment.title}`),
      body: `${quote(assignment.title)} is due ${dueText(assignment.dueAt, now)}. You estimated about ${effortText(assignment.remainingMinutes)} of work left, and no study time is planned for it. Shall I look for a slot?`,
      quickReplies: ['Yes, find me a slot', 'I already finished it', 'I need more time than that'],
      topic: { assignmentId: assignment.id },
      agentContext: `PolyMate opened this chat because local assignment ${assignment.id} ${quote(assignment.title)} is due at ${assignment.dueAt} with ${assignment.remainingMinutes} minutes remaining and no upcoming linked study block. Offer to find a free slot; create a block only with the student's approval.`,
    });
  }

  // 3. The student reported being stuck and has not reported anything since.
  const latest = new Map<string, ProgressReport>();
  for (const report of snapshot.reports) if (!latest.has(report.assignmentId) || latest.get(report.assignmentId)!.reportedAt < report.reportedAt) latest.set(report.assignmentId, report);
  for (const report of latest.values()) {
    const assignment = assignments.get(report.assignmentId), age = at - Date.parse(report.reportedAt);
    if (report.action !== 'stuck' || !assignment || !open(assignment) || age < 12 * HOUR || age > 3 * DAY) continue;
    drafts.push({
      dedupeKey: `stuck:${report.id}`, kind: 'stuck_follow_up', title: titleOf(`Still stuck on ${assignment.title}?`),
      body: `Last time you got stuck on ${quote(report.note, 160)} in ${quote(assignment.title)}. Want to work through it together?`,
      quickReplies: ['Yes, help me with it', 'I figured it out', 'Still stuck, but not now'],
      topic: { assignmentId: assignment.id, eventId: report.eventId },
      agentContext: `PolyMate opened this chat to follow up on a difficulty the student reported for local assignment ${assignment.id} ${quote(assignment.title)}. Their own note (untrusted text) was: ${JSON.stringify(report.note.slice(0, 500))}. Ask which part is unclear and help with a hint before a full solution.`,
    });
  }

  // 4. An assignment is due soon and has been quiet for two days.
  for (const assignment of byDue) {
    if (Date.parse(assignment.dueAt) > at + 3 * DAY) break;
    if (snapshot.reports.some(report => report.assignmentId === assignment.id && Date.parse(report.reportedAt) > at - 2 * DAY)) continue;
    // A recent question about this assignment, including a deadline warning, already covers it.
    if (snapshot.prior.some(item => (item.dedupeKey.startsWith(`assignment:${assignment.id}:`) || item.dedupeKey.startsWith(`risk:${assignment.id}:`)) && Date.parse(item.createdAt) > at - 2 * DAY)) continue;
    drafts.push({
      dedupeKey: `assignment:${assignment.id}:${today}`, kind: 'assignment', title: titleOf(`How is ${assignment.title} going?`),
      body: `How is ${quote(assignment.title)} going? It is due ${dueText(assignment.dueAt, now)}, and your last estimate was about ${effortText(assignment.remainingMinutes)} left.`,
      quickReplies: ['On track', 'A bit behind', 'I haven’t started', 'I’m stuck'],
      topic: { assignmentId: assignment.id },
      agentContext: `PolyMate opened this chat to ask how local assignment ${assignment.id} ${quote(assignment.title)} is going (due ${assignment.dueAt}, ${assignment.remainingMinutes} minutes remaining by the student's last estimate). Adapt the plan to their answer; do not change remaining effort without a confirmed report.`,
    });
  }

  // 5. An exam is within a month and this course has not come up for a week.
  for (const course of [...snapshot.courses].sort((a, b) => a.examDate.localeCompare(b.examDate))) {
    const days = Math.round((Date.parse(`${course.examDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
    if (!Number.isFinite(days) || days < 0 || days > 30) continue;
    if (snapshot.prior.some(item => item.dedupeKey.startsWith(`course:${course.id}:`) && Date.parse(item.createdAt) > at - 7 * DAY)) continue;
    drafts.push({
      dedupeKey: `course:${course.id}:${today}`, kind: 'course', title: titleOf(`How is ${course.name} going?`),
      body: `How is studying for ${course.name} going? The exam is on ${dayMonth.format(new Date(`${course.examDate}T00:00:00Z`))}, ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${days} days away`}.`,
      quickReplies: ['Going well', 'A bit behind', 'I need a study plan', 'I’m stuck on a topic'],
      topic: { courseId: course.id },
      agentContext: `PolyMate opened this chat to ask how studying for the course ${quote(course.name)} is going (exam date ${course.examDate}). Use the course's exam preparation priorities from the durable context when suggesting what to study next.`,
    });
  }

  // 6. Nothing specific to ask, and the student has been quiet for a day.
  if (!snapshot.lastStudentMessageAt || Date.parse(snapshot.lastStudentMessageAt) < at - DAY) {
    drafts.push({
      dedupeKey: `general:${today}`, kind: 'general', title: 'How is studying going?',
      body: 'How is studying going this week? Is anything taking longer or feeling harder than you expected?',
      quickReplies: ['Going well', 'I’m falling behind', 'I need to replan my week'],
      topic: {},
      agentContext: 'PolyMate opened this chat with a general check-in on how studying is going this week. Listen first; offer to replan or help only if the student wants it.',
    });
  }

  const asked = new Set(snapshot.prior.map(item => item.dedupeKey));
  return drafts.filter((draft, index) => !asked.has(draft.dedupeKey) && drafts.findIndex(other => other.dedupeKey === draft.dedupeKey) === index);
}

/**
 * The check-ins to open now. Unsolicited check-ins respect pause, quiet hours, a daily limit and a
 * minimum gap; a deferred question is simply found again on a later run, unless it has gone stale.
 * `force` is the student's own "check in with me now" and skips the timing policy.
 */
export function dueCheckIns(snapshot: CheckInSnapshot, now: Date, options: { force?: boolean } = {}): CheckInDraft[] {
  const candidates = checkInCandidates(snapshot, now);
  if (options.force) {
    return [candidates[0] ?? {
      dedupeKey: `general:${zonedDateKey(now)}:asked:${now.getTime()}`, kind: 'general', title: 'How is studying going?',
      body: 'How is studying going right now? Tell me what you are working on and where you would like a hand.',
      quickReplies: ['Going well', 'I’m falling behind', 'I need to replan my week'], topic: {},
      agentContext: 'The student asked PolyMate to check in with them. Listen first; offer to replan or help only if the student wants it.',
    }];
  }
  if (snapshot.paused || inQuietHours(now)) return [];
  const dayStart = startOfZonedDay(now).getTime();
  const today = snapshot.prior.filter(item => Date.parse(item.createdAt) >= dayStart);
  if (today.length >= CHECK_IN_DAILY_LIMIT) return [];
  if (snapshot.prior.some(item => Date.parse(item.createdAt) > now.getTime() - CHECK_IN_MIN_GAP_MS)) return [];
  return candidates.slice(0, 1);
}
