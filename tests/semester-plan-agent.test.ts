import { describe, expect, it } from 'vitest';
import { chooseAlternativeSwap, degreeProgressionProfile, enforceGraduationReadyProposal, semesterPlanRequestSchema, verifiedProposal } from '../apps/web/lib/semester-plan-agent';

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
        { unitId: 999, semester: '2026W', plannedSemester: '2026W', reason: 'Invented course', readiness: 'ready', readinessEvidence: 'Claimed evidence.' },
        { unitId: 101, semester: '2026W', plannedSemester: '2026W', reason: 'Closes a major gap.', readiness: 'ready', readinessEvidence: 'Targets MSc students.' },
        { unitId: 101, semester: '2026W', plannedSemester: '2026W', reason: 'Duplicate suggestion.', readiness: 'ready', readinessEvidence: 'Targets MSc students.' },
      ],
      cautions: ['Confirm the final allocation in myStudies.'],
    }, candidates as never, { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30, courses: [] }, new Set(['2026W:101']));

    expect(proposal.courses).toEqual([{ ...course, status: 'planned', reason: 'Closes a major gap. Readiness: Targets MSc students.' }]);
    expect(proposal.cautions).toHaveLength(1);
    expect(verifiedProposal({ summary: 'No change.', recommendations: [{ unitId: 101, semester: '2026W', plannedSemester: '2026W', reason: 'Already there.', readiness: 'ready', readinessEvidence: 'Already planned.' }], cautions: [] }, candidates as never, { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30, courses: [{ ...course, status: 'planned' }] }, new Set(['2026W:101'])).courses).toEqual([]);
  });

  it('never lets recommendations take a semester above target plus 3 ECTS', () => {
    const majorCore = { ...course, id: 102, number: '263-0002-00L', title: 'Advanced Machine Learning', credits: 10 };
    const seminar = { ...course, id: 103, number: '263-0003-00L', title: 'Systems for AI Seminar', credits: 2 };
    const candidates = new Map([['2026W:102', majorCore], ['2026W:103', seminar]]);
    const existing = { ...course, id: 100, title: 'Existing courses', credits: 31, status: 'planned' as const };

    const proposal = verifiedProposal({
      summary: 'Add both courses.',
      recommendations: [
        { unitId: 102, semester: '2026W', plannedSemester: '2026W', reason: 'Closes the major-core gap.', readiness: 'ready', readinessEvidence: 'Preparation is satisfied.' },
        { unitId: 103, semester: '2026W', plannedSemester: '2026W', reason: 'Closes the seminar gap.', readiness: 'ready', readinessEvidence: 'Open to MSc students.' },
      ],
      cautions: [],
    }, candidates as never, { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30, courses: [existing] }, new Set(['2026W:102', '2026W:103']));

    expect(proposal.courses.map(item => item.id)).toEqual([103]);
    expect(31 + proposal.courses.reduce((sum, item) => sum + (item.credits ?? 0), 0)).toBe(33);
    expect(proposal.summary).toContain('33 ECTS');
    expect(proposal.cautions.at(-1)).toContain('Advanced Machine Learning');
  });

  it('can change up to three planned courses to make an alternative fit', () => {
    const plan = semesterPlanRequestSchema.parse({
      major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30,
      courses: [
        { ...course, id: 100, title: 'Advanced Machine Learning', credits: 4, status: 'planned' },
        { ...course, id: 101, title: 'First flexible course', credits: 3, status: 'planned' },
        { ...course, id: 102, title: 'Second flexible course', credits: 3, status: 'planned' },
        { ...course, id: 103, title: 'Fixed course', credits: 23, status: 'in_progress' },
      ],
    });
    const alternative = { ...course, id: 200, number: '263-0200-00L', title: 'Larger alternative', credits: 10 };

    const swap = chooseAlternativeSwap(plan, 100, [alternative] as never);

    expect(swap).toMatchObject({ course: alternative, removeCourseIds: [100, 101, 102], resultingCredits: 33 });
  });

  it('requires readiness inspection and rejects recommendations in past semesters', () => {
    const candidates = new Map([['2026W:101', course], ['2027S:102', { ...course, id: 102, number: '263-0002-00L', semester: '2027S' }]]);
    const plan = { major: 'Machine Intelligence' as const, minor: 'Computer Graphics', activeSemester: '2027S', targetCredits: 30, courses: [] };
    const proposal = verifiedProposal({
      summary: 'Add candidates.',
      recommendations: [
        { unitId: 101, semester: '2026W', plannedSemester: '2026W', reason: 'Past course.', readiness: 'ready', readinessEvidence: 'Preparation is satisfied.' },
        { unitId: 102, semester: '2027S', plannedSemester: '2027S', reason: 'Not inspected.', readiness: 'ready', readinessEvidence: 'Unsupported claim.' },
      ],
      cautions: [],
    }, candidates as never, plan, new Set());

    expect(proposal.courses).toEqual([]);
    expect(proposal.cautions).toEqual(expect.arrayContaining([
      expect.stringContaining('not inspected'),
      expect.stringContaining('before the active semester'),
    ]));
  });

  it('moves conditional active-term recommendations to the next same-season term', () => {
    const candidates = new Map([['2026W:101', course]]);
    const proposal = verifiedProposal({
      summary: 'Candidate found.',
      recommendations: [{ unitId: 101, semester: '2026W', plannedSemester: '2026W', reason: 'Potential fit.', readiness: 'conditional', readinessEvidence: 'Requires unverified linear algebra.' }],
      cautions: [],
    }, candidates as never, { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30, courses: [] }, new Set(['2026W:101']));

    expect(proposal.courses[0]).toMatchObject({ id: 101, semester: '2027W', sourceSemester: '2026W' });
    expect(proposal.courses[0].reason).toContain('moved from the active term to 2027W');
    expect(proposal.cautions.at(-1)).toContain('future conditional milestones');
  });

  it('allows an inspected catalogue course as a tentative later same-season recurrence', () => {
    const candidates = new Map([['2026W:101', course]]);
    const proposal = verifiedProposal({
      summary: 'Added a tentative recurring course.',
      recommendations: [{ unitId: 101, semester: '2026W', plannedSemester: '2027W', reason: 'Fits the later roadmap.', readiness: 'conditional', readinessEvidence: 'Requires future supervisor approval.' }],
      cautions: [],
    }, candidates as never, { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2027S', targetCredits: 30, courses: [] }, new Set(['2026W:101']));

    expect(proposal.courses[0]).toMatchObject({ id: 101, semester: '2027W', sourceSemester: '2026W' });
    expect(proposal.courses[0].reason).toContain('confirm that it recurs in 2027W');
    expect(proposal.cautions.at(-1)).toContain('future conditional milestones');
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
      assumedAdmissionBaseline: expect.stringContaining('bachelor-level admission background'),
    });
  });

  it('atomically rejects a partial roadmap instead of inserting non-graduating courses', () => {
    const proposal = { summary: 'Partial roadmap.', courses: [{ ...course, status: 'planned' as const, reason: 'Partial.' }], cautions: [] };
    const incompleteAudit = {
      projected: { graduationReady: false, requirements: [
        { key: 'major_core', satisfied: false, missing: 16 },
        { key: 'total', satisfied: false, missing: 114 },
      ] },
    };

    const result = enforceGraduationReadyProposal(proposal, incompleteAudit as never, null);

    expect(result.proposal.courses).toEqual([]);
    expect(result.proposal.summary).toContain('No courses were added');
    expect(result.proposal.cautions.at(-1)).toContain('total: 114 missing');
    expect(result.audit).toBeNull();
  });
});
