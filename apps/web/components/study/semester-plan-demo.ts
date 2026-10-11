import type { VvzCurriculumCategory } from '@polymate/core/vvz';
import { creditsForSemester, nextSemester, type PlannedCourse, type SemesterPlan } from './semester-plan-model';

// Scripted semester planning for demo mode. Every result here is computed locally from a
// small illustrative catalogue, so the demo never calls VVZ or a model and answers instantly.

type Season = 'W' | 'S' | 'any';
type DemoCatalogueCourse = { id: number; number: string; title: string; credits: number; season: Season; category: VvzCurriculumCategory };
export type DemoCourse = Omit<PlannedCourse, 'status'>;
export type DemoRequirement = { key: string; earned: number; required: number; missing: number; satisfied: boolean };
export type DemoAuditPart = { graduationReady: boolean; creditedCredits: number; requirements: DemoRequirement[]; assignments: Array<{ unitId: number; assignedCategory: string }> };
export type DemoAudit = { majorMinorCombinationValid: boolean; completed: DemoAuditPart; projected: DemoAuditPart; warnings: string[] };
export type DemoProposal = { summary: string; courses: Array<DemoCourse & { status: 'planned'; reason: string }>; cautions: string[] };
export type DemoAlternative = { course: DemoCourse; removeCourseIds: number[]; category: string; reason: string };

export const DEMO_ACTIVE_SEMESTER = '2026W';
export const DEMO_SEARCH_SUGGESTIONS = ['learning', 'vision', 'graphics', 'seminar'] as const;
const PRE_THESIS_CREDITS = 90;
const MAX_ROADMAP_SEMESTERS = 8;

// Machine Intelligence major with a Computer Graphics minor. Credits are illustrative.
const CATALOGUE: readonly DemoCatalogueCourse[] = [
  { id: 9_100_001, number: '252-0535-00L', title: 'Advanced Machine Learning', credits: 10, season: 'W', category: 'major_core' },
  { id: 9_100_002, number: '263-5210-00L', title: 'Probabilistic Artificial Intelligence', credits: 8, season: 'W', category: 'major_core' },
  { id: 9_100_003, number: '263-3210-00L', title: 'Deep Learning', credits: 8, season: 'W', category: 'major_elective' },
  { id: 9_100_004, number: '263-5902-00L', title: 'Computer Vision', credits: 8, season: 'W', category: 'major_elective' },
  { id: 9_100_005, number: '263-3710-00L', title: 'Machine Perception', credits: 8, season: 'S', category: 'major_elective' },
  { id: 9_100_006, number: '263-5255-00L', title: 'Foundations of Reinforcement Learning', credits: 6, season: 'S', category: 'major_elective' },
  { id: 9_100_007, number: '252-0579-00L', title: '3D Vision', credits: 8, season: 'S', category: 'major_elective' },
  { id: 9_100_008, number: '252-0543-01L', title: 'Computer Graphics', credits: 8, season: 'W', category: 'minor' },
  { id: 9_100_009, number: '252-0546-00L', title: 'Physically-Based Simulation in Computer Graphics', credits: 6, season: 'W', category: 'minor' },
  { id: 9_100_010, number: '263-5701-00L', title: 'Scientific Visualization', credits: 6, season: 'W', category: 'minor' },
  { id: 9_100_011, number: '252-0538-00L', title: 'Shape Modeling and Geometry Processing', credits: 8, season: 'S', category: 'minor' },
  { id: 9_100_012, number: '263-5806-00L', title: 'Digital Humans', credits: 8, season: 'S', category: 'minor' },
  { id: 9_100_013, number: '263-4500-00L', title: 'Advanced Algorithms', credits: 8, season: 'W', category: 'inter_focus' },
  { id: 9_100_014, number: '263-0007-00L', title: 'Advanced Systems Lab', credits: 8, season: 'S', category: 'inter_focus' },
  { id: 9_100_015, number: '263-3800-00L', title: 'Seminar on Advanced Topics in Machine Learning', credits: 2, season: 'W', category: 'seminar' },
  { id: 9_100_016, number: '263-3801-00L', title: 'Seminar on Computer Graphics', credits: 2, season: 'S', category: 'seminar' },
  { id: 9_100_017, number: '851-0180-00L', title: 'Research Ethics', credits: 2, season: 'W', category: 'science_in_perspective' },
  { id: 9_100_018, number: '851-0740-00L', title: 'Big Data, Law, and Policy', credits: 3, season: 'S', category: 'science_in_perspective' },
  { id: 9_100_019, number: '263-0600-00L', title: 'Practical Work: Semester Project', credits: 8, season: 'any', category: 'practical_work' },
  { id: 9_100_020, number: '263-0601-00L', title: 'Practical Work: Research Project', credits: 8, season: 'any', category: 'practical_work' },
  { id: 9_100_021, number: '263-0800-00L', title: "Master's Thesis", credits: 30, season: 'any', category: 'masters_thesis' },
];
const byId = new Map(CATALOGUE.map(course => [course.id, course]));

