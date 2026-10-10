import { describe, expect, it } from 'vitest';
import { creditsForSemester, currentSemester, nextSemester, semesterSequence, workloadLabel, type PlannedCourse } from '../apps/web/components/study/semester-plan-model';

const course = (id: number, semester: string, credits: number): PlannedCourse => ({ id, semester, credits, number: null, title: `Course ${id}`, officialVvzUrl: 'https://www.vvz.ethz.ch/', status: 'planned' });

describe('semester plan model', () => {
  it('creates a chronological sequence across spring and autumn semesters', () => {
    expect(nextSemester('2026S')).toBe('2026W');
    expect(nextSemester('2026W')).toBe('2027S');
    expect(semesterSequence('2026W', 4)).toEqual(['2026W', '2027S', '2027W', '2028S']);
    expect(currentSemester(new Date('2026-03-10T12:00:00Z'))).toBe('2026S');
    expect(currentSemester(new Date('2026-10-10T12:00:00Z'))).toBe('2026W');
  });

  it('keeps workload calculations scoped to one semester', () => {
    const courses = [course(1, '2026W', 8), course(2, '2026W', 6), course(3, '2027S', 10)];
    expect(creditsForSemester(courses, '2026W')).toBe(14);
    expect(creditsForSemester(courses, '2027S')).toBe(10);
    expect(workloadLabel(25, 30)).toBe('5 ECTS below your target');
    expect(workloadLabel(28, 30)).toBe('Close to your target');
    expect(workloadLabel(30, 30)).toBe('At your target');
    expect(workloadLabel(36, 30)).toBe('6 ECTS above your hard limit');
  });
});
