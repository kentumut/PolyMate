import { describe, expect, it } from 'vitest';
import { degreeProgressionProfile, semesterPlanRequestSchema, verifiedProposal } from '../apps/web/lib/semester-plan-agent';

const course = {
  id: 101,
  semester: '2026W',
  number: '263-0001-00L',
  title: 'Agentic Systems',
  credits: 6,
  officialVvzUrl: 'https://www.vvz.ethz.ch/Vorlesungsverzeichnis/lerneinheit.view?lerneinheitId=101',
};

describe('semester planning agent', () => {
  it('accepts an existing multi-semester plan and rejects duplicate courses', () => {
    const plan = { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30, courses: [{ ...course, status: 'planned' }] };
    expect(semesterPlanRequestSchema.parse(plan)).toEqual(plan);
    expect(semesterPlanRequestSchema.parse({ ...plan, courses: [{ ...plan.courses[0], language: 'English' }] }).courses[0]).toEqual(plan.courses[0]);
    expect(() => semesterPlanRequestSchema.parse({ ...plan, courses: [plan.courses[0], plan.courses[0]] })).toThrow('Each VVZ course may appear only once');
  });

  it('populates only canonical courses returned by VVZ searches', () => {
    const candidates = new Map([['2026W:101', course]]);
    const proposal = verifiedProposal({
      summary: 'Added one verified course.',
      recommendations: [
        { unitId: 999, semester: '2026W', reason: 'Invented course', readiness: 'ready', readinessEvidence: 'Claimed evidence.' },
        { unitId: 101, semester: '2026W', reason: 'Closes a major gap.', readiness: 'ready', readinessEvidence: 'Targets MSc students.' },
        { unitId: 101, semester: '2026W', reason: 'Duplicate suggestion.', readiness: 'ready', readinessEvidence: 'Targets MSc students.' },
      ],
      cautions: ['Confirm the final allocation in myStudies.'],
    }, candidates as never, { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30, courses: [] }, new Set(['2026W:101']));

    expect(proposal.courses).toEqual([{ ...course, status: 'planned', reason: 'Closes a major gap. Readiness: Targets MSc students.' }]);
    expect(proposal.cautions).toHaveLength(1);
    expect(verifiedProposal({ summary: 'No change.', recommendations: [{ unitId: 101, semester: '2026W', reason: 'Already there.', readiness: 'ready', readinessEvidence: 'Already planned.' }], cautions: [] }, candidates as never, { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30, courses: [{ ...course, status: 'planned' }] }, new Set(['2026W:101'])).courses).toEqual([]);
  });

  it('never lets recommendations take a semester above target plus 3 ECTS', () => {
    const majorCore = { ...course, id: 102, title: 'Advanced Machine Learning', credits: 10 };
    const seminar = { ...course, id: 103, title: 'Systems for AI Seminar', credits: 2 };
    const candidates = new Map([['2026W:102', majorCore], ['2026W:103', seminar]]);
    const existing = { ...course, id: 100, title: 'Existing courses', credits: 31, status: 'planned' as const };

    const proposal = verifiedProposal({
      summary: 'Add both courses.',
      recommendations: [
        { unitId: 102, semester: '2026W', reason: 'Closes the major-core gap.', readiness: 'ready', readinessEvidence: 'Preparation is satisfied.' },
        { unitId: 103, semester: '2026W', reason: 'Closes the seminar gap.', readiness: 'ready', readinessEvidence: 'Open to MSc students.' },
      ],
      cautions: [],
    }, candidates as never, { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30, courses: [existing] }, new Set(['2026W:102', '2026W:103']));

    expect(proposal.courses.map(item => item.id)).toEqual([103]);
    expect(31 + proposal.courses.reduce((sum, item) => sum + (item.credits ?? 0), 0)).toBe(33);
    expect(proposal.summary).toContain('33 ECTS');
    expect(proposal.cautions.at(-1)).toContain('Advanced Machine Learning');
  });

  it('requires readiness inspection and rejects recommendations in past semesters', () => {
    const candidates = new Map([['2026W:101', course], ['2027S:101', { ...course, semester: '2027S' }]]);
    const plan = { major: 'Machine Intelligence' as const, minor: 'Computer Graphics', activeSemester: '2027S', targetCredits: 30, courses: [] };
    const proposal = verifiedProposal({
      summary: 'Add candidates.',
      recommendations: [
        { unitId: 101, semester: '2026W', reason: 'Past course.', readiness: 'ready', readinessEvidence: 'Preparation is satisfied.' },
        { unitId: 101, semester: '2027S', reason: 'Not inspected.', readiness: 'ready', readinessEvidence: 'Unsupported claim.' },
      ],
      cautions: [],
    }, candidates as never, plan, new Set());

    expect(proposal.courses).toEqual([]);
    expect(proposal.cautions.at(-1)).toContain('prerequisite/readiness evidence');
  });

  it('does not automatically insert conditional recommendations', () => {
    const candidates = new Map([['2026W:101', course]]);
    const proposal = verifiedProposal({
      summary: 'Candidate found.',
      recommendations: [{ unitId: 101, semester: '2026W', reason: 'Potential fit.', readiness: 'conditional', readinessEvidence: 'Requires unverified linear algebra.' }],
      cautions: [],
    }, candidates as never, { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30, courses: [] }, new Set(['2026W:101']));

    expect(proposal.courses).toEqual([]);
    expect(proposal.summary).toContain('readiness');
  });

  it('infers degree advancement and balances the saved semester timeline', () => {
    const plan = semesterPlanRequestSchema.parse({
      major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2027W', targetCredits: 30,
      courses: [
        { ...course, semester: '2026W', credits: 30, status: 'passed' },
        { ...course, id: 102, semester: '2027S', credits: 32, status: 'passed' },
        { ...course, id: 103, semester: '2027W', credits: 20, status: 'in_progress' },
        { ...course, id: 104, semester: '2028S', credits: 10, status: 'planned' },
      ],
    });

    expect(degreeProgressionProfile(plan)).toMatchObject({
      stage: 'advanced', completedCredits: 62, inProgressCredits: 20, plannedCredits: 10, inferredStudySemester: 3,
      workloads: [
        { semester: '2026W', credits: 30, relation: 'past' },
        { semester: '2027S', credits: 32, relation: 'past' },
        { semester: '2027W', credits: 20, relation: 'active' },
        { semester: '2028S', credits: 10, relation: 'future' },
      ],
    });
  });
});
