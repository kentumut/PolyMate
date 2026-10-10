import { ASSIGNMENT_EFFORT_MAX, ASSIGNMENT_TITLE_MAX, parseAssignmentInput, type AssignmentInput } from '@polymate/contracts/assignments';
import { resolveZurichTime, zurichFields } from './study-block-form';

export type AssignmentFields = { title: string; date: string; time: string; estimatedMinutes: string };
export type AssignmentErrors = Partial<Record<keyof AssignmentFields, string>>;

export function initialAssignmentFields(input?: AssignmentInput): AssignmentFields {
  if (!input) return { title: '', date: '', time: '', estimatedMinutes: '' };
  const deadline = zurichFields(input.dueAt);
  return { title: input.title, date: deadline.date, time: deadline.time, estimatedMinutes: String(input.estimatedMinutes) };
}

export function validateAssignmentFields(fields: AssignmentFields): { input: AssignmentInput; errors?: never } | { errors: AssignmentErrors; input?: never } {
  const errors: AssignmentErrors = {};
  const title = fields.title.trim().replace(/\s+/g, ' ');
  if (!title) errors.title = 'Enter an assignment title.';
  else if (title.length > ASSIGNMENT_TITLE_MAX) errors.title = `Keep the title under ${ASSIGNMENT_TITLE_MAX} characters.`;
  const day = Date.parse(`${fields.date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date) || fields.date.startsWith('0000') || !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== fields.date) errors.date = 'Choose a valid deadline date.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.time)) errors.time = 'Choose a valid deadline time.';
  const minutes = Number(fields.estimatedMinutes);
  if (!fields.estimatedMinutes.trim() || !Number.isInteger(minutes) || minutes <= 0 || minutes > ASSIGNMENT_EFFORT_MAX) errors.estimatedMinutes = 'Enter a positive whole number of minutes.';
  let due: ReturnType<typeof resolveZurichTime>;
  try { due = errors.date || errors.time ? { error: 'invalid' } : resolveZurichTime(fields.date, fields.time); }
  catch { return { errors: { ...errors, date: 'Choose a valid deadline date.' } }; }
  if ('error' in due && due.error !== 'invalid') errors.time = due.error === 'nonexistent'
    ? 'This time does not exist in Europe/Zurich. Choose another time.'
    : 'This time occurs twice in Europe/Zurich. Choose another time.';
  if (Object.keys(errors).length || !('instant' in due)) return { errors };
  try { return { input: parseAssignmentInput({ title, dueAt: due.instant, estimatedMinutes: minutes }) }; }
  catch (error) { return { errors: { date: error instanceof Error ? error.message : 'Choose a valid deadline.' } }; }
}
