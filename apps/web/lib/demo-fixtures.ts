import type { Assignment } from '@polymate/contracts/assignments';
import type { CalendarEvent, OperationResult } from '@polymate/contracts/calendar';
import type { CoachingState, StudentMemory } from '@polymate/contracts/coaching';
import type { Course } from '@polymate/contracts/courses';
import type { AssignmentTimeline, MoodleSnapshot } from '@polymate/contracts/moodle';
import { CALENDAR_TIMEZONE, shiftWeek, weekRange, zonedParts, zonedTimeToInstant, type DateRange } from '@polymate/contracts/time';

export type DemoStage = 'brief' | 'remember' | 'plan' | 'approve' | 'move' | 'complete';

export const DEMO_PROMPTS: Record<Exclude<DemoStage, 'approve' | 'complete'>, string> = {
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
  return zonedTimeToInstant({ year: monday.year, month: monday.month, day: monday.day + dayOffset, hour, minute }).toISOString();
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

export function demoTimeline(now: Date | string): AssignmentTimeline {
  const range = nextDemoWeek(now);
  const sourceUrl = 'https://moodle-app2.let.ethz.ch/';
  return {
    id: 'demo-algorithms-plan',
    blocks: [
      { assignmentId: MOODLE_ASSIGNMENT_ID, title: 'Algorithms PS4 · Dynamic programming', startAt: at(range, 0, 16), endAt: at(range, 0, 16, 50), sourceUrl, operationId: '10000000-0000-5000-a000-000000000001' },
      { assignmentId: MOODLE_ASSIGNMENT_ID, title: 'Algorithms PS4 · Exercises', startAt: at(range, 1, 18), endAt: at(range, 1, 18, 50), sourceUrl, operationId: '10000000-0000-5000-a000-000000000002' },
      { assignmentId: MOODLE_ASSIGNMENT_ID, title: 'Algorithms PS4 · Final review', startAt: at(range, 3, 17, 10), endAt: at(range, 3, 18), sourceUrl, operationId: '10000000-0000-5000-a000-000000000003' },
    ],
    unscheduled: [],
    warnings: ['Study effort is an estimate. Check the assignment requirements and timeline before relying on it.'],
  };
}

export function demoMovedBlock(now: Date | string) {
  const range = nextDemoWeek(now);
  return { startAt: at(range, 4, 16), endAt: at(range, 4, 16, 50) };
}

export function demoInitialMemories(now: Date | string): StudentMemory[] {
  return [{
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    category: 'preference',
    content: 'Prefers focused study sessions of at most 50 minutes.',
    validUntil: null,
    createdAt: typeof now === 'string' ? now : now.toISOString(),
  }];
}

export function demoVolunteerMemory(now: Date | string): StudentMemory {
  const range = nextDemoWeek(now);
  return {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    category: 'plan',
    content: 'Volunteering next Wednesday from 17:00 to 20:00.',
    validUntil: range.to,
    createdAt: typeof now === 'string' ? now : now.toISOString(),
  };
}

export function demoCoachingState(now: Date | string, memories: StudentMemory[]): CoachingState {
  const range = nextDemoWeek(now);
  return {
    currentWeekStart: range.from.slice(0, 10),
    messages: [{
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

