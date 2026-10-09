import type { CalendarEvent, StudyBlockInput } from '@polymate/contracts/calendar';
import { CALENDAR_TIMEZONE, zonedTimeToInstant } from '@polymate/contracts/time';
import type { GoogleEvent, GoogleEventTime, GoogleEventWrite } from './google-api';

/** Private extended properties are visible only on the owner's copy of the event. */
export const PROP_KIND = 'polymateKind';
export const PROP_OWNER = 'polymateOwner';
export const PROP_COMPLETION = 'polymateCompletion';
export const STUDY_BLOCK_KIND = 'study-block';
export const DONE_PREFIX = '✓ ';
const STUDY_COLOR_ID = '2';

/** Deterministic Google event ID (base32hex alphabet) so a retried create cannot duplicate a block. */
export function eventIdForOperation(operationId: string): string {
  return `pm${operationId.replace(/-/g, '').toLowerCase()}`;
}

export function isOwnedStudyBlock(event: GoogleEvent, ownerId: string): boolean {
  const props = event.extendedProperties?.private;
  return props?.[PROP_KIND] === STUDY_BLOCK_KIND && props[PROP_OWNER] === ownerId;
}

function toInstant(time: GoogleEventTime | undefined): { at: string; allDay: boolean } | null {
  if (time?.dateTime) {
    const parsed = Date.parse(time.dateTime);
    return Number.isNaN(parsed) ? null : { at: new Date(parsed).toISOString(), allDay: false };
  }
  const match = time?.date?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const at = zonedTimeToInstant({ year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) });
  return { at: at.toISOString(), allDay: true };
}

export function toCalendarEvent(event: GoogleEvent, ownerId: string): CalendarEvent | null {
  if (event.status === 'cancelled') return null;
  const start = toInstant(event.start);
  const end = toInstant(event.end);
  if (!start || !end) return null;
  const owned = isOwnedStudyBlock(event, ownerId);
  const completion = owned && event.extendedProperties?.private?.[PROP_COMPLETION] === 'done' ? 'done' : 'open';
  let title = event.summary?.trim() || (owned ? 'Study block' : 'Busy');
  if (owned && completion === 'done' && title.startsWith(DONE_PREFIX)) title = title.slice(DONE_PREFIX.length);
  return {
    id: event.id,
    title,
    startAt: start.at,
    endAt: end.at,
    timezone: CALENDAR_TIMEZONE,
    allDay: start.allDay,
    source: owned ? 'polymate' : 'google-personal',
    editable: owned,
    completion,
    etag: event.etag,
  };
}

/** Whether an event makes the student unavailable for a study block. */
export function blocksTime(event: GoogleEvent): boolean {
  if (event.status === 'cancelled' || event.transparency === 'transparent') return false;
  if (!event.start?.dateTime || !event.end?.dateTime) return false;
  return !event.attendees?.some(attendee => attendee.self && attendee.responseStatus === 'declined');
}

export function summaryFor(title: string, completion: 'open' | 'done'): string {
  return completion === 'done' ? `${DONE_PREFIX}${title}` : title;
}

export function newStudyBlockEvent(input: StudyBlockInput, ownerId: string, operationId: string): GoogleEventWrite & { id: string } {
  return {
    id: eventIdForOperation(operationId),
    summary: input.title,
    description: 'Study block planned with PolyMate.',
    start: { dateTime: input.startAt, timeZone: CALENDAR_TIMEZONE },
    end: { dateTime: input.endAt, timeZone: CALENDAR_TIMEZONE },
    transparency: 'opaque',
    colorId: STUDY_COLOR_ID,
    extendedProperties: { private: { [PROP_KIND]: STUDY_BLOCK_KIND, [PROP_OWNER]: ownerId, [PROP_COMPLETION]: 'open' } },
  };
}
