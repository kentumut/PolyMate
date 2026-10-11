import { MSC_CS_MAJORS, type MscCsMajor, type MscCsMinor } from './client';
import { MSC_CS_MAJOR_MINOR_COMBINATIONS } from './graduation';

export type SemesterPlanCourseStatus = 'passed' | 'in_progress' | 'planned';
export type SemesterPlanCourse = Readonly<{
  id: number;
  semester: string;
  number: string | null;
  title: string | null;
  credits: number | null;
  officialVvzUrl: string;
  status: SemesterPlanCourseStatus;
  sourceSemester?: string;
}>;
export type SemesterPlan = Readonly<{
  major: MscCsMajor;
  minor: MscCsMinor;
  activeSemester: string;
  targetCredits: number;
  courses: SemesterPlanCourse[];
}>;

export type SemesterPlanToolRequest = Readonly<{
  action: 'get_plan' | 'check_graduation' | 'improve_plan' | 'suggest_alternative';
  courseId?: number;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Send a valid ${label}.`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error(`The ${label} contains unsupported fields.`);
}

function semester(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}[SW]$/.test(value)) throw new Error(`${label} must use the YYYY-S/W VVZ format.`);
  return value;
}

/** Validates the browser-owned semester plan before attaching it to an authenticated agent turn. */
export function parseSemesterPlan(value: unknown): SemesterPlan {
  const input = record(value, 'semester plan');
  exact(input, ['major', 'minor', 'activeSemester', 'targetCredits', 'courses'], 'semester plan');
  if (typeof input.major !== 'string' || !(MSC_CS_MAJORS as readonly string[]).includes(input.major)) throw new Error('Choose a supported MSc Computer Science major.');
  const major = input.major as MscCsMajor;
  if (typeof input.minor !== 'string' || !MSC_CS_MAJOR_MINOR_COMBINATIONS[major].includes(input.minor as MscCsMinor)) throw new Error('Choose a minor supported by this major.');
  if (typeof input.targetCredits !== 'number' || !Number.isFinite(input.targetCredits) || input.targetCredits < 10 || input.targetCredits > 45) throw new Error('Target credits must be between 10 and 45.');
  if (!Array.isArray(input.courses) || input.courses.length > 50) throw new Error('A semester plan may contain at most 50 courses.');
  const courses = input.courses.map((value, index): SemesterPlanCourse => {
    const course = record(value, `course ${index + 1}`);
    exact(course, ['id', 'semester', 'number', 'title', 'credits', 'officialVvzUrl', 'status', 'sourceSemester'], `course ${index + 1}`);
    if (typeof course.id !== 'number' || !Number.isSafeInteger(course.id) || course.id <= 0) throw new Error('Every course needs a positive VVZ unit ID.');
    if (course.number !== null && typeof course.number !== 'string') throw new Error('Course numbers must be text or null.');
    if (course.title !== null && typeof course.title !== 'string') throw new Error('Course titles must be text or null.');
    if (course.credits !== null && (typeof course.credits !== 'number' || !Number.isFinite(course.credits) || course.credits < 0 || course.credits > 180)) throw new Error('Course credits must be between 0 and 180 or null.');
    if (typeof course.officialVvzUrl !== 'string' || !/^https:\/\/www\.vvz\.ethz\.ch\//.test(course.officialVvzUrl)) throw new Error('Every course needs an official VVZ URL.');
    if (!['passed', 'in_progress', 'planned'].includes(String(course.status))) throw new Error('Course status must be passed, in_progress, or planned.');
    return {
      id: course.id,
      semester: semester(course.semester, 'Course semester'),
      number: course.number as string | null,
      title: course.title as string | null,
      credits: course.credits as number | null,
      officialVvzUrl: course.officialVvzUrl,
      status: course.status as SemesterPlanCourseStatus,
      ...(course.sourceSemester === undefined ? {} : { sourceSemester: semester(course.sourceSemester, 'Source semester') }),
    };
  });
  if (new Set(courses.map(course => course.id)).size !== courses.length) throw new Error('Each VVZ course may appear only once.');
  return {
    major,
    minor: input.minor as MscCsMinor,
    activeSemester: semester(input.activeSemester, 'Active semester'),
    targetCredits: input.targetCredits,
    courses,
  };
}

export function parseSemesterPlanToolRequest(value: unknown): SemesterPlanToolRequest {
  const input = record(value, 'semester-plan tool request');
  exact(input, ['action', 'courseId'], 'semester-plan tool request');
  if (!['get_plan', 'check_graduation', 'improve_plan', 'suggest_alternative'].includes(String(input.action))) throw new Error('Choose a supported semester-plan action.');
  if (input.action === 'suggest_alternative') {
    if (typeof input.courseId !== 'number' || !Number.isSafeInteger(input.courseId) || input.courseId <= 0) throw new Error('Choose a positive courseId from the current semester plan.');
  } else if (input.courseId !== undefined) throw new Error('courseId is only supported when suggesting an alternative.');
  return { action: input.action as SemesterPlanToolRequest['action'], ...(input.courseId === undefined ? {} : { courseId: input.courseId as number }) };
}

export const SEMESTER_PLAN_TOOL_DEFINITION = {
  name: 'polymate_semester_plan',
  description: 'Use the student’s current browser semester plan. get_plan answers which courses are passed, in progress, or planned. check_graduation evaluates the current plan. improve_plan proposes verified additions without changing the saved plan. suggest_alternative proposes a replacement for one planned courseId without changing the saved plan. The plan is supplied by the authenticated PolyMate app; never ask the model for or accept an owner ID.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['get_plan', 'check_graduation', 'improve_plan', 'suggest_alternative'] },
      courseId: { type: 'integer', minimum: 1, description: 'Required only for suggest_alternative; use an ID returned by get_plan.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
} as const;
