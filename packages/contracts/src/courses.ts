import { ContractError, parseOperationId } from './calendar';

export type ExamPrepPriority = 'must' | 'optional' | 'not_required';

export type Course = Readonly<{
  id: string;
  name: string;
  exerciseSessionCount: number;
  lectureHoursPerWeek: number;
  exerciseSessionMinutes: number;
  examDate: string;
  examPrep: Readonly<Record<ExamPrepPriority, readonly string[]>>;
  version: number;
}>;

export type CourseMutation =
  | Readonly<{ action: 'save'; course: Course }>
  | Readonly<{ action: 'delete'; id: string; expectedVersion: number }>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('Send a course object.');
  return value as Record<string, unknown>;
}

function prepItems(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string')) throw new ContractError(`${label} must be a list of topics.`);
  const items = value.map(item => (item as string).trim()).filter(Boolean);
  if (items.some(item => item.length > 300)) throw new ContractError(`Keep each ${label.toLowerCase()} topic under 300 characters.`);
  return [...new Set(items)];
}

export function parseCourse(value: unknown): Course {
  const body = object(value);
  if (Object.keys(body).some(key => !['id', 'name', 'exerciseSessionCount', 'lectureHoursPerWeek', 'exerciseSessionMinutes', 'examDate', 'examPrep', 'version'].includes(key))) throw new ContractError('Course contains unsupported fields.');
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) throw new ContractError('Enter a course name of at most 120 characters.');
  if (!Number.isInteger(body.exerciseSessionCount) || (body.exerciseSessionCount as number) < 0 || (body.exerciseSessionCount as number) > 200) throw new ContractError('Exercise-session count must be between 0 and 200.');
  if (typeof body.lectureHoursPerWeek !== 'number' || !Number.isFinite(body.lectureHoursPerWeek) || body.lectureHoursPerWeek < 0 || body.lectureHoursPerWeek > 60) throw new ContractError('Weekly lecture hours must be between 0 and 60.');
  if (!Number.isInteger(body.exerciseSessionMinutes) || (body.exerciseSessionMinutes as number) < 0 || (body.exerciseSessionMinutes as number) > 1440) throw new ContractError('Exercise-session duration must be between 0 and 1,440 minutes.');
  if (typeof body.examDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.examDate) || Number.isNaN(Date.parse(`${body.examDate}T00:00:00Z`))) throw new ContractError('Choose a valid exam date.');
  if (!Number.isInteger(body.version) || (body.version as number) < 0 || (body.version as number) > 2147483647) throw new ContractError('Course version is invalid.');
  const examPrep = object(body.examPrep);
  if (Object.keys(examPrep).some(key => !['must', 'optional', 'not_required'].includes(key))) throw new ContractError('Exam preparation contains unsupported priorities.');
  return {
    id: parseOperationId(body.id), name: body.name.trim(), exerciseSessionCount: body.exerciseSessionCount as number,
    lectureHoursPerWeek: body.lectureHoursPerWeek, exerciseSessionMinutes: body.exerciseSessionMinutes as number,
    examDate: body.examDate, examPrep: { must: prepItems(examPrep.must, 'Must solve'), optional: prepItems(examPrep.optional, 'Optional'), not_required: prepItems(examPrep.not_required, 'Not required') },
    version: body.version as number,
  };
}

export function parseCourseMutation(value: unknown): CourseMutation {
  const body = object(value);
  if (body.action === 'save' && Object.keys(body).every(key => ['action', 'course'].includes(key))) return { action: 'save', course: parseCourse(body.course) };
  if (body.action === 'delete' && Object.keys(body).every(key => ['action', 'id', 'expectedVersion'].includes(key))) {
    if (!Number.isInteger(body.expectedVersion) || (body.expectedVersion as number) < 1) throw new ContractError('Course version is invalid.');
    return { action: 'delete', id: parseOperationId(body.id), expectedVersion: body.expectedVersion as number };
  }
  throw new ContractError('Choose save or delete for this course.');
}