function vvzUrl(number: string, semester: string) {
  return `https://www.vvz.ethz.ch/Vorlesungsverzeichnis/sucheLehrangebot.view?lang=en&search=on&semkez=${semester}&lerneinheitscode=${encodeURIComponent(number)}`;
}

function toCourse(course: DemoCatalogueCourse, semester: string): DemoCourse {
  return { id: course.id, semester, number: course.number, title: course.title, credits: course.credits, officialVvzUrl: vvzUrl(course.number, semester) };
}

function offeredIn(course: DemoCatalogueCourse, semester: string) {
  return course.season === 'any' || semester.endsWith(course.season);
}

export function demoSemesterPlan(): SemesterPlan {
  const placed = (id: number, semester: string, status: PlannedCourse['status']): PlannedCourse => ({ ...toCourse(byId.get(id)!, semester), status });
  return {
    major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: DEMO_ACTIVE_SEMESTER, targetCredits: 30,
    courses: [
      ...[9_100_001, 9_100_008, 9_100_013, 9_100_015, 9_100_017].map(id => placed(id, '2025W', 'passed')),
      ...[9_100_014, 9_100_005, 9_100_011, 9_100_006].map(id => placed(id, '2026S', 'passed')),
      placed(9_100_002, DEMO_ACTIVE_SEMESTER, 'in_progress'),
    ],
  };
}

export function demoSearch(semester: string, query: string): DemoCourse[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return CATALOGUE.filter(course => offeredIn(course, semester) && (course.title.toLowerCase().includes(needle) || course.number.toLowerCase().includes(needle)))
    .slice(0, 8).map(course => toCourse(course, semester));
}

function categoryOf(course: Pick<PlannedCourse, 'id'>): VvzCurriculumCategory | 'unclassified' {
  return byId.get(course.id)?.category ?? 'unclassified';
}

function evaluate(courses: readonly PlannedCourse[]): DemoAuditPart {
  const inCategory = (category: string) => courses.filter(course => categoryOf(course) === category);
  const sum = (items: readonly PlannedCourse[]) => items.reduce((total, course) => total + (course.credits ?? 0), 0);
  const majorCore = sum(inCategory('major_core'));
  const major = majorCore + sum(inCategory('major_elective'));
  const minor = sum(inCategory('minor'));
  const interFocus = inCategory('inter_focus');
  const seminar = inCategory('seminar').sort((a, b) => (b.credits ?? 0) - (a.credits ?? 0)).slice(0, 1);
  const practical = Math.min(10, sum(inCategory('practical_work')));
  const sip = Math.min(6, sum(inCategory('science_in_perspective')));
  const thesis = Math.min(30, sum(inCategory('masters_thesis')));
  const credited = major + minor + sum(interFocus) + sum(seminar) + practical + sip + thesis + sum(inCategory('free_elective'));
  const requirement = (key: string, earned: number, required: number, extraSatisfied = true): DemoRequirement =>
    ({ key, earned, required, missing: Math.max(0, required - earned), satisfied: earned >= required && extraSatisfied });
  const requirements = [requirement('major_core', majorCore, 16), requirement('major_total', major, 26), requirement('minor', minor, 18),
    requirement('inter_focus', sum(interFocus), 16, interFocus.length >= 2), requirement('seminar', sum(seminar), 2),
    requirement('practical_work', practical, 8), requirement('science_in_perspective', sip, 2), requirement('masters_thesis', thesis, 30), requirement('total', credited, 120)];
  return { graduationReady: requirements.every(item => item.satisfied), creditedCredits: Math.min(130, credited), requirements,
    assignments: courses.map(course => ({ unitId: course.id, assignedCategory: categoryOf(course) })) };
}

export function demoAudit(plan: SemesterPlan): DemoAudit {
  const unclassified = plan.courses.filter(course => categoryOf(course) === 'unclassified');
  return {
    majorMinorCombinationValid: true,
    completed: evaluate(plan.courses.filter(course => course.status === 'passed')),
    projected: evaluate(plan.courses),
    warnings: [
      ...unclassified.map(course => `${course.number ?? course.title} is not in the demo catalogue and was left unclassified.`),
      'Demo mode uses an illustrative course catalogue. Results are scripted, not a degree audit.',
    ],
  };
}

const requirementCategory: Record<string, VvzCurriculumCategory> = {
  major_core: 'major_core', major_total: 'major_elective', minor: 'minor', inter_focus: 'inter_focus', seminar: 'seminar',
  practical_work: 'practical_work', science_in_perspective: 'science_in_perspective',
};
const requirementLabels: Record<string, string> = {
  major_core: 'major core', major_total: 'major', minor: 'minor', inter_focus: 'Inter Focus', seminar: 'seminar',
  practical_work: 'practical work', science_in_perspective: 'Science in Perspective', masters_thesis: "Master's thesis",
};

