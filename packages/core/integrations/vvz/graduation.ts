import { MSC_CS_MAJORS, MSC_CS_MINORS, type MscCsMajor, type MscCsMinor, type VvzClient, type VvzCurriculumCategory, VvzError } from './client';

const STATUSES = ['passed', 'in_progress', 'planned'] as const;
type CourseStatus = typeof STATUSES[number];
type CourseInput = { unitId: number; status: CourseStatus; assignedCategory?: VvzCurriculumCategory };
export type MscCsGraduationRequest = {
  major: MscCsMajor;
  minor: MscCsMinor;
  courses: CourseInput[];
  additionalRequirementsCompleted?: boolean;
  failedInterFocusAttempts?: number;
  previousBachelorLanguageCredits: number;
};

const CATEGORIES: readonly VvzCurriculumCategory[] = ['major_core', 'major_elective', 'minor', 'inter_focus', 'seminar', 'practical_work', 'science_in_perspective', 'masters_thesis', 'free_elective'];
export const MSC_CS_MAJOR_MINOR_COMBINATIONS: Record<MscCsMajor, readonly MscCsMinor[]> = {
  'Data Management Systems': ['Computer Graphics', 'Computer Vision', 'Information Security', 'Machine Learning', 'Networking', 'Programming Languages and Software Engineering', 'Theoretical Computer Science'],
  'Machine Intelligence': ['Computer Graphics', 'Data Management', 'Information Security', 'Networking', 'Programming Languages and Software Engineering', 'Systems Software', 'Theoretical Computer Science'],
  'Secure and Reliable Systems': ['Computer Graphics', 'Computer Vision', 'Data Management', 'Machine Learning', 'Networking', 'Systems Software', 'Theoretical Computer Science'],
  'Visual and Interactive Computing': ['Data Management', 'Information Security', 'Machine Learning', 'Networking', 'Programming Languages and Software Engineering', 'Systems Software', 'Theoretical Computer Science'],
  'Theoretical Computer Science': ['Computer Graphics', 'Computer Vision', 'Data Management', 'Information Security', 'Machine Learning', 'Networking', 'Programming Languages and Software Engineering', 'Systems Software'],
};

export function parseMscCsGraduationRequest(value: unknown): MscCsGraduationRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VvzError('invalid_request', 'Send an MSc Computer Science graduation check.');
  const input = value as Record<string, unknown>;
  const allowed = ['major', 'minor', 'courses', 'additionalRequirementsCompleted', 'failedInterFocusAttempts', 'previousBachelorLanguageCredits'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new VvzError('invalid_request', 'The graduation check contains unsupported fields.');
  if (typeof input.major !== 'string' || !(MSC_CS_MAJORS as readonly string[]).includes(input.major)) throw new VvzError('invalid_request', 'Choose a supported MSc Computer Science major.');
  if (typeof input.minor !== 'string' || !(MSC_CS_MINORS as readonly string[]).includes(input.minor)) throw new VvzError('invalid_request', 'Choose a supported MSc Computer Science minor.');
  if (!Array.isArray(input.courses) || input.courses.length < 1 || input.courses.length > 50) throw new VvzError('invalid_request', 'Provide 1 to 50 current or completed courses.');
  const courses = input.courses.map((value, index): CourseInput => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VvzError('invalid_request', `Course ${index + 1} is invalid.`);
    const course = value as Record<string, unknown>;
    if (Object.keys(course).some(key => !['unitId', 'status', 'assignedCategory'].includes(key)) || !Number.isSafeInteger(course.unitId) || Number(course.unitId) <= 0) throw new VvzError('invalid_request', `Course ${index + 1} needs a positive VVZ unitId.`);
    if (typeof course.status !== 'string' || !(STATUSES as readonly string[]).includes(course.status)) throw new VvzError('invalid_request', `Course ${index + 1} needs status passed, in_progress, or planned.`);
    if (course.assignedCategory !== undefined && (typeof course.assignedCategory !== 'string' || !(CATEGORIES as readonly string[]).includes(course.assignedCategory))) throw new VvzError('invalid_request', `Course ${index + 1} has an unsupported assigned category.`);
    return { unitId: Number(course.unitId), status: course.status as CourseStatus, assignedCategory: course.assignedCategory as VvzCurriculumCategory | undefined };
  });
  if (new Set(courses.map(course => course.unitId)).size !== courses.length) throw new VvzError('invalid_request', 'Each VVZ unitId may appear only once.');
  if (input.additionalRequirementsCompleted !== undefined && typeof input.additionalRequirementsCompleted !== 'boolean') throw new VvzError('invalid_request', 'additionalRequirementsCompleted must be true or false.');
  if (input.failedInterFocusAttempts !== undefined && (!Number.isSafeInteger(input.failedInterFocusAttempts) || Number(input.failedInterFocusAttempts) < 0 || Number(input.failedInterFocusAttempts) > 20)) throw new VvzError('invalid_request', 'failedInterFocusAttempts must be between 0 and 20.');
  const previous = input.previousBachelorLanguageCredits ?? 0;
  if (typeof previous !== 'number' || !Number.isFinite(previous) || previous < 0 || previous > 3) throw new VvzError('invalid_request', 'previousBachelorLanguageCredits must be between 0 and 3.');
  return { major: input.major as MscCsMajor, minor: input.minor as MscCsMinor, courses,
    additionalRequirementsCompleted: input.additionalRequirementsCompleted as boolean | undefined,
    failedInterFocusAttempts: input.failedInterFocusAttempts as number | undefined, previousBachelorLanguageCredits: previous };
}

