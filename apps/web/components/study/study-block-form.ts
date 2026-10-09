export const STUDY_TIMEZONE = 'Europe/Zurich' as const;

export type StudyBlockInput = {
  title: string;
  startAt: string;
  endAt: string;
  timezone: typeof STUDY_TIMEZONE;
};

// Component-local boundary matching TEAM_SCHEDULE until shared contracts land.
export type StudyBlockDialogEvent = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  source: 'google-personal' | 'polymate';
  editable: boolean;
  completion: 'open' | 'done';
  etag: string;
};

/** Deletion targets the saved event even if its session is already completed. */
export function deletionTarget(loadedEvent: StudyBlockDialogEvent | null, currentEvent: StudyBlockDialogEvent | null) {
  if (!loadedEvent || !currentEvent || loadedEvent.id !== currentEvent.id
    || loadedEvent.source !== 'polymate' || currentEvent.source !== 'polymate'
    || !loadedEvent.editable || !currentEvent.editable || !loadedEvent.etag) return null;
  return { eventId: loadedEvent.id, expectedEtag: loadedEvent.etag };
}

/** Completion targets saved event metadata, never unsaved title/time fields. */
export function completionTarget(loadedEvent: StudyBlockDialogEvent | null, currentEvent: StudyBlockDialogEvent | null) {
  if (loadedEvent?.completion === 'done' || currentEvent?.completion === 'done') return null;
  return deletionTarget(loadedEvent, currentEvent);
}

// Structural callback boundary until Dogancem publishes OperationResult.
export type StudyBlockOperationResult = {
  operationId: string;
  status: 'pending' | 'synced' | 'failed' | 'unknown';
  event?: StudyBlockDialogEvent;
  error?: { message: string; code?: string; recoverable?: boolean };
};

export type StudyBlockFields = {
  title: string;
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

export type StudyBlockErrors = Partial<Record<keyof StudyBlockFields, string>>;

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: STUDY_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function zurichFields(instant: string | number): { date: string; time: string } {
  const parts = formatter.formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const instant = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === date;
}

type LocalTimeResult = { instant: string } | { error: 'invalid' | 'nonexistent' | 'ambiguous' };

/** Resolve a wall-clock time without using the browser timezone or a fixed offset. */
export function resolveZurichTime(date: string, time: string): LocalTimeResult {
  if (!validDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'invalid' };
  const wallClock = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  // Sample both sides of Zurich's DST transition to find all possible offsets.
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const probe = wallClock + hours * 60 * 60 * 1000;
    const local = zurichFields(probe);
    offsets.add(Date.parse(`${local.date}T${local.time}:00Z`) - probe);
  }
  const matches = [...offsets].map(offset => wallClock - offset).filter(instant => {
    const local = zurichFields(instant);
    return local.date === date && local.time === time;
  });
  if (!matches.length) return { error: 'nonexistent' };
  if (matches.length > 1) return { error: 'ambiguous' };
  return { instant: new Date(matches[0]).toISOString() };
}

export function suggestedEnd(date: string, time: string): { date: string; time: string } | null {
  const start = resolveZurichTime(date, time);
  return 'instant' in start ? zurichFields(Date.parse(start.instant) + 50 * 60 * 1000) : null;
}

export function initialStudyBlockFields(initialStartAt?: string): StudyBlockFields {
  const empty = { title: '', date: '', startTime: '', endDate: '', endTime: '' };
  if (!initialStartAt || !Number.isFinite(Date.parse(initialStartAt))) return empty;
  const start = zurichFields(initialStartAt);
  const end = zurichFields(Date.parse(initialStartAt) + 50 * 60 * 1000);
  return { ...empty, date: start.date, startTime: start.time, endDate: end.date, endTime: end.time };
}

export function existingStudyBlockFields(event: StudyBlockDialogEvent): StudyBlockFields {
  const start = zurichFields(event.startAt);
  const end = zurichFields(event.endAt);
  return { title: event.title, date: start.date, startTime: start.time, endDate: end.date, endTime: end.time };
}

/** Moving an existing block preserves its elapsed duration, including over DST. */
export function movedEnd(fields: StudyBlockFields, date: string, time: string): { date: string; time: string } | null {
  const oldStart = resolveZurichTime(fields.date, fields.startTime);
  const oldEnd = resolveZurichTime(fields.endDate, fields.endTime);
  const newStart = resolveZurichTime(date, time);
  if (!('instant' in oldStart) || !('instant' in oldEnd) || !('instant' in newStart)) return null;
  const duration = Date.parse(oldEnd.instant) - Date.parse(oldStart.instant);
  return duration > 0 ? zurichFields(Date.parse(newStart.instant) + duration) : null;
}

export function validateStudyBlock(fields: StudyBlockFields):
  { input: StudyBlockInput; errors?: never } | { errors: StudyBlockErrors; input?: never } {
  const errors: StudyBlockErrors = {};
  if (!fields.title.trim()) errors.title = 'Enter a title for your study block.';
  if (!validDate(fields.date)) errors.date = 'Choose a valid date.';
  if (!validDate(fields.endDate)) errors.endDate = 'Choose a valid end date.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.startTime)) errors.startTime = 'Choose a valid start time.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.endTime)) errors.endTime = 'Choose a valid end time.';

  const start = resolveZurichTime(fields.date, fields.startTime);
  const end = resolveZurichTime(fields.endDate, fields.endTime);
  for (const [field, result] of [['startTime', start], ['endTime', end]] as const) {
    if ('error' in result && result.error !== 'invalid') {
      errors[field] = result.error === 'nonexistent'
        ? 'This time does not exist in Europe/Zurich. Choose another time.'
        : 'This time occurs twice in Europe/Zurich. Choose another time.';
    }
  }
  if ('instant' in start && 'instant' in end && Date.parse(end.instant) <= Date.parse(start.instant)) {
    errors.endTime = 'End time must be after start time.';
  }
  if (Object.keys(errors).length || !('instant' in start) || !('instant' in end)) return { errors };
  return { input: { title: fields.title.trim(), startAt: start.instant, endAt: end.instant, timezone: STUDY_TIMEZONE } };
}
