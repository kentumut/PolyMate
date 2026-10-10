import type { Assignment, AssignmentInput } from '@polymate/contracts/assignments';
import type { CalendarEvent, OperationResult } from '@polymate/contracts/calendar';
import type { CoachingState, StudentMemory } from '@polymate/contracts/coaching';
import type { Course } from '@polymate/contracts/courses';
import type { AssignmentTimeline, MoodleSnapshot } from '@polymate/contracts/moodle';
import { CALENDAR_TIMEZONE, shiftWeek, weekRange, zonedParts, zonedTimeToInstant, type DateRange } from '@polymate/contracts/time';

export type DemoStage = 'onboarding' | 'brief' | 'remember' | 'plan' | 'approve' | 'move' | 'complete';
export type DemoGoal = 'deadline' | 'exam' | 'balance';
export type DemoSessionMinutes = 30 | 50;
export type DemoCoachCadence = 'proactive' | 'weekly';
export type DemoCommitment = 'volunteering' | 'rehearsal';
export type DemoPlanStyle = 'spread' | 'frontload';
export type DemoMoveTarget = 'friday-15' | 'friday-16';

export type DemoProfile = Readonly<{
  goal: DemoGoal;
  sessionMinutes: DemoSessionMinutes;
  coachCadence: DemoCoachCadence;
}>;

export const DEMO_ONBOARDING_OPTIONS = {
  goal: [
    { value: 'deadline' as const, label: 'Finish urgent work', description: 'Lead with deadlines and submission risk.' },
    { value: 'exam' as const, label: 'Build exam confidence', description: 'Connect weekly work to exam priorities.' },
    { value: 'balance' as const, label: 'Keep the week sustainable', description: 'Protect recovery time while staying current.' },
  ],
  sessionMinutes: [
    { value: 50 as const, label: '50-minute focus', description: 'Fewer, deeper study blocks.' },
    { value: 30 as const, label: '30-minute sprints', description: 'More short sessions with breaks.' },
  ],
  coachCadence: [
    { value: 'proactive' as const, label: 'Frequent check-ins', description: 'Follow up on risks, workload, and recent study sessions.' },
    { value: 'weekly' as const, label: 'Weekly check-in', description: 'Use one structured planning review each week.' },
  ],
} as const;

export const DEMO_ASSIGNMENT_CAPTURE_PROMPT = 'I want to add an assignment: Computer Vision exercise sheet 4 is due next Thursday at 18:00 and should take about 3 hours. Use Zurich time.';

export const DEMO_PROMPTS: Record<Exclude<DemoStage, 'onboarding' | 'approve' | 'complete'>, string> = {
  brief: 'What should I focus on this week?',
  remember: 'Remember that I volunteer next Wednesday from 17:00 to 20:00.',
  plan: 'Plan 150 minutes for Algorithms problem set 4 before Friday. I can study Monday to Thursday from 16:00 to 20:00.',
  move: 'Thursday no longer works. Move the final review to Friday at 16:00.',
};

export const DEMO_COURSES: Course[] = [{
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Algorithms and Data Structures',
  exerciseSessionCount: 12,
  lectureHoursPerWeek: 4,
  exerciseSessionMinutes: 120,
  examDate: '2027-01-25',
  version: 1,
  examPrep: {
    must: ['Dynamic programming sheets', 'Past exam 2025'],
    optional: ['Extra graph problems'],
    not_required: ['Optional coding project'],
  },
}];

const DEMO_ASSIGNMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MOODLE_ASSIGNMENT_ID = 404;

function nextDemoWeek(now: Date | string): DateRange {
  return shiftWeek(weekRange(now), 1);
}

function at(range: DateRange, dayOffset: number, hour: number, minute = 0): string {
  const monday = zonedParts(range.from);
  const totalMinutes = hour * 60 + minute;
  return zonedTimeToInstant({
    year: monday.year,
    month: monday.month,
    day: monday.day + dayOffset + Math.floor(totalMinutes / (24 * 60)),
    hour: Math.floor((totalMinutes % (24 * 60)) / 60),
    minute: totalMinutes % 60,
  }).toISOString();
}

