import { createHash } from 'node:crypto';
import ical, { type DateWithTimeZone, type VEvent } from 'node-ical';
import { addZonedDays, zonedParts, zonedTimeToInstant } from '@polymate/contracts/time';
import type { ImportSource, ImportEvent, ImportPreview } from '@polymate/contracts/imports';
export type { ImportSource, ImportEvent, ImportPreview } from '@polymate/contracts/imports';
export const IMPORT_MAX_BYTES = 1_000_000;
export class CalendarImportError extends Error {
  constructor(message: string) { super(message); this.name = 'CalendarImportError'; }
}

function text(value: unknown, max = 200): string {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' && 'val' in value && typeof value.val === 'string' ? value.val : '';
  return raw.replace(/https?:\/\/[^\s<>"']*(?:authtoken|wstoken|token|sesskey)=[^\s<>"']*/gi, '[private link]')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').trim().slice(0, max);
}
function instant(date: DateWithTimeZone): Date {
  return date.dateOnly ? zonedTimeToInstant({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }) : date;
}

/** Preview only: no fetch, persistence, assignment inference or Google writes. */
export async function parseCalendarImport(raw: string, source: ImportSource, now = new Date()): Promise<ImportPreview> {
  if (!['moodle', 'mystudies'].includes(source)) throw new CalendarImportError('Choose Moodle or myStudies.');
  if (Buffer.byteLength(raw) > IMPORT_MAX_BYTES) throw new CalendarImportError('Choose an ICS file smaller than 1 MB.');
  const unfolded = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  if (!/^BEGIN:VCALENDAR\s*$/mi.test(unfolded) || !/^END:VCALENDAR\s*$/mi.test(unfolded)) throw new CalendarImportError('Choose a valid .ics calendar export.');
  const components = [...unfolded.matchAll(/^BEGIN:VEVENT\s*\n[\s\S]*?^END:VEVENT\s*$/gmi)].map(match => match[0].trim());
  if ((unfolded.match(/^BEGIN:VEVENT\s*$/gmi)?.length ?? 0) !== components.length) throw new CalendarImportError('The calendar contains an incomplete event. Export it again.');
  if (components.length > 1000 || (unfolded.match(/^RRULE[:;]/gmi)?.length ?? 0) > 100) throw new CalendarImportError('Export a smaller calendar (at most 1,000 events and 100 recurring series).');
  const warnings = new Set<string>();
  if (/^(?:DTSTART|DTEND):\d{8}T\d{6}\s*$/mi.test(unfolded)) warnings.add('Floating times have no timezone in this file and are interpreted in Europe/Zurich. Verify the deadline before confirming.');
  const unique = new Map<string, string>();
  const conflictingUids = new Set<string>();
  let duplicateCount = 0;
  for (const block of components) {
    const uid = /^UID:(.*)$/mi.exec(block)?.[1]?.trim();
    if (!uid || uid.length > 1024) { warnings.add('An event with a missing or invalid UID was skipped.'); continue; }
    if (/^RDATE[:;]/mi.test(block)) { warnings.add('Events with additional RDATE recurrence dates are not supported and were skipped. Export individual events instead.'); continue; }
    // Reject calendar-field overflow before node-ical can normalize e.g. February 30 into March.
    const dates = [...block.matchAll(/^(?:DTSTART|DTEND|RECURRENCE-ID|EXDATE|RDATE)[^:\n]*:([^\n]*)$/gmi)].flatMap(match => match[1].trim().split(','));
    if (!/^DTSTART[^:\n]*:/mi.test(block) || dates.some(value => {
      const parts = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(value);
      if (!parts) return true;
      const [, year, month, day, hour = '00', minute = '00', second = '00'] = parts;
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      return Number(year) < 100 || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}` || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59;
    })) { warnings.add('An event with invalid or unsupported dates was skipped.'); continue; }
    let nonexistent = false;
    for (const match of block.matchAll(/^(?:DTSTART|DTEND)([^:\n]*):(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)\s*$/gmi)) {
      if (match[8]) continue;
      const timezone = /TZID=([^;]+)/i.exec(match[1])?.[1].replaceAll('"', '') ?? 'Europe/Zurich';
      const local = { year: Number(match[2]), month: Number(match[3]), day: Number(match[4]), hour: Number(match[5]), minute: Number(match[6]) };
      try {
        const observed = zonedParts(zonedTimeToInstant(local, timezone), timezone);
        if (Object.entries(local).some(([key, value]) => observed[key as keyof typeof local] !== value)) nonexistent = true;
      } catch { throw new CalendarImportError('This export uses an unsupported timezone. Export with UTC or an IANA timezone such as Europe/Zurich.'); }
    }
    if (nonexistent) { warnings.add('An event with a nonexistent daylight-saving wall-clock time was skipped. Choose another time and re-export.'); continue; }
    const recurrence = /^RECURRENCE-ID[^:]*:(.*)$/mi.exec(block)?.[0] ?? '';
    const key = JSON.stringify([uid, recurrence]);
    if (unique.has(key)) {
      if (unique.get(key) === block) duplicateCount++;
      else conflictingUids.add(uid);
    } else unique.set(key, block);
  }
  if (duplicateCount) warnings.add(`${duplicateCount} duplicate event entries were ignored within this file.`);
  if (conflictingUids.size) warnings.add('Conflicting entries with the same UID and recurrence identity were skipped. Re-export the calendar to resolve them.');
  const blocks = [...unique.values()].filter(block => !conflictingUids.has(/^UID:(.*)$/mi.exec(block)![1].trim()));
  // Ignore calendar-level material; only VEVENTs are used. Floating times mean Zurich, not server-local time.
  const normalized = ['BEGIN:VCALENDAR', 'VERSION:2.0', ...blocks, 'END:VCALENDAR'].join('\n')
    .replace(/^(DTSTART|DTEND|RECURRENCE-ID|EXDATE|RDATE):(?=\d{8}T\d{6}(?:,\d{8}T\d{6})*\s*$)/gmi, '$1;TZID=Europe/Zurich:');
  for (const match of normalized.matchAll(/TZID=([^;:\n]+)[;:]/gi)) {
    try { new Intl.DateTimeFormat('en', { timeZone: match[1].replaceAll('"', '') }); }
    catch { throw new CalendarImportError('This export uses an unsupported timezone. Export with UTC or an IANA timezone such as Europe/Zurich.'); }
  }
  let parsed: Awaited<ReturnType<typeof ical.async.parseICS>>;
  try { parsed = await ical.async.parseICS(normalized); }
  catch { throw new CalendarImportError('The calendar could not be read. Export a fresh .ics file.'); }
  const from = new Date(now); const to = addZonedDays(now, 365);
  const events: ImportEvent[] = [];
  for (const component of Object.values(parsed)) {
    if (!component || component.type !== 'VEVENT') continue;
    const event = component as VEvent;
    if (event.status === 'CANCELLED') { warnings.add('Cancelled events were skipped.'); continue; }
    if (!(event.start instanceof Date) || !Number.isFinite(event.start.getTime())) { warnings.add('An event with an invalid start date was skipped.'); continue; }
    if (event.rrule && (!/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|\r?\n|$)/i.test(event.rrule.toString()) || /(?:^|[;:])BY(?:SECOND|MINUTE|HOUR)=/i.test(event.rrule.toString()))) {
      warnings.add('Unsupported high-frequency recurring events were skipped.'); continue;
    }
    if (event.rrule) warnings.add('Recurring series are previewed only within the next 365 days. Dates outside that window are not imported.');
    try {
      const instances = event.rrule ? ical.expandRecurringEvent(event, { from, to, expandOngoing: true }) : [{ event, start: event.start, end: event.end ?? event.start, summary: event.summary, isFullDay: Boolean(event.start.dateOnly) }];
      for (const instance of instances) {
        if (instance.event.status === 'CANCELLED') { warnings.add('Cancelled occurrences were skipped.'); continue; }
        const start = instant(instance.start); const end = instant(instance.end);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) { warnings.add('An event with invalid dates was skipped.'); continue; }
        const recurrenceId = instance.event.recurrenceid?.toISOString() ?? (event.rrule ? instance.start.toISOString() : null);
        const key = createHash('sha256').update(JSON.stringify([source, event.uid, recurrenceId])).digest('hex');
        events.push({ key, uid: event.uid, recurrenceId, title: text(instance.summary) || 'Untitled calendar event', description: text(instance.event.description, 4000), startAt: start.toISOString(), endAt: end.toISOString(), allDay: instance.isFullDay });
        if (events.length > 500) throw new CalendarImportError('Too many occurrences. Export a smaller calendar (at most 500 preview rows).');
      }
    } catch (error) {
      if (error instanceof CalendarImportError) throw error;
      warnings.add('An unsupported recurring event was skipped.');
    }
  }
  if (events.some(event => event.allDay)) warnings.add('All-day events have no deadline time. Choose a deadline explicitly before preparing an assignment.');
  return { source, previewedAt: now.toISOString(), events: events.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.key.localeCompare(b.key)), warnings: [...warnings], duplicateCount, recurrenceWindow: { from: from.toISOString(), to: to.toISOString() } };
}
