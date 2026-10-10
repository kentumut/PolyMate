import type { OperationResult, StudyBlockInput } from './calendar';

export type MoodleCourse = { id: number; name: string };
export type MoodleAssignment = {
  id: number; courseId: number; courseName: string; title: string; description: string;
  dueAt: string | null; opensAt: string | null; sourceUrl: string;
};
export type MoodleAnnouncement = {
  id: number; courseId: number; title: string; text: string; postedAt: string; sourceUrl: string;
};
export type MoodleSnapshot = {
  courses: MoodleCourse[]; assignments: MoodleAssignment[]; announcements: MoodleAnnouncement[];
  fetchedAt: string; warnings: string[];
  source?: 'calendar-subscription' | 'rest-api';
  calendarEvents?: MoodleCalendarEvent[];
};
export type MoodleCalendarEvent = {
  id: number; title: string; description: string; courseName: string;
  startAt: string; endAt: string; allDay: boolean; sourceUrl: string;
};
export type AssignmentStatus = { submitted: boolean | null; extensionDueAt: string | null };
export interface MoodleReader {
  snapshot(): Promise<MoodleSnapshot>;
  assignmentStatus(assignmentId: number): Promise<AssignmentStatus>;
}
export type TimelineRequest = {
  /** Effort is an estimate supplied by the student/AI, never a Moodle fact. */
  work: { assignmentId: number; estimatedMinutes: number; /** Readable calendar title chosen by the agent. */ label?: string }[];
  /** Explicit ISO instants with offsets; windows must not overlap. */
  availability: { startAt: string; endAt: string }[];
};
export type TimelineBlock = StudyBlockInput & { assignmentId: number; sourceUrl: string; operationId: string };
export type AssignmentTimeline = {
  id: string; blocks: TimelineBlock[]; warnings: string[];
  unscheduled: { assignmentId: number; remainingMinutes: number; reason: string }[];
};
export type ScheduledTimeline = { timelineId: string; results: OperationResult[]; complete: boolean };
