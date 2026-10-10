import { describe, expect, it } from 'vitest';
import { completionTarget, deletionTarget, existingStudyBlockFields, initialStudyBlockFields, movedEnd, resolveZurichTime, suggestedEnd, validateStudyBlock, type StudyBlockDialogEvent } from '../apps/web/components/study/study-block-form';

describe('study-block form Zurich time conversion', () => {
  it('uses the correct winter and summer offsets', () => {
    expect(resolveZurichTime('2026-01-15', '09:00')).toEqual({ instant: '2026-01-15T08:00:00.000Z' });
    expect(resolveZurichTime('2026-07-15', '09:00')).toEqual({ instant: '2026-07-15T07:00:00.000Z' });
  });

  it('rejects nonexistent and ambiguous daylight-saving times', () => {
    expect(resolveZurichTime('2026-03-29', '02:30')).toEqual({ error: 'nonexistent' });
    expect(resolveZurichTime('2026-10-25', '02:30')).toEqual({ error: 'ambiguous' });
  });

  it('suggests fifty elapsed minutes across midnight and the spring transition', () => {
    expect(suggestedEnd('2026-10-09', '23:40')).toEqual({ date: '2026-10-10', time: '00:30' });
    expect(suggestedEnd('2026-03-29', '01:40')).toEqual({ date: '2026-03-29', time: '03:30' });
  });

  it('prefills a selected instant in Zurich, including a next-day end', () => {
    expect(initialStudyBlockFields('2026-10-09T21:40:00Z')).toEqual({
      title: '', date: '2026-10-09', startTime: '23:40', endDate: '2026-10-10', endTime: '00:30',
    });
    expect(initialStudyBlockFields('not a timestamp').date).toBe('');
  });

  it('prefills the exact range selected by dragging the calendar', () => {
    expect(initialStudyBlockFields('2026-10-09T07:15:00Z', '2026-10-09T08:45:00Z')).toEqual({
      title: '', date: '2026-10-09', startTime: '09:15', endDate: '2026-10-09', endTime: '10:45',
    });
  });
});

describe('editing and moving an existing study block', () => {
  const event: StudyBlockDialogEvent = {
    id: 'block-1', title: 'Attempt questions 1–2', startAt: '2026-10-09T07:00:00Z', endAt: '2026-10-09T08:15:00Z',
    timezone: 'Europe/Zurich', source: 'polymate', editable: true, completion: 'open', etag: '"v1"',
  };

  it('prefills the saved duration rather than resetting it to fifty minutes', () => {
    expect(existingStudyBlockFields(event)).toEqual({
      title: 'Attempt questions 1–2', date: '2026-10-09', startTime: '09:00', endDate: '2026-10-09', endTime: '10:15',
    });
    expect(validateStudyBlock(existingStudyBlockFields(event)).input).toMatchObject({
      startAt: '2026-10-09T07:00:00.000Z', endAt: '2026-10-09T08:15:00.000Z',
    });
  });

  it('moves a seventy-five-minute block across midnight without shortening it', () => {
    expect(movedEnd(existingStudyBlockFields(event), '2026-10-10', '23:30')).toEqual({ date: '2026-10-11', time: '00:45' });
  });

  it('preserves elapsed duration across the spring clock change', () => {
    expect(movedEnd(existingStudyBlockFields(event), '2026-03-29', '01:30')).toEqual({ date: '2026-03-29', time: '03:45' });
  });

  it('does not invent an end for an ambiguous or invalid new start', () => {
    const fields = existingStudyBlockFields(event);
    expect(movedEnd(fields, '2026-10-25', '02:30')).toBeNull();
    expect(movedEnd(fields, '2026-02-30', '09:00')).toBeNull();
    expect(movedEnd({ ...fields, endTime: '08:00' }, '2026-10-10', '09:00')).toBeNull();
  });
});

