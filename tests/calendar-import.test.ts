import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseCalendarImport, IMPORT_MAX_BYTES } from '../packages/core/calendar/import';

const now = new Date('2026-10-10T08:00:00Z');
const calendar = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\n');
const event = (fields = '', uid = 'sheet-1') => ['BEGIN:VEVENT', `UID:${uid}`, 'DTSTART:20261016T140000Z', 'SUMMARY:Sheet 1', fields, 'END:VEVENT'].join('\n');

describe('ICS preview parser', () => {
  it('retains source UID with stable keys after an external time change, and separates sources', async () => {
    const original = await parseCalendarImport(calendar(event()), 'moodle', now);
    const moved = await parseCalendarImport(calendar(event().replace('20261016T140000Z', '20261120T140000Z')), 'moodle', now);
    const timetable = await parseCalendarImport(calendar(event()), 'mystudies', now);
    expect(original.events[0].uid).toBe('sheet-1');
    expect(moved.events[0].key).toBe(original.events[0].key);
    expect(timetable.events[0].key).not.toBe(original.events[0].key);
    expect(original).toMatchObject({ source: 'moodle', previewedAt: now.toISOString() });
  });
  it('retains non-recurring dates outside the old Moodle subscription window', async () => {
    const result = await parseCalendarImport(calendar(event().replace('20261016T140000Z', '20280116T140000Z')), 'moodle', now);
    expect(result.events[0].startAt).toBe('2028-01-16T14:00:00.000Z');
  });
  it('detects exact duplicates without silently choosing between conflicting revisions', async () => {
    const duplicate = await parseCalendarImport(calendar(event(), event()), 'moodle', now);
    expect(duplicate.events).toHaveLength(1); expect(duplicate.duplicateCount).toBe(1);
    const conflict = await parseCalendarImport(calendar(event(), event('DESCRIPTION:Changed content')), 'moodle', now);
    expect(conflict.events).toEqual([]); expect(conflict.warnings.join(' ')).toContain('Conflicting');
  });
  it('interprets floating and all-day dates in Zurich, including across DST', async () => {
    const floating = await parseCalendarImport(calendar(event().replace('20261016T140000Z', '20261025T140000')), 'mystudies', now);
    expect(floating.events[0].startAt).toBe('2026-10-25T13:00:00.000Z');
    const day = await parseCalendarImport(calendar(event().replace('DTSTART:20261016T140000Z', 'DTSTART;VALUE=DATE:20261025\nDTEND;VALUE=DATE:20261026')), 'moodle', now);
    expect(day.events[0]).toMatchObject({ allDay: true, startAt: '2026-10-24T22:00:00.000Z', endAt: '2026-10-25T23:00:00.000Z' });
    expect(day.warnings.join(' ')).toContain('Choose a deadline explicitly');
  });
  it('expands weekly sessions with stable original occurrence identities and exclusions', async () => {
    const recurring = event('RRULE:FREQ=WEEKLY;COUNT=3\nEXDATE:20261023T140000Z');
    const movedOccurrence = event('RECURRENCE-ID:20261030T140000Z').replace('DTSTART:20261016T140000Z', 'DTSTART:20261031T160000Z');
    const before = await parseCalendarImport(calendar(recurring), 'mystudies', now);
    const after = await parseCalendarImport(calendar(recurring, movedOccurrence), 'mystudies', now);
    expect(before.events).toHaveLength(2); expect(after.events).toHaveLength(2);
    const old = before.events.find(item => item.startAt === '2026-10-30T14:00:00.000Z')!;
    expect(after.events.find(item => item.startAt === '2026-10-31T16:00:00.000Z')).toMatchObject({ key: old.key, recurrenceId: old.recurrenceId });
    expect(after.warnings.join(' ')).toContain('365 days');
  });
  it('skips cancelled events and high-frequency series, and keeps source text inert', async () => {
    const result = await parseCalendarImport(calendar(event('STATUS:CANCELLED'), event('RRULE:FREQ=MINUTELY;COUNT=999', 'bad-rule'), event('DESCRIPTION:<script>evil</script>https://moodle.test/?authtoken=secret', 'safe')), 'moodle', now);
    expect(result.events).toHaveLength(1); expect(result.events[0].description).toBe('[private link]');
    expect(result.warnings.join(' ')).toContain('Cancelled'); expect(result.warnings.join(' ')).toContain('high-frequency');
  });
  it('handles empty calendars and rejects malformed, oversized or unsupported-timezone files', async () => {
    expect((await parseCalendarImport(calendar(), 'moodle', now)).events).toEqual([]);
    await expect(parseCalendarImport('not a calendar', 'moodle', now)).rejects.toThrow('valid .ics');
    await expect(parseCalendarImport(calendar('BEGIN:VEVENT'), 'moodle', now)).rejects.toThrow('incomplete');
    await expect(parseCalendarImport('x'.repeat(IMPORT_MAX_BYTES + 1), 'moodle', now)).rejects.toThrow('1 MB');
    await expect(parseCalendarImport(calendar(event().replace('DTSTART:', 'DTSTART;TZID=MadeUp/Zone:')), 'moodle', now)).rejects.toThrow('unsupported timezone');
  });
  it('does not silently normalize impossible dates', async () => {
    const invalid = await parseCalendarImport(calendar(event().replace('20261016T140000Z', '20260230T140000Z')), 'moodle', now);
    expect(invalid.events).toEqual([]); expect(invalid.warnings.join(' ')).toContain('invalid');
  });
  it('warns rather than silently changing nonexistent DST times or losing RDATE occurrences', async () => {
    const gap = event().replace('DTSTART:20261016T140000Z', 'DTSTART:20260329T023000');
    const result = await parseCalendarImport(calendar(gap, event('RDATE:20261023T140000Z', 'extra')), 'moodle', now);
    expect(result.events).toEqual([]);
    expect(result.warnings.join(' ')).toContain('nonexistent'); expect(result.warnings.join(' ')).toContain('RDATE');
  });
  it('parses both reusable synthetic upload fixtures', async () => {
    const moodle = await parseCalendarImport(await readFile(new URL('./fixtures/import-moodle.ics', import.meta.url), 'utf8'), 'moodle', now);
    const timetable = await parseCalendarImport(await readFile(new URL('./fixtures/import-mystudies.ics', import.meta.url), 'utf8'), 'mystudies', now);
    expect(moodle.events).toHaveLength(2); expect(moodle.events[1].allDay).toBe(true);
    expect(timetable.events).toHaveLength(4); expect(new Set(timetable.events.map(item => item.key)).size).toBe(4);
    expect(timetable.warnings.join(' ')).toContain('Floating times');
  });
});
