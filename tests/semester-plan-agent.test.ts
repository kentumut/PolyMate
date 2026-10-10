import { describe, expect, it } from 'vitest';
import { semesterPlanRequestSchema, verifiedProposal } from '../apps/web/lib/semester-plan-agent';

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
        { unitId: 999, semester: '2026W', reason: 'Invented course' },
        { unitId: 101, semester: '2026W', reason: 'Closes a major gap.' },
        { unitId: 101, semester: '2026W', reason: 'Duplicate suggestion.' },
      ],
      cautions: ['Confirm the final allocation in myStudies.'],
    }, candidates as never, { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30, courses: [] });

    expect(proposal.courses).toEqual([{ ...course, status: 'planned', reason: 'Closes a major gap.' }]);
    expect(proposal.cautions).toHaveLength(1);
    expect(verifiedProposal({ summary: 'No change.', recommendations: [{ unitId: 101, semester: '2026W', reason: 'Already there.' }], cautions: [] }, candidates as never, { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30, courses: [{ ...course, status: 'planned' }] }).courses).toEqual([]);
  });

  it('never lets recommendations take a semester above target plus 3 ECTS', () => {
    const majorCore = { ...course, id: 102, title: 'Advanced Machine Learning', credits: 10 };
    const seminar = { ...course, id: 103, title: 'Systems for AI Seminar', credits: 2 };
    const candidates = new Map([['2026W:102', majorCore], ['2026W:103', seminar]]);
    const existing = { ...course, id: 100, title: 'Existing courses', credits: 31, status: 'planned' as const };

    const proposal = verifiedProposal({
      summary: 'Add both courses.',
      recommendations: [
        { unitId: 102, semester: '2026W', reason: 'Closes the major-core gap.' },
        { unitId: 103, semester: '2026W', reason: 'Closes the seminar gap.' },
      ],
      cautions: [],
    }, candidates as never, { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: '2026W', targetCredits: 30, courses: [existing] });

    expect(proposal.courses.map(item => item.id)).toEqual([103]);
    expect(31 + proposal.courses.reduce((sum, item) => sum + (item.credits ?? 0), 0)).toBe(33);
    expect(proposal.summary).toContain('33 ECTS');
    expect(proposal.cautions.at(-1)).toContain('Advanced Machine Learning');
  });
});
