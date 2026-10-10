import { describe, expect, it } from 'vitest';
import { parseCourse, parseCourseMutation } from '../packages/contracts/src/courses';

const course = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Algorithms', exerciseSessionCount: 12,
  lectureHoursPerWeek: 4, exerciseSessionMinutes: 120, examDate: '2027-01-25', version: 0,
  examPrep: { must: ['Dynamic programming', 'Dynamic programming'], optional: ['Extra graphs'], not_required: [] },
};

describe('course contracts', () => {
  it('normalizes exam preparation topics and accepts half-hour lecture loads', () => {
    expect(parseCourse({ ...course, lectureHoursPerWeek: 3.5 })).toMatchObject({
      lectureHoursPerWeek: 3.5, examPrep: { must: ['Dynamic programming'], optional: ['Extra graphs'], not_required: [] },
    });
  });

  it('rejects invalid workload and unknown exam-prep priorities', () => {
    expect(() => parseCourse({ ...course, exerciseSessionCount: -1 })).toThrow('between 0 and 200');
    expect(() => parseCourse({ ...course, examPrep: { ...course.examPrep, recommended: ['Injected'] } })).toThrow('unsupported priorities');
  });

  it('requires optimistic concurrency when removing a course', () => {
    expect(parseCourseMutation({ action: 'delete', id: course.id, expectedVersion: 2 })).toEqual({ action: 'delete', id: course.id, expectedVersion: 2 });
    expect(() => parseCourseMutation({ action: 'delete', id: course.id, expectedVersion: 0 })).toThrow('version');
  });
});