type ResolvedCourse = Awaited<ReturnType<VvzClient['getMscCsCurriculumCourses']>>[number] & CourseInput;
type Assignment = ResolvedCourse & { category: VvzCurriculumCategory | 'unclassified' };

function allocateMajorMinor(courses: ResolvedCourse[]): Map<number, VvzCurriculumCategory> {
  type State = { core: number; major: number; minor: number; choices: VvzCurriculumCategory[] };
  let states = new Map<string, State>([['0:0:0', { core: 0, major: 0, minor: 0, choices: [] }]]);
  for (const course of courses) {
    const credits = Math.round((course.credits ?? 0) * 10);
    const choices: VvzCurriculumCategory[] = ['free_elective'];
    for (const category of ['major_core', 'major_elective', 'minor'] as const) if (course.eligibleCategories.includes(category)) choices.push(category);
    const next = new Map<string, State>();
    for (const state of states.values()) for (const choice of choices) {
      const core = Math.min(160, state.core + (choice === 'major_core' ? credits : 0));
      const major = Math.min(260, state.major + (choice === 'major_core' || choice === 'major_elective' ? credits : 0));
      const minor = Math.min(180, state.minor + (choice === 'minor' ? credits : 0));
      const candidate = { core, major, minor, choices: [...state.choices, choice] };
      const key = `${core}:${major}:${minor}`;
      if (!next.has(key)) next.set(key, candidate);
    }
    states = next;
  }
  const score = (state: State) => Number(state.core >= 160) * 1_000_000 + Number(state.major >= 260) * 1_000_000 + Number(state.minor >= 180) * 1_000_000 + state.core + state.major + state.minor;
  const best = [...states.values()].sort((a, b) => score(b) - score(a))[0];
  return new Map(courses.map((course, index) => [course.unitId, best.choices[index]]));
}

function assignCourses(courses: ResolvedCourse[], warnings: string[]): Assignment[] {
  const assigned = new Map<number, VvzCurriculumCategory>();
  const majorMinor: ResolvedCourse[] = [];
  for (const course of courses) {
    if (course.assignedCategory) {
      if (!course.eligibleCategories.includes(course.assignedCategory)) warnings.push(`${course.number ?? course.unitId} is not listed by VVZ as eligible for the assigned ${course.assignedCategory} category and was left unclassified.`);
      else assigned.set(course.unitId, course.assignedCategory);
      continue;
    }
    const constrained = course.eligibleCategories.filter(category => category !== 'free_elective');
    const majorOptions = constrained.filter(category => ['major_core', 'major_elective', 'minor'].includes(category));
    const otherOptions = constrained.filter(category => !['major_core', 'major_elective', 'minor'].includes(category));
    if (otherOptions.length) {
      if (otherOptions.length > 1 || majorOptions.length) warnings.push(`${course.number ?? course.unitId} fits multiple curriculum categories; automatically assigned to ${otherOptions[0]}. Supply assignedCategory to override it.`);
      assigned.set(course.unitId, otherOptions[0]);
    } else if (majorOptions.length) majorMinor.push(course);
    else if (course.eligibleCategories.includes('free_elective')) assigned.set(course.unitId, 'free_elective');
  }
  for (const [id, category] of allocateMajorMinor(majorMinor)) assigned.set(id, category);
  return courses.map(course => ({ ...course, category: assigned.get(course.unitId) ?? 'unclassified' }));
}

