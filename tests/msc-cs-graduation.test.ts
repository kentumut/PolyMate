import { describe, expect, it, vi } from 'vitest';
import type { VvzClient, VvzCurriculumCategory } from '../packages/core/integrations/vvz/client';
import { checkMscCsGraduation, parseMscCsGraduationRequest } from '../packages/core/integrations/vvz/graduation';

const definitions: Array<{ id: number; number: string; credits: number; eligibleCategories: VvzCurriculumCategory[] }> = [
  { id: 1, number: '261-0001-00L', credits: 16, eligibleCategories: ['major_core', 'free_elective'] },
  { id: 2, number: '261-0002-00L', credits: 10, eligibleCategories: ['major_elective', 'free_elective'] },
  { id: 3, number: '261-0003-00L', credits: 18, eligibleCategories: ['minor', 'free_elective'] },
  { id: 4, number: '261-0004-00L', credits: 8, eligibleCategories: ['inter_focus', 'free_elective'] },
  { id: 5, number: '261-0005-00L', credits: 8, eligibleCategories: ['inter_focus', 'free_elective'] },
  { id: 6, number: '261-0006-00L', credits: 2, eligibleCategories: ['seminar', 'free_elective'] },
  { id: 7, number: '261-0007-00L', credits: 8, eligibleCategories: ['practical_work', 'free_elective'] },
  { id: 8, number: '851-0008-00L', credits: 2, eligibleCategories: ['science_in_perspective', 'free_elective'] },
  { id: 9, number: '261-0009-00L', credits: 30, eligibleCategories: ['masters_thesis'] },
  { id: 10, number: '261-0010-00L', credits: 18, eligibleCategories: ['free_elective'] },
];

function client() {
  return { getMscCsCurriculumCourses: vi.fn(async (ids: readonly number[]) => definitions.filter(course => ids.includes(course.id)).map(course => ({
    ...course, semester: '2026W', title: `Course ${course.id}`, language: 'English', levels: ['MSC'], examType: null,
    restricted: false, comment: null, scrapedAt: '2026-09-01T00:00:00.000Z', officialVvzUrl: `https://www.vvz.ethz.ch/${course.id}`,
  }))) } as unknown as VvzClient;
}

const request = (status: 'passed' | 'in_progress' | 'planned' = 'passed') => ({
  major: 'Machine Intelligence', minor: 'Computer Graphics', additionalRequirementsCompleted: true, failedInterFocusAttempts: 0,
  courses: definitions.map(course => ({ unitId: course.id, status })),
});

describe('MSc CS graduation evaluator', () => {
  it('validates exact programme and course inputs', () => {
    expect(parseMscCsGraduationRequest(request())).toMatchObject({ major: 'Machine Intelligence', minor: 'Computer Graphics', previousBachelorLanguageCredits: 0 });
    expect(() => parseMscCsGraduationRequest({ ...request(), courses: [] })).toThrow('1 to 50');
    expect(() => parseMscCsGraduationRequest({ ...request(), courses: [{ unitId: 1, status: 'enrolled' }] })).toThrow('passed, in_progress, or planned');
    expect(() => parseMscCsGraduationRequest({ ...request(), courses: [{ unitId: 1, status: 'passed' }, { unitId: 1, status: 'planned' }] })).toThrow('only once');
  });

  it('recognizes a valid 120-credit completed programme and thesis admission', async () => {
    const result = await checkMscCsGraduation(client(), request());
    expect(result.majorMinorCombinationValid).toBe(true);
    expect(result.completed).toMatchObject({ graduationReady: true, creditedCredits: 120, missingCreditsTo120: 0, preThesisCredits: 90 });
    expect(result.completed.requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'major_core', earned: 16, satisfied: true }),
      expect.objectContaining({ key: 'major_total', earned: 26, satisfied: true }),
      expect.objectContaining({ key: 'minor', earned: 18, satisfied: true }),
      expect.objectContaining({ key: 'inter_focus', earned: 16, courseCount: 2, satisfied: true }),
    ]));
    expect(result.thesisAdmission).toMatchObject({ ready: true, missingPreThesisCredits: 0 });
  });

  it('counts semester-specific VVZ records for the same course number only once', async () => {
    const duplicateThesis = { ...definitions[8], id: 11 };
    const duplicateClient = { getMscCsCurriculumCourses: vi.fn(async () => [...definitions, duplicateThesis].map(course => ({
      ...course, semester: course.id === 11 ? '2027S' : '2026W', title: `Course ${course.id}`, language: 'English', levels: ['MSC'], examType: null,
      restricted: false, comment: null, scrapedAt: '2026-09-01T00:00:00.000Z', officialVvzUrl: `https://www.vvz.ethz.ch/${course.id}`,
    }))) } as unknown as VvzClient;
    const result = await checkMscCsGraduation(duplicateClient, {
      ...request(), courses: [...request().courses, { unitId: 11, status: 'passed' }],
    });

    expect(result.completed.rawEligibleCredits).toBe(120);
    expect(result.completed.assignments.some(course => course.unitId === 11)).toBe(false);
    expect(result.warnings.join(' ')).toContain('counted only once');
  });

  it('keeps current classes projected and does not count them as earned', async () => {
    const input = request('passed');
    input.courses.find(course => course.unitId === 10)!.status = 'in_progress';
    const result = await checkMscCsGraduation(client(), input);
    expect(result.completed).toMatchObject({ graduationReady: false, creditedCredits: 102, missingCreditsTo120: 18 });
    expect(result.projected).toMatchObject({ graduationReady: true, creditedCredits: 120, missingCreditsTo120: 0 });
  });

  it('blocks a forbidden major/minor combination even when credits are complete', async () => {
    const result = await checkMscCsGraduation(client(), { ...request(), minor: 'Machine Learning' });
    expect(result.majorMinorCombinationValid).toBe(false);
    expect(result.completed.graduationReady).toBe(false);
    expect(result.warnings.join(' ')).toContain('cannot be combined');
  });

  it('leaves thesis admission unknown when individual requirements or attempt history are unknown', async () => {
    const input = request();
    delete (input as { additionalRequirementsCompleted?: boolean }).additionalRequirementsCompleted;
    delete (input as { failedInterFocusAttempts?: number }).failedInterFocusAttempts;
    const result = await checkMscCsGraduation(client(), input);
    expect(result.thesisAdmission.ready).toBeNull();
    expect(result.thesisAdmission.checks.additionalRequirementsCompleted).toBeNull();
    expect(result.thesisAdmission.checks.interFocusAttemptRule).toBeNull();
  });
});
