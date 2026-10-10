import { createHash } from 'node:crypto';
import ical, { type DateWithTimeZone, type VEvent } from 'node-ical';
import { ContractError } from '@polymate/contracts/calendar';
import { addZonedDays, zonedTimeToInstant } from '@polymate/contracts/time';
import type { AssignmentStatus, MoodleCalendarEvent, MoodleReader, MoodleSnapshot } from '@polymate/contracts/moodle';
import { readBoundedText } from '../../agent/http';
import { MoodleError } from './client';

const MAX_BYTES = 1_000_000;
export const FEED_LIMITS = 'Calendar subscriptions contain exported events and dates only. Announcements, submission status, personal deadline extensions, and complete assignment requirements are unavailable. Calendar dates are planning targets, not independently verified assignment deadlines.';

/** Restrict credential-bearing feeds to the exact administrator-configured Moodle export endpoint. */
export function parseMoodleFeedUrl(value: unknown, site: string): string {
  if (typeof value !== 'string' || value.length > 4096) throw new ContractError('Paste your Moodle calendar subscription URL.');
  let url: URL, base: URL;
  try { url = new URL(value.trim().replace(/^webcal:/i, 'https:')); base = new URL(site); }
  catch { throw new ContractError('Paste a valid Moodle calendar subscription URL.'); }
  const expectedPath = `${base.pathname.replace(/\/$/, '')}/calendar/export_execute.php`;
  if (base.protocol !== 'https:' || base.username || base.password || url.protocol !== 'https:' || url.origin !== base.origin ||
      url.pathname !== expectedPath || url.username || url.password || url.hash) {
    throw new ContractError('Use the calendar export URL from the configured Moodle site.');
  }
  const allowed = ['userid', 'username', 'authtoken', 'preset_what', 'preset_time'];
  const keys = [...url.searchParams.keys()];
  if (keys.some(key => !allowed.includes(key)) || new Set(keys).size !== keys.length ||
      !/^[a-z0-9]{16,256}$/i.test(url.searchParams.get('authtoken') ?? '') ||
      !(/^[1-9]\d*$/.test(url.searchParams.get('userid') ?? '') || Boolean(url.searchParams.get('username')?.trim()))) {
    throw new ContractError('Use “Get calendar URL” in Moodle, rather than the calendar page address.');
  }
  return url.href;
}

