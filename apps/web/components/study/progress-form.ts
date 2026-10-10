import { ASSIGNMENT_EFFORT_MAX } from '@polymate/contracts/assignments';
import type { ProgressAction } from '@polymate/contracts/study-progress';

export type ProgressFields = { action: ProgressAction; minutes: string; finished: boolean; note: string };
export type ProgressFieldErrors = { minutes?: string; note?: string };
export function validateProgressFields(fields: ProgressFields): ProgressFieldErrors {
  const errors: ProgressFieldErrors = {};
  if (fields.action !== 'missed' && !(fields.action === 'done' && fields.finished)) {
    const minutes = Number(fields.minutes);
    if ((fields.action === 'partly_done' || fields.minutes.trim()) && (!fields.minutes.trim() || !Number.isInteger(minutes) || minutes <= 0 || minutes > ASSIGNMENT_EFFORT_MAX)) {
      errors.minutes = 'Enter a positive whole number of minutes remaining for the entire assignment. To report zero, choose Done and explicitly confirm the whole assignment is finished.';
    }
  }
  if (fields.action === 'stuck' && !fields.note.trim()) errors.note = 'Describe the question, topic or difficulty you got stuck on.';
  else if (fields.note.length > 2000) errors.note = 'Keep the note under 2000 characters.';
  return errors;
}