function calendarEvent(range: DateRange, id: string, title: string, day: number, startHour: number, endHour: number, startMinute = 0, endMinute = 0): CalendarEvent {
  return {
    id,
    title,
    startAt: at(range, day, startHour, startMinute),
    endAt: at(range, day, endHour, endMinute),
    timezone: CALENDAR_TIMEZONE,
    allDay: false,
    source: 'google-personal',
    editable: false,
    completion: 'open',
    etag: '"demo-1"',
  };
}

export function demoWeekRange(now: Date | string): DateRange {
  return nextDemoWeek(now);
}

export function demoCalendarEvents(now: Date | string): CalendarEvent[] {
  const range = nextDemoWeek(now);
  return [
    calendarEvent(range, 'demo-analysis', 'Algorithms lecture', 0, 10, 12),
    calendarEvent(range, 'demo-job', 'Student job', 1, 14, 18),
    calendarEvent(range, 'demo-systems', 'Systems lecture', 2, 10, 12),
    calendarEvent(range, 'demo-project', 'Team project', 3, 16, 17),
    calendarEvent(range, 'demo-climbing', 'Climbing', 4, 17, 19, 30),
  ];
}

export function demoAssignment(now: Date | string): Assignment {
  const range = nextDemoWeek(now);
  return {
    id: DEMO_ASSIGNMENT_ID,
    title: 'Algorithms problem set 4',
    dueAt: at(range, 4, 18),
    estimatedMinutes: 150,
    remainingMinutes: 150,
    status: 'open',
    version: 1,
  };
}

export function demoCapturedAssignment(now: Date | string): AssignmentInput {
  const range = nextDemoWeek(now);
  return { title: 'Computer Vision exercise sheet 4', dueAt: at(range, 3, 18), estimatedMinutes: 180 };
}

export function demoMoodleSnapshot(now: Date | string): MoodleSnapshot {
  const range = nextDemoWeek(now);
  const dueAt = at(range, 4, 18);
  return {
    source: 'rest-api',
    courses: [{ id: 77, name: 'Algorithms and Data Structures' }],
    assignments: [{
      id: MOODLE_ASSIGNMENT_ID,
      courseId: 77,
      courseName: 'Algorithms and Data Structures',
      title: 'Problem set 4',
      description: 'Dynamic programming and graph exercises.',
      dueAt,
      opensAt: at(range, 0, 8),
      sourceUrl: 'https://moodle-app2.let.ethz.ch/',
    }],
    announcements: [],
    calendarEvents: [],
    fetchedAt: typeof now === 'string' ? now : now.toISOString(),
    warnings: [],
  };
}

export function demoTimeline(now: Date | string, options: { sessionMinutes?: DemoSessionMinutes; style?: DemoPlanStyle; commitment?: DemoCommitment } = {}): AssignmentTimeline {
  const range = nextDemoWeek(now);
  const sourceUrl = 'https://moodle-app2.let.ethz.ch/';
  const sessionMinutes = options.sessionMinutes ?? 50;
  const style = options.style ?? 'spread';
  const commitment = options.commitment ?? 'volunteering';
  const slots = sessionMinutes === 50
    ? style === 'frontload'
      ? [[0, 16, 0], [0, 17, 0], [1, 18, 0]]
      : commitment === 'rehearsal'
        ? [[0, 16, 0], [1, 18, 0], [2, 16, 0]]
        : [[0, 16, 0], [1, 18, 0], [3, 17, 10]]
    : style === 'frontload'
      ? [[0, 16, 0], [0, 16, 40], [0, 17, 20], [1, 18, 0], [1, 18, 40]]
      : commitment === 'rehearsal'
        ? [[0, 16, 0], [0, 16, 40], [1, 18, 0], [2, 16, 0], [2, 16, 40]]
        : [[0, 16, 0], [0, 16, 40], [1, 18, 0], [3, 17, 10], [3, 17, 50]];
  const labels = sessionMinutes === 50
    ? ['Dynamic programming', 'Exercises', 'Final review']
    : ['Dynamic programming', 'DP exercises', 'Graph exercises', 'Check solutions', 'Final review'];
  return {
    id: `demo-algorithms-${sessionMinutes}-${style}-${commitment}`,
    blocks: slots.map(([day, hour, minute], index) => ({
      assignmentId: MOODLE_ASSIGNMENT_ID,
      title: `Algorithms PS4 · ${labels[index]}`,
      startAt: at(range, day, hour, minute),
      endAt: at(range, day, hour, minute + sessionMinutes),
      sourceUrl,
      operationId: `10000000-0000-5000-a000-${String(index + 1).padStart(12, '0')}`,
    })),
    unscheduled: [],
    warnings: ['Study effort is an estimate. Check the assignment requirements and timeline before relying on it.'],
  };
}