function evaluate(assignments: Assignment[], previousBachelorLanguageCredits: number) {
  const warnings: string[] = [];
  const categoryCourses = (category: Assignment['category']) => assignments.filter(course => course.category === category && course.credits !== null);
  const sum = (courses: Assignment[]) => courses.reduce((total, course) => total + (course.credits ?? 0), 0);
  const majorCore = sum(categoryCourses('major_core'));
  const major = majorCore + sum(categoryCourses('major_elective'));
  const minor = sum(categoryCourses('minor'));
  const inter = categoryCourses('inter_focus');
  const seminar = categoryCourses('seminar').sort((a, b) => (b.credits ?? 0) - (a.credits ?? 0)).slice(0, 1);
  const practicalRaw = sum(categoryCourses('practical_work'));
  const practical = Math.min(10, practicalRaw);
  const sipCourses = categoryCourses('science_in_perspective');
  const languageAllowance = Math.max(0, 3 - previousBachelorLanguageCredits);
  const language = sipCourses.filter(course => course.number?.startsWith('851-'));
  const nonLanguage = sipCourses.filter(course => !course.number?.startsWith('851-'));
  const sip = Math.min(6, sum(nonLanguage) + Math.min(languageAllowance, sum(language)));
  const thesis = Math.min(30, sum(categoryCourses('masters_thesis')));
  const free = sum(categoryCourses('free_elective'));
  const interCredits = sum(inter);
  const seminarCredits = sum(seminar);
  if (categoryCourses('seminar').length > 1) warnings.push('Only one seminar can be accredited; additional seminars were not counted.');
  if (practicalRaw > 10) warnings.push('Practical Work is capped at 10 accredited credits.');
  if (sum(sipCourses) > sip) warnings.push('Science in Perspective is capped at 6 credits, with at most 3 accumulated language-course credits across Bachelor and Master studies.');
  const credited = major + minor + interCredits + seminarCredits + practical + sip + thesis + free;
  const requirement = (key: string, earned: number, required: number, extraSatisfied = true) => ({ key, earned, required, missing: Math.max(0, required - earned), satisfied: earned >= required && extraSatisfied });
  const requirements = [requirement('major_core', majorCore, 16), requirement('major_total', major, 26), requirement('minor', minor, 18),
    { ...requirement('inter_focus', interCredits, 16, inter.length >= 2), courseCount: inter.length, requiredCourseCount: 2 },
    { ...requirement('seminar', seminarCredits, 2, seminar.length === 1), courseCount: seminar.length, maximumCourseCount: 1 },
    requirement('practical_work', practical, 8), requirement('science_in_perspective', sip, 2), requirement('masters_thesis', thesis, 30), requirement('total', credited, 120)];
  return { graduationReady: requirements.every(item => item.satisfied), creditedCredits: Math.min(130, credited), rawEligibleCredits: credited,
    requirements, missingCreditsTo120: Math.max(0, 120 - credited), preThesisCredits: credited - thesis, missingPreThesisCredits: Math.max(0, 90 - (credited - thesis)),
    assignments: assignments.map(course => ({ unitId: course.unitId, number: course.number, title: course.title, semester: course.semester, status: course.status,
      credits: course.credits, assignedCategory: course.category, eligibleCategories: course.eligibleCategories, officialVvzUrl: course.officialVvzUrl })), warnings };
}

