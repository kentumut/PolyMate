import type { MscCsMajor, MscCsMinor } from '@polymate/core/vvz';

export type CourseStatus = 'passed' | 'in_progress' | 'planned';
export type PlannedCourse = {
  id: number;
  semester: string;
  number: string | null;
  title: string | null;
  credits: number | null;
  officialVvzUrl: string;
  status: CourseStatus;
  sourceSemester?: string;
};
export type SemesterPlan = { major: MscCsMajor; minor: MscCsMinor; activeSemester: string; targetCredits: number; courses: PlannedCourse[] };

export function currentSemester(date = new Date()): string {
  return `${date.getFullYear()}${date.getMonth() >= 6 ? 'W' : 'S'}`;
}

export function nextSemester(semester: string): string {
  const match = /^(\d{4})([SW])$/.exec(semester);
  if (!match) return currentSemester();
  return match[2] === 'S' ? `${match[1]}W` : `${Number(match[1]) + 1}S`;
}

export function semesterSequence(start: string, count = 6): string[] {
  const result = [start];
  while (result.length < count) result.push(nextSemester(result.at(-1)!));
  return result;
}

export function semesterRange(start: string, end: string): string[] {
  const result = [start];
  while (result.at(-1)! !== end) {
    const next = nextSemester(result.at(-1)!);
    if (next === result.at(-1)! || result.length >= 100) return [];
    result.push(next);
  }
  return result;
}

export function creditsForSemester(courses: readonly PlannedCourse[], semester: string): number {
  return courses.filter(course => course.semester === semester).reduce((sum, course) => sum + (course.credits ?? 0), 0);
}

export function workloadLabel(credits: number, target: number): string {
  if (credits === 0) return 'No courses yet';
  if (credits < target - 4) return `${target - credits} ECTS below your target`;
  if (credits > target) return `${credits - target} ECTS above your hard limit`;
  if (credits === target) return 'At your target';
  return 'Close to your target';
}
