import { describe, expect, it, vi } from 'vitest';
import { MoodleCalendarFeed, parseMoodleCalendar, parseMoodleFeedUrl } from '../packages/core/integrations/moodle/calendar-feed';

const site = 'https://moodle.test';
const secret = 'a'.repeat(32);
const url = `${site}/calendar/export_execute.php?userid=7&authtoken=${secret}&preset_what=courses&preset_time=recentupcoming`;
const now = new Date('2026-10-10T08:00:00Z');
const feed = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Moodle//EN', ...events, 'END:VCALENDAR'].join('\r\n');
const event = (lines: string) => `BEGIN:VEVENT\r\n${lines.trim().replaceAll('\n', '\r\n')}\r\nEND:VEVENT`;
const basic = (date = '20261012T140000Z') => event(`UID:42@moodle.test
DTSTART:${date}
DTEND:${date}
SUMMARY:Sheet 1
CATEGORIES:Analysis`);

describe('Moodle calendar URL boundaries', () => {
  it('accepts the configured export URL and webcal links without modifying export filters', () => {
    expect(parseMoodleFeedUrl(url, site)).toBe(url);
    expect(parseMoodleFeedUrl(url.replace('https:', 'webcal:'), site)).toBe(url);
    const subpath = url.replace(site, `${site}/learn`);
    expect(parseMoodleFeedUrl(subpath, `${site}/learn`)).toBe(subpath);
  });
  it.each([
    url.replace(site, 'https://evil.test'), url.replace('https:', 'http:'), url.replace(site, 'https://moodle.test:8443'),
    url.replace(site, 'https://user:password@moodle.test'), `${url}#fragment`, `${url}&authtoken=${secret}`,
    `${url}&redirect=https://evil.test`, url.replace('export_execute', 'export'), url.replace(secret, 'short'),
    url.replace('userid=7', 'userid=0'),
  ])('rejects unsupported input without echoing credentials', value => {
    let message = '';
    try { parseMoodleFeedUrl(value, site); } catch (error) { message = (error as Error).message; }
    expect(message).not.toBe(''); expect(message).not.toContain(secret); expect(message).not.toContain(value);
  });
});

describe('Moodle calendar parsing', () => {
  it('maps Moodle UTC point dates without inventing assignment or submission details', async () => {
    const snapshot = await parseMoodleCalendar(feed(basic()), site, secret, now);
    expect(snapshot.source).toBe('calendar-subscription'); expect(snapshot.announcements).toEqual([]);
    expect(snapshot.calendarEvents).toHaveLength(1);
    expect(snapshot.calendarEvents![0]).toMatchObject({ title: 'Sheet 1', courseName: 'Analysis', startAt: '2026-10-12T14:00:00.000Z', endAt: '2026-10-12T14:00:00.000Z', allDay: false });
    expect(snapshot.assignments[0].dueAt).toBe('2026-10-12T14:00:00.000Z');
    expect(snapshot.warnings.join(' ')).toContain('not independently verified');
    expect(await new MoodleCalendarFeed(site, url).assignmentStatus()).toEqual({ submitted: null, extensionDueAt: null });
  });
  it('preserves IDs when a date changes and removes cancelled entries', async () => {
    const first = await parseMoodleCalendar(feed(basic()), site, secret, now);
    const changed = await parseMoodleCalendar(feed(basic('20261011T140000Z')), site, secret, now);
    expect(changed.calendarEvents![0].id).toBe(first.calendarEvents![0].id);
    const cancelled = await parseMoodleCalendar(feed(basic().replace('SUMMARY:', 'STATUS:CANCELLED\r\nSUMMARY:')), site, secret, now);
    expect(cancelled.calendarEvents).toEqual([]);
  });
  it('handles folded text and redacts subscription secrets and private links', async () => {
    const snapshot = await parseMoodleCalendar(feed(event(`UID:1
DTSTART:20261012T140000Z
DTEND:20261012T150000Z
SUMMARY:Long
  title
DESCRIPTION:<script>bad()</script>Work\\, now\\n${secret} https://evil.test/?token=private
URL:https://moodle.test/mod/assign/view.php?id=4&authtoken=${secret}`)), site, secret, now);
    expect(snapshot.calendarEvents![0].title).toBe('Long title');
    expect(snapshot.calendarEvents![0].description).toContain('Work, now\n');
    expect(snapshot.calendarEvents![0].sourceUrl).toBe(`${site}/mod/assign/view.php?id=4`);
    expect(JSON.stringify(snapshot)).not.toContain(secret); expect(JSON.stringify(snapshot)).not.toContain('bad()'); expect(JSON.stringify(snapshot)).not.toContain('token=private');
  });
  it('interprets floating times in Zurich and preserves all-day dates across DST', async () => {
    const snapshot = await parseMoodleCalendar(feed(event(`UID:floating
DTSTART:20261026T090000
DTEND:20261026T100000
SUMMARY:Lecture`), event(`UID:all-day
DTSTART;VALUE=DATE:20261025
DTEND;VALUE=DATE:20261026
SUMMARY:Holiday`)), site, secret, now);
    const allDay = snapshot.calendarEvents!.find(event => event.allDay)!;
    expect(allDay.startAt).toBe('2026-10-24T22:00:00.000Z'); expect(allDay.endAt).toBe('2026-10-25T23:00:00.000Z');
    expect(snapshot.assignments.find(event => event.id === allDay.id)!.dueAt).toBeNull();
    expect(snapshot.calendarEvents!.find(event => !event.allDay)!.startAt).toBe('2026-10-26T08:00:00.000Z');
  });
  it('expands weekly events across DST and honors exclusions and moved occurrences', async () => {
    const snapshot = await parseMoodleCalendar(feed(event(`UID:recurring
DTSTART;TZID=Europe/Zurich:20261019T090000
DTEND;TZID=Europe/Zurich:20261019T100000
RRULE:FREQ=WEEKLY;COUNT=4
EXDATE;TZID=Europe/Zurich:20261102T090000
SUMMARY:Lecture`), event(`UID:recurring
RECURRENCE-ID;TZID=Europe/Zurich:20261109T090000
DTSTART;TZID=Europe/Zurich:20261109T110000
DTEND;TZID=Europe/Zurich:20261109T120000
SUMMARY:Moved lecture`)), site, secret, now);
    expect(snapshot.calendarEvents!.map(event => event.startAt)).toEqual(['2026-10-19T07:00:00.000Z', '2026-10-26T08:00:00.000Z', '2026-11-09T10:00:00.000Z']);
    expect(new Set(snapshot.calendarEvents!.map(event => event.id)).size).toBe(3);
  });
  it('rejects HTML and oversized feeds, and skips dense recurrence rules', async () => {
    await expect(parseMoodleCalendar('<html>Login</html>', site, secret, now)).rejects.toThrow('supported calendar');
    await expect(parseMoodleCalendar(' '.repeat(1_000_001), site, secret, now)).rejects.toThrow('supported calendar');
    const snapshot = await parseMoodleCalendar(feed(basic().replace('SUMMARY:', 'RRULE:FREQ=DAILY;BYSECOND=0,1,2\r\nSUMMARY:')), site, secret, now);
    expect(snapshot.calendarEvents).toEqual([]); expect(snapshot.warnings.join(' ')).toContain('high-frequency');
  });
  it('refuses redirects and sanitizes fetch errors that contain the private URL', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error(`Failed ${url}`));
    await expect(new MoodleCalendarFeed(site, url, fetcher).snapshot()).rejects.toThrow('could not be refreshed');
    expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'error', cache: 'no-store' }));
  });
});