export async function checkMscCsGraduation(client: VvzClient, raw: unknown) {
  const input = parseMscCsGraduationRequest(raw);
  const resolved = await client.getMscCsCurriculumCourses(input.courses.map(course => course.unitId), input.major, input.minor);
  const courses: ResolvedCourse[] = resolved.map(course => ({ ...course, ...input.courses.find(inputCourse => inputCourse.unitId === course.id)! }));
  const allocationWarnings: string[] = [];
  const assigned = assignCourses(courses, allocationWarnings);
  const completed = evaluate(assigned.filter(course => course.status === 'passed'), input.previousBachelorLanguageCredits);
  const projected = evaluate(assigned, input.previousBachelorLanguageCredits);
  const combinationValid = MSC_CS_MAJOR_MINOR_COMBINATIONS[input.major].includes(input.minor);
  completed.graduationReady = completed.graduationReady && combinationValid;
  projected.graduationReady = projected.graduationReady && combinationValid;
  const attemptsKnown = input.failedInterFocusAttempts !== undefined;
  const additionalKnown = input.additionalRequirementsCompleted !== undefined;
  const thesisAdmissionChecks = {
    additionalRequirementsCompleted: input.additionalRequirementsCompleted ?? null,
    majorCompleted: completed.requirements.find(item => item.key === 'major_total')!.satisfied,
    majorCoreCompleted: completed.requirements.find(item => item.key === 'major_core')!.satisfied,
    interFocusCompleted: completed.requirements.find(item => item.key === 'inter_focus')!.satisfied,
    practicalWorkCompleted: completed.requirements.find(item => item.key === 'practical_work')!.satisfied,
    noMoreThanEightCreditsMissing: completed.missingPreThesisCredits <= 8,
    interFocusAttemptRule: attemptsKnown ? input.failedInterFocusAttempts! <= 2 : null,
  };
  const thesisAdmissionReady = additionalKnown && attemptsKnown ? Object.values(thesisAdmissionChecks).every(value => value === true) : null;
  return { programme: 'MSc Computer Science, Programme Regulations 2020', major: input.major, minor: input.minor, majorMinorCombinationValid: combinationValid,
    completed, projected, thesisAdmission: { ready: thesisAdmissionReady, checks: thesisAdmissionChecks, missingPreThesisCredits: completed.missingPreThesisCredits },
    warnings: [...allocationWarnings, ...(!combinationValid ? [`${input.major} cannot be combined with the ${input.minor} minor under the 2020 programme.`] : []),
      ...(input.failedInterFocusAttempts !== undefined && input.failedInterFocusAttempts > 2 ? ['More than two failed Inter Focus attempts leads to exclusion under the guide; contact Studies Administration immediately.'] : []),
      'This is a planning check based on the unofficial VVZ API and the March 2026 study guide, not an official degree audit. Confirm category assignments and graduation eligibility in myStudies or with D-INFK Studies Administration.'],
    rules: { total: 120, major: 26, majorCore: 16, minor: 18, interFocusCredits: 16, interFocusCourses: 2, seminar: 2,
      seminarMaximumCourses: 1, practicalWork: 8, practicalWorkMaximum: 10, scienceInPerspective: 2, scienceInPerspectiveMaximum: 6,
      languageCreditsMaximumAcrossBachelorAndMaster: 3, mastersThesis: 30, maximumAccreditedCredits: 130 },
    source: { guide: 'Computer Science Study Guide, Programme Regulations 2020, D-INFK, March 2026, sections 2.2 and 3.4', vvzApi: 'https://vvzapi.ch/', officialAudit: false } };
}

export const MSC_CS_GRADUATION_TOOL_DEFINITION = {
  name: 'msc_cs_check_graduation',
  description: 'Check completed and projected graduation readiness for ETH MSc Computer Science Programme Regulations 2020 using exact VVZ unitIds. Classifies each course against the selected major/minor curriculum for its semester, assigns it to only one category, and reports deficits plus Master thesis admission checks. Status passed counts as completed; in_progress/planned count only in the projection. Use assignedCategory only to reflect the student’s confirmed myStudies/tutor allocation. This is an unofficial planning check, never an official degree audit.',
  parameters: { type: 'object', properties: {
    major: { type: 'string', enum: MSC_CS_MAJORS }, minor: { type: 'string', enum: MSC_CS_MINORS },
    courses: { type: 'array', minItems: 1, maxItems: 50, items: { type: 'object', properties: {
      unitId: { type: 'integer', minimum: 1 }, status: { type: 'string', enum: STATUSES },
      assignedCategory: { type: 'string', enum: CATEGORIES, description: 'Optional confirmed category assignment from myStudies or the tutor; never guess this value.' },
    }, required: ['unitId', 'status'], additionalProperties: false } },
    additionalRequirementsCompleted: { type: 'boolean', description: 'Whether individual admission-decree requirements are completed. Omit if unknown.' },
    failedInterFocusAttempts: { type: 'integer', minimum: 0, maximum: 20, description: 'Total failed attempts across Inter Focus courses. Omit if unknown.' },
    previousBachelorLanguageCredits: { type: 'number', minimum: 0, maximum: 3, default: 0, description: 'Language-course credits already accredited in the ETH Bachelor, for the combined 3-credit cap.' },
  }, required: ['major', 'minor', 'courses'], additionalProperties: false },
} as const;