export function demoMovedBlock(now: Date | string, target: DemoMoveTarget = 'friday-16', sessionMinutes: DemoSessionMinutes = 50) {
  const range = nextDemoWeek(now);
  const hour = target === 'friday-15' ? 15 : 16;
  return { startAt: at(range, 4, hour), endAt: at(range, 4, hour, sessionMinutes) };
}

export function demoInitialMemories(now: Date | string, sessionMinutes: DemoSessionMinutes = 50): StudentMemory[] {
  return [{
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    category: 'preference',
    content: `Prefers focused study sessions of at most ${sessionMinutes} minutes.`,
    validUntil: null,
    createdAt: typeof now === 'string' ? now : now.toISOString(),
  }];
}

export function demoVolunteerMemory(now: Date | string): StudentMemory {
  return demoCommitmentMemory(now, 'volunteering');
}

export function demoCommitmentMemory(now: Date | string, commitment: DemoCommitment): StudentMemory {
  const range = nextDemoWeek(now);
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    category: 'plan',
    content: commitment === 'volunteering'
      ? 'Volunteering next Wednesday from 17:00 to 20:00.'
      : 'Project rehearsal next Thursday from 17:00 to 19:00.',
    validUntil: range.to,
    createdAt: typeof now === 'string' ? now : now.toISOString(),
  };
}

export function demoCoachingState(now: Date | string, memories: StudentMemory[], proactive = false, answeredCount = 0): CoachingState {
  const range = nextDemoWeek(now);
  const checkIns = [{
    id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    kind: 'weekly_question' as const,
    title: 'Confirm this week’s pressure point',
    body: 'Is the Algorithms deadline still the priority, or has something changed?',
    questionKey: 'priority',
  }, ...(proactive ? [{
    id: 'abababab-abab-4bab-8bab-abababababab',
    kind: 'follow_up' as const,
    title: 'Check the workload estimate',
    body: 'Does 150 minutes still feel realistic after your latest exercise session?',
    questionKey: 'effort',
  }] : [])];
  return {
    currentWeekStart: range.from.slice(0, 10),
    messages: [...checkIns.map((item, index) => ({
      ...item,
      requiresResponse: true,
      status: index < answeredCount ? 'responded' as const : 'unread' as const,
      weekStart: range.from.slice(0, 10),
      createdAt: typeof now === 'string' ? now : now.toISOString(),
      respondedAt: index < answeredCount ? typeof now === 'string' ? now : now.toISOString() : null,
    })), {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      kind: 'digest',
      title: 'Your weekly plan is ready to shape',
      body: 'PolyMate will combine your saved preferences, course priorities, deadlines, and calendar before proposing changes.',
      requiresResponse: false,
      status: 'unread',
      weekStart: range.from.slice(0, 10),
      questionKey: null,
      createdAt: typeof now === 'string' ? now : now.toISOString(),
      respondedAt: null,
    }],
    memories,
  };
}

export function demoScheduleCard(timeline: AssignmentTimeline, results: OperationResult[]) {
  return { timeline, result: { results, complete: results.length === timeline.blocks.length && results.every(item => item.status === 'synced') } };
}

