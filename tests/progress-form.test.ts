import { describe, expect, it } from 'vitest';
import { validateProgressFields } from '../apps/web/components/study/progress-form';
import { progressDraftIsStale } from '../apps/web/components/study/progress-draft';

describe('student progress input validation', () => {
  it('blocks old drafts after assignment updates, moves or ETag-only changes without replacing references', () => {
    const original = Object.freeze({ assignment: 1, session: 2, etag: 'old' });
    expect(progressDraftIsStale(original, { ...original })).toBe(false);
    for (const changed of [{ ...original, assignment: 2 }, { ...original, session: 3 }, { ...original, etag: 'new' }]) expect(progressDraftIsStale(original, changed)).toBe(true);
    expect(original).toEqual({ assignment: 1, session: 2, etag: 'old' });
  });
  it('requires positive whole-assignment effort for partial reports, allowing revised larger estimates', () => {
    for (const minutes of ['', '0', '-1', '1.5', 'NaN']) expect(validateProgressFields({ action: 'partly_done', minutes, finished: false, note: '' }).minutes).toBeTruthy();
    expect(validateProgressFields({ action: 'partly_done', minutes: '500', finished: false, note: '' })).toEqual({});
  });
  it('requires a difficulty note but preserves optional effort', () => {
    expect(validateProgressFields({ action: 'stuck', minutes: '', finished: false, note: '  ' }).note).toBeTruthy();
    expect(validateProgressFields({ action: 'stuck', minutes: '90', finished: false, note: 'Cannot factor the polynomial.' })).toEqual({});
  });
  it('does not infer zero work from Done or alter effort after Missed', () => {
    expect(validateProgressFields({ action: 'done', minutes: '0', finished: false, note: '' }).minutes).toBeTruthy();
    expect(validateProgressFields({ action: 'done', minutes: '0', finished: true, note: '' })).toEqual({});
    expect(validateProgressFields({ action: 'missed', minutes: 'invalid hidden draft value', finished: false, note: '' })).toEqual({});
  });
});