/** Deterministically fills requirement gaps into the earliest semesters that fit the ECTS target. */
export function demoImprovePlan(plan: SemesterPlan): { proposal: DemoProposal; audit: DemoAudit } {
  const courses = [...plan.courses];
  const added: DemoProposal['courses'] = [];
  const filled = new Set<string>();
  const roadmap = [plan.activeSemester];
  while (roadmap.length < MAX_ROADMAP_SEMESTERS) roadmap.push(nextSemester(roadmap.at(-1)!));
  const unused = (category: VvzCurriculumCategory) => CATALOGUE.filter(course => course.category === category && !courses.some(item => item.id === course.id));

  function place(course: DemoCatalogueCourse, key: string): boolean {
    const semester = roadmap.find(candidate => offeredIn(course, candidate) && creditsForSemester(courses, candidate) + course.credits <= plan.targetCredits);
    if (!semester) return false;
    const reason = `Fills the ${requirementLabels[key] ?? key} requirement with ${course.credits} ECTS in ${semester}, keeping that semester at or below ${plan.targetCredits} ECTS.`;
    courses.push({ ...toCourse(course, semester), status: 'planned' });
    added.push({ ...toCourse(course, semester), status: 'planned', reason });
    filled.add(key);
    return true;
  }

  for (const [key, category] of Object.entries(requirementCategory)) {
    for (const candidate of unused(category)) {
      if (evaluate(courses).requirements.find(item => item.key === key)!.satisfied) break;
      place(candidate, key);
    }
  }
  const preThesis = () => evaluate(courses.filter(course => categoryOf(course) !== 'masters_thesis')).creditedCredits;
  for (const candidate of [...unused('major_elective'), ...unused('minor')]) {
    if (preThesis() >= PRE_THESIS_CREDITS) break;
    place(candidate, candidate.category === 'minor' ? 'minor' : 'major_total');
  }

  const cautions: string[] = [];
  const thesis = byId.get(9_100_021)!;
  if (!courses.some(course => course.id === thesis.id)) {
    const lastCoursework = courses.map(course => course.semester).sort().at(-1) ?? plan.activeSemester;
    const semester = lastCoursework < plan.activeSemester ? plan.activeSemester : nextSemester(lastCoursework);
    if (preThesis() >= PRE_THESIS_CREDITS - 8) {
      const entry = { ...toCourse(thesis, semester), status: 'planned' as const, reason: `Placed on its own in ${semester}, after all coursework, so the thesis semester carries no extra course load.` };
      courses.push(entry);
      added.push(entry);
      filled.add('masters_thesis');
    } else cautions.push("The Master's thesis was not scheduled because fewer than 82 pre-thesis ECTS are planned.");
  }

  const audit = demoAudit({ ...plan, courses });
  if (!audit.projected.graduationReady) cautions.push('The demo catalogue could not close every requirement gap. Remove a course or raise the ECTS target and try again.');
  cautions.push('Demo mode: scripted roadmap from an illustrative catalogue. Real plans are checked against the live VVZ.');
  const graduation = courses.filter(course => categoryOf(course) === 'masters_thesis').map(course => course.semester).sort().at(-1);
  const summary = added.length === 0
    ? audit.projected.graduationReady ? 'The projected plan already satisfies the encoded graduation requirements.' : 'No course in the demo catalogue fits the remaining gaps under your ECTS target.'
    : `Added ${added.length} course${added.length === 1 ? '' : 's'} covering ${[...filled].map(key => requirementLabels[key] ?? key).join(', ')}.${graduation && audit.projected.graduationReady ? ` The roadmap graduates in ${graduation} without any semester exceeding ${plan.targetCredits} ECTS.` : ''}`;
  return { proposal: { summary, courses: added, cautions }, audit };
}

export function demoAlternative(plan: SemesterPlan, courseId: number): DemoAlternative {
  const current = plan.courses.find(course => course.id === courseId);
  const source = current && byId.get(current.id);
  if (!current || !source) throw new Error('This course is not in the demo catalogue, so demo mode has no alternative for it.');
  const budget = plan.targetCredits - creditsForSemester(plan.courses, current.semester) + source.credits;
  const options = CATALOGUE.filter(course => course.category === source.category && course.id !== source.id && offeredIn(course, current.semester)
    && course.credits <= budget && !plan.courses.some(item => item.id === course.id))
    .sort((a, b) => Math.abs(a.credits - source.credits) - Math.abs(b.credits - source.credits));
  const choice = options[0];
  if (!choice) throw new Error(`The demo catalogue has no other ${requirementLabels[source.category] ?? source.category.replaceAll('_', ' ')} course for ${current.semester}.`);
  const resulting = creditsForSemester(plan.courses, current.semester) - source.credits + choice.credits;
  return {
    course: toCourse(choice, current.semester), removeCourseIds: [current.id], category: source.category,
    reason: `Alternative ${source.category.replaceAll('_', ' ')} course with ${choice.credits} ECTS. The replacement leaves ${resulting} ECTS in ${current.semester}, within your ${plan.targetCredits}-ECTS target.`,
  };
}