describe('study-block form validation', () => {
  const valid = { title: '  Attempt questions 1–2  ', date: '2026-10-09', startTime: '09:00', endDate: '2026-10-09', endTime: '09:50' };

  it('trims the task and sends ISO instants rather than wall-clock strings', () => {
    expect(validateStudyBlock(valid)).toEqual({ input: {
      title: 'Attempt questions 1–2', startAt: '2026-10-09T07:00:00.000Z', endAt: '2026-10-09T07:50:00.000Z', timezone: 'Europe/Zurich',
    } });
  });

  it('rejects blank titles, impossible dates, and invalid times', () => {
    const result = validateStudyBlock({ ...valid, title: '  ', date: '2026-02-30', startTime: '25:00', endTime: '' });
    expect(result.errors).toMatchObject({ title: expect.any(String), date: expect.any(String), startTime: expect.any(String), endTime: expect.any(String) });
    expect(result.input).toBeUndefined();
  });

  it('rejects zero-length and reversed ranges but permits explicit next-day ends', () => {
    expect(validateStudyBlock({ ...valid, endTime: '09:00' }).errors?.endTime).toBeDefined();
    expect(validateStudyBlock({ ...valid, endTime: '08:00' }).errors?.endTime).toBeDefined();
    expect(validateStudyBlock({ ...valid, startTime: '23:40', endDate: '2026-10-10', endTime: '00:30' }).input).toBeDefined();
  });

  it('does not submit an ambiguous end time', () => {
    const result = validateStudyBlock({ ...valid, date: '2026-10-25', startTime: '01:50', endDate: '2026-10-25', endTime: '02:40' });
    expect(result.errors?.endTime).toContain('occurs twice');
    expect(result.input).toBeUndefined();
  });

  it('uses the server duration and title limits before submitting', () => {
    expect(validateStudyBlock({ ...valid, endTime: '09:05' }).errors?.endTime).toContain('at least 10 minutes');
    expect(validateStudyBlock({ ...valid, endTime: '18:00' }).errors?.endTime).toContain('at most 8 hours');
    expect(validateStudyBlock({ ...valid, title: 'x'.repeat(201) }).errors?.title).toBeDefined();
  });
});

describe('Mark done targets and permissions', () => {
  const saved: StudyBlockDialogEvent = {
    id: 'block-1', title: 'Saved title', startAt: '2026-10-09T07:00:00Z', endAt: '2026-10-09T08:15:00Z',
    timezone: 'Europe/Zurich', source: 'polymate', editable: true, completion: 'open', etag: '"loaded-v1"',
  };

  it('keeps the loaded ETag after a refresh rather than silently authorizing newer data', () => {
    expect(completionTarget(saved, { ...saved, etag: '"refreshed-v2"' })).toEqual({ eventId: 'block-1', expectedEtag: '"loaded-v1"' });
  });

  it('does not permit repeated completion, including completion reported by a refresh', () => {
    expect(completionTarget({ ...saved, completion: 'done' }, saved)).toBeNull();
    expect(completionTarget(saved, { ...saved, completion: 'done' })).toBeNull();
  });

  it('rejects personal or non-editable events on either side of the saved snapshot', () => {
    for (const protectedEvent of [{ ...saved, source: 'google-personal' as const }, { ...saved, editable: false }]) {
      expect(completionTarget(protectedEvent, saved)).toBeNull();
      expect(completionTarget(saved, protectedEvent)).toBeNull();
    }
  });

  it('requires a saved event, matching current selection, and an expected ETag', () => {
    expect(completionTarget(null, saved)).toBeNull();
    expect(completionTarget(saved, null)).toBeNull();
    expect(completionTarget(saved, { ...saved, id: 'another-block' })).toBeNull();
    expect(completionTarget({ ...saved, etag: '' }, saved)).toBeNull();
  });
});

describe('deletion targets and permissions', () => {
  const saved: StudyBlockDialogEvent = {
    id: 'block-1', title: 'Saved title', startAt: '2026-10-09T07:00:00Z', endAt: '2026-10-09T08:15:00Z',
    timezone: 'Europe/Zurich', source: 'polymate', editable: true, completion: 'done', etag: '"loaded-v1"',
  };

  it('allows deleting a completed block with its saved version, independent of refreshed titles/times', () => {
    expect(deletionTarget(saved, { ...saved, title: 'Changed elsewhere', startAt: '2026-10-09T09:00:00Z', etag: '"v2"' }))
      .toEqual({ eventId: 'block-1', expectedEtag: '"loaded-v1"' });
  });

  it('rejects personal or non-editable events before and after a refresh', () => {
    for (const protectedEvent of [{ ...saved, source: 'google-personal' as const }, { ...saved, editable: false }]) {
      expect(deletionTarget(protectedEvent, saved)).toBeNull();
      expect(deletionTarget(saved, protectedEvent)).toBeNull();
    }
  });

  it('cannot target a new block, a different selection, or an unversioned event', () => {
    expect(deletionTarget(null, saved)).toBeNull();
    expect(deletionTarget(saved, null)).toBeNull();
    expect(deletionTarget(saved, { ...saved, id: 'another-block' })).toBeNull();
    expect(deletionTarget({ ...saved, etag: '' }, saved)).toBeNull();
  });
});
