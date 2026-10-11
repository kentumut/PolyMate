import { describe, expect, it } from 'vitest';
import { demoAlternative, demoAudit, demoImprovePlan, demoSearch, demoSemesterPlan } from '../apps/web/components/study/semester-plan-demo';
import { creditsForSemester } from '../apps/web/components/study/semester-plan-model';

const requirement = (audit: ReturnType<typeof demoAudit>, key: string) => audit.projected.requirements.find(item => item.key === key)!;

describe('semester plan demo mode', () => {
  it('starts from a sample student with visible requirement gaps', () => {
    const audit = demoAudit(demoSemesterPlan());
    expect(audit.projected.graduationReady).toBe(false);
    expect(requirement(audit, 'minor').missing).toBe(2);
    expect(requirement(audit, 'practical_work').missing).toBe(8);
    expect(requirement(audit, 'masters_thesis').missing).toBe(30);
    expect(audit.completed.creditedCredits).toBe(60);
  });

  it('searches only courses offered in the selected semester season', () => {
    expect(demoSearch('2026W', 'vision').map(course => course.title)).toEqual(['Computer Vision']);
    expect(demoSearch('2027S', 'vision').map(course => course.title)).toEqual(['3D Vision']);
    expect(demoSearch('2027S', 'vision')[0].semester).toBe('2027S');
    expect(demoSearch('2026W', '  ')).toEqual([]);
  });

  it('builds a graduation-ready roadmap without exceeding the semester target', () => {
    const plan = demoSemesterPlan();
    const { proposal, audit } = demoImprovePlan(plan);
    const courses = [...plan.courses, ...proposal.courses];
    expect(audit.projected.graduationReady).toBe(true);
    expect(proposal.courses.map(course => course.title)).toContain("Master's Thesis");
    expect(proposal.courses.find(course => course.title === "Master's Thesis")!.semester).toBe('2027S');
    for (const semester of new Set(courses.map(course => course.semester))) expect(creditsForSemester(courses, semester)).toBeLessThanOrEqual(plan.targetCredits);
    expect(proposal.cautions.at(-1)).toMatch(/Demo mode/);
  });

  it('is deterministic and reports an already complete plan without changes', () => {
    const plan = demoSemesterPlan();
    expect(demoImprovePlan(plan)).toEqual(demoImprovePlan(plan));
    const complete = { ...plan, courses: [...plan.courses, ...demoImprovePlan(plan).proposal.courses] };
    const again = demoImprovePlan(complete);
    expect(again.proposal.courses).toEqual([]);
    expect(again.proposal.summary).toMatch(/already satisfies/);
  });

  it('plans from an empty roadmap', () => {
    const plan = { ...demoSemesterPlan(), courses: [] };
    expect(demoImprovePlan(plan).audit.projected.graduationReady).toBe(true);
  });

  it('suggests a same-category alternative that fits the semester target', () => {
    const plan = demoSemesterPlan();
    const withProposal = { ...plan, courses: [...plan.courses, ...demoImprovePlan(plan).proposal.courses] };
    const deepLearning = withProposal.courses.find(course => course.title === 'Deep Learning')!;
    const alternative = demoAlternative(withProposal, deepLearning.id);
    expect(alternative.course.title).toBe('Computer Vision');
    expect(alternative.category).toBe('major_elective');
    expect(alternative.removeCourseIds).toEqual([deepLearning.id]);
    const thesis = withProposal.courses.find(course => course.title === "Master's Thesis")!;
    expect(() => demoAlternative(withProposal, thesis.id)).toThrow(/no other/);
  });
});