function text(value: unknown, feedSecret: string): string {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' && 'val' in value && typeof value.val === 'string' ? value.val : '';
  // Source text can contain credential-bearing links or instructions; return inert, redacted text only.
  return raw.replaceAll(feedSecret, '[private calendar reference]').replace(/https?:\/\/[^\s<>"']*(?:authtoken|wstoken|token|sesskey)=[^\s<>"']*/gi, '[private link]')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&')
    .trim().slice(0, 12_000);
}

function instant(date: DateWithTimeZone): Date {
  if (!date.dateOnly) return date;
  // node-ical represents VALUE=DATE as host-local midnight with dateOnly metadata.
  // Recover those calendar fields, then explicitly interpret the day in Zurich.
  return zonedTimeToInstant({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
}

export async function parseMoodleCalendar(raw: string, site: string, feedSecret: string, now = new Date()): Promise<MoodleSnapshot> {
  if (Buffer.byteLength(raw) > MAX_BYTES || !/^BEGIN:VCALENDAR\s*$/mi.test(raw) || !/^END:VCALENDAR\s*$/mi.test(raw) ||
      (raw.match(/^BEGIN:VEVENT\s*$/gmi)?.length ?? 0) > 1000 || (raw.match(/^RRULE[:;]/gmi)?.length ?? 0) > 100) {
    throw new MoodleError('invalid_response', 'Moodle did not return a supported calendar feed. Check that calendar export is enabled and the link is current.');
  }
  const warnings = [FEED_LIMITS, 'Only the dates included in your Moodle export are available. Choose “Recent and next 60 days” when exporting.'];
  // Floating times have no timezone. Apply the product timezone explicitly, never the server's timezone.
  const normalized = raw.replace(/^(DTSTART|DTEND|RECURRENCE-ID|EXDATE|RDATE):(?=\d{8}T\d{6}(?:,\d{8}T\d{6})*\s*$)/gmi, '$1;TZID=Europe/Zurich:');
  let parsed: Awaited<ReturnType<typeof ical.async.parseICS>>;
  try { parsed = await ical.async.parseICS(normalized); }
  catch { throw new MoodleError('invalid_response', 'Moodle returned an unreadable calendar feed.'); }
  const events: MoodleCalendarEvent[] = [];
  const ids = new Set<number>();
  const from = addZonedDays(now, -7), to = addZonedDays(now, 60);
  for (const component of Object.values(parsed)) {
    if (!component || component.type !== 'VEVENT' || component.status === 'CANCELLED') continue;
    const event = component as VEvent;
    if (!event.uid || event.uid.length > 1024 || !(event.start instanceof Date) || !Number.isFinite(event.start.getTime())) {
      warnings.push('An event with an invalid ID or start date was skipped.'); continue;
    }
    if (event.rrule && (!/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|\r?\n|$)/i.test(event.rrule.toString()) ||
        /(?:^|[;:])BY(?:SECOND|MINUTE|HOUR)=/i.test(event.rrule.toString()))) {
      warnings.push('A high-frequency recurring event was skipped.'); continue;
    }
    let instances;
    try { instances = ical.expandRecurringEvent(event, { from, to, expandOngoing: true }); }
    catch { warnings.push('An unsupported recurring event was skipped.'); continue; }
    for (const instance of instances) {
      const source = instance.event;
      if (source.status === 'CANCELLED') continue;
      const start = instant(instance.start);
      const end = instant(instance.end);
      if (!Number.isFinite(end.getTime()) || end < start || start > to || end < from) { warnings.push('An event with invalid or out-of-range dates was skipped.'); continue; }
      const occurrence = event.rrule ? (source.recurrenceid ?? instance.start).toISOString() : '';
      const id = parseInt(createHash('sha256').update(`${site}|${event.uid}|${occurrence}`).digest('hex').slice(0, 12), 16) || 1;
      if (ids.has(id)) continue;
      ids.add(id);
      const courseName = text(source.categories?.[0] ?? 'Moodle calendar', feedSecret).slice(0, 200);
      const title = text(instance.summary, feedSecret).slice(0, 200) || 'Untitled calendar event';
      let sourceUrl = `${site.replace(/\/$/, '')}/calendar/view.php?view=day&time=${Math.floor(start.getTime() / 1000)}`;
      try {
        const url = new URL(source.url ?? '');
        if (url.origin === new URL(site).origin && /^\/(?:.*\/)?(?:mod\/[^/]+\/view|course\/view)\.php$/.test(url.pathname) && /^[1-9]\d*$/.test(url.searchParams.get('id') ?? '')) {
          sourceUrl = `${url.origin}${url.pathname}?id=${url.searchParams.get('id')}`;
        }
      } catch { /* Use a credential-free Moodle calendar link. */ }
      events.push({ id, title, description: text(source.description, feedSecret), courseName, startAt: start.toISOString(), endAt: end.toISOString(), allDay: instance.isFullDay, sourceUrl });
      if (events.length > 500) throw new MoodleError('invalid_response', 'The calendar has too many events. Export a smaller date range.');
    }
  }
  events.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id - b.id);
  if (events.some(event => event.allDay)) warnings.push('All-day entries do not specify a deadline time and cannot be used as timed planning targets.');
  return {
    source: 'calendar-subscription', calendarEvents: events, courses: [], announcements: [], fetchedAt: now.toISOString(), warnings: [...new Set(warnings)],
    // Compatibility with the validated planner: selection means studying before this calendar date.
    assignments: events.map(event => ({ ...event, courseId: 0, dueAt: event.allDay ? null : event.startAt, opensAt: null })),
  };
}

export class MoodleCalendarFeed implements MoodleReader {
  private readonly url: string;
  constructor(private readonly site: string, url: string, private readonly fetcher: typeof fetch = fetch, private readonly clock: () => Date = () => new Date()) {
    this.url = parseMoodleFeedUrl(url, site);
  }
  async snapshot(): Promise<MoodleSnapshot> {
    let response: Response, raw: string;
    try {
      response = await this.fetcher(this.url, { method: 'GET', redirect: 'error', cache: 'no-store', headers: { Accept: 'text/calendar' }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error();
      raw = await readBoundedText(response.body, MAX_BYTES);
    } catch { throw new MoodleError('unavailable', 'The Moodle calendar could not be refreshed. Check the subscription link or try again.'); }
    return parseMoodleCalendar(raw, this.site, new URL(this.url).searchParams.get('authtoken')!, this.clock());
  }
  async assignmentStatus(): Promise<AssignmentStatus> { return { submitted: null, extensionDueAt: null }; }
}
