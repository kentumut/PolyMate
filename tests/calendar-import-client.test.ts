import { describe, expect, it, vi } from 'vitest';
import { parseCalendarImport } from '../packages/core/calendar/import';
import { createImportFixtureAdapter, importAssignmentFields, prepareImportSelections, previewImport, validateImportFile, type ImportConfirmation } from '../apps/web/components/study/calendar-import-client';

const raw = 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:all-day\nDTSTART;VALUE=DATE:20261020\nSUMMARY:Review\nEND:VEVENT\nEND:VCALENDAR';
async function selection() {
  const preview = await parseCalendarImport(raw, 'moodle', new Date('2026-10-10T08:00:00Z'));
  const event = preview.events[0];
  return { event, input: { title: 'Review', dueAt: '2026-10-20T15:00:00.000Z', estimatedMinutes: 120 } };
}
describe('file-to-review preparation and fixture confirmation', () => {
  it('rejects non-ICS, empty and oversized files before any HTTP request', () => {
    expect(() => validateImportFile({ name: 'calendar.txt', size: 50 })).toThrow('.ics');
    expect(() => validateImportFile({ name: 'calendar.ics', size: 0 })).toThrow('empty');
    expect(() => validateImportFile({ name: 'calendar.ics', size: 1_000_001 })).toThrow('1 MB');
  });
  it('requires explicit effort and a deadline time for selected all-day events', async () => {
    const { event } = await selection();
    const fields = importAssignmentFields(event);
    expect(fields.time).toBe(''); expect(fields.estimatedMinutes).toBe('');
    const invalid = prepareImportSelections([event], new Set([event.key]), { [event.key]: fields });
    expect(invalid.selections).toEqual([]); expect(invalid.errors[event.key]).toContain('deadline time');
    expect(prepareImportSelections([event], new Set(), { [event.key]: fields })).toEqual({ selections: [], errors: {} });
    expect(prepareImportSelections([event], new Set([event.key]), { [event.key]: { ...fields, time: '17:00', estimatedMinutes: '120' } }).selections[0].input.dueAt).toBe('2026-10-20T15:00:00.000Z');
  });
  it('recovers a lost fixture reply with the same ID without applying twice', async () => {
    const adapter = createImportFixtureAdapter();
    const request: ImportConfirmation = { requestId: 'original', source: 'moodle', selections: [await selection()] };
    await expect(adapter.confirm(request, 'unknown')).rejects.toMatchObject({ kind: 'unknown' });
    await expect(adapter.confirm({ ...request, selections: [] }, 'success')).rejects.toMatchObject({ kind: 'conflict' });
    const recovered = await adapter.confirm(request, 'unknown');
    expect(recovered).toMatchObject({ requestId: 'original', created: 1, updated: 0, fixture: true });
    const reimported = await adapter.confirm({ ...request, requestId: 'reimport' }, 'success');
    expect(reimported).toMatchObject({ created: 0, unchanged: 1 });
    const moved = { ...request.selections[0], input: { ...request.selections[0].input, dueAt: '2026-10-21T15:00:00.000Z' } };
    expect(await adapter.confirm({ ...request, requestId: 'changed', selections: [moved] }, 'success')).toMatchObject({ created: 0, updated: 1 });
  });
  it('failure and conflict leave the request unchanged and create no fixture rows', async () => {
    const adapter = createImportFixtureAdapter(); const request = { requestId: 'retry', source: 'moodle' as const, selections: [await selection()] };
    const before = JSON.stringify(request);
    for (const outcome of ['failure', 'conflict'] as const) await expect(adapter.confirm(request, outcome)).rejects.toMatchObject({ kind: outcome });
    expect(JSON.stringify(request)).toBe(before);
    expect(await adapter.confirm(request, 'success')).toMatchObject({ created: 1 });
  });
  it('prevents concurrent confirmations during slow saves', async () => {
    const adapter = createImportFixtureAdapter(); const request = { requestId: 'slow', source: 'moodle' as const, selections: [await selection()] };
    vi.useFakeTimers();
    try {
      const pending = adapter.confirm(request, 'slow');
      await expect(adapter.confirm(request, 'success')).rejects.toThrow('already running');
      await vi.advanceTimersByTimeAsync(1200); expect(await pending).toMatchObject({ created: 1 });
    } finally { vi.useRealTimers(); }
  });
  it('uploads only to the preview endpoint and propagates errors without confirmation writes', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: 'nonce' })).mockResolvedValueOnce(Response.json({ error: { message: 'Unreadable calendar.' } }, { status: 422 }));
    vi.stubGlobal('fetch', fetcher);
    try {
      await expect(previewImport(new File([raw], 'calendar.ics'), 'moodle')).rejects.toThrow('Unreadable calendar');
      expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/assignments/csrf', '/api/assignments/import/preview?source=moodle']);
      expect(fetcher.mock.calls[1][1].headers).toMatchObject({ 'x-csrf-token': 'nonce', 'Content-Type': 'text/calendar' });
    } finally { vi.unstubAllGlobals(); }
  });
});
