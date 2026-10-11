import { describe, expect, it } from 'vitest';
import { parseSemesterPlan, parseSemesterPlanToolRequest, SEMESTER_PLAN_TOOL_DEFINITION } from '../packages/core/integrations/vvz/semester-plan';

const course = {
  id: 204421,
  semester: '2026W',
  number: '263-0001-00L',
  title: 'Visual Intelligence',
  credits: 6,
  officialVvzUrl: 'https://www.vvz.ethz.ch/Vorlesungsverzeichnis/lerneinheit.view?lerneinheitId=204421',
  status: 'planned',
} as const;

describe('semester-plan agent tool contract', () => {
  it('validates the browser plan and preserves only the bounded contract', () => {
    const plan = { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30, courses: [course] };
    expect(parseSemesterPlan(plan)).toEqual(plan);
    expect(() => parseSemesterPlan({ ...plan, ownerId: 'forged' })).toThrow('unsupported fields');
    expect(() => parseSemesterPlan({ ...plan, courses: [course, course] })).toThrow('only once');
  });

  it('requires a course only for alternative suggestions', () => {
    expect(parseSemesterPlanToolRequest({ action: 'suggest_alternative', courseId: 204421 })).toEqual({ action: 'suggest_alternative', courseId: 204421 });
    expect(parseSemesterPlanToolRequest({ action: 'check_graduation' })).toEqual({ action: 'check_graduation' });
    expect(() => parseSemesterPlanToolRequest({ action: 'suggest_alternative' })).toThrow('positive courseId');
    expect(() => parseSemesterPlanToolRequest({ action: 'improve_plan', courseId: 204421 })).toThrow('only supported');
    expect(SEMESTER_PLAN_TOOL_DEFINITION.name).toBe('polymate_semester_plan');
  });
});
