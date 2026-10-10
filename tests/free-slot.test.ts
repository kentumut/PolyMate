import { describe, expect, it } from 'vitest';
import { findFreeSlot } from '../packages/core/scheduling/free-slot';

const at = (iso: string) => new Date(iso);
const HOUR = 3_600_000;

describe('findFreeSlot', () => {
  it('moves past a busy event to the next gap that fits', () => {
    // 2026-11-02 is CET (UTC+1): 08:00–22:00 Zurich is 07:00–21:00 UTC.
    const slot = findFreeSlot({ durationMs: 4 * HOUR, notBefore: at('2026-11-02T07:00:00Z'), notAfter: at('2026-11-10T00:00:00Z'),
      busy: [{ startAt: '2026-11-02T09:00:00Z', endAt: '2026-11-02T11:00:00Z' }] });
    expect(slot).toEqual({ startAt: '2026-11-02T11:00:00.000Z', endAt: '2026-11-02T15:00:00.000Z' });
  });
  it('rolls over to the next morning when the day is full', () => {
    const slot = findFreeSlot({ durationMs: 4 * HOUR, notBefore: at('2026-11-02T07:00:00Z'), notAfter: at('2026-11-10T00:00:00Z'),
      busy: [{ startAt: '2026-11-02T07:00:00Z', endAt: '2026-11-02T20:00:00Z' }] });
    expect(slot?.startAt).toBe('2026-11-03T07:00:00.000Z');
  });
  it('returns null when nothing fits in range or the block is longer than a day window', () => {
    expect(findFreeSlot({ durationMs: 15 * HOUR, notBefore: at('2026-11-02T07:00:00Z'), notAfter: at('2026-11-10T00:00:00Z'), busy: [] })).toBeNull();
    expect(findFreeSlot({ durationMs: 4 * HOUR, notBefore: at('2026-11-02T07:00:00Z'), notAfter: at('2026-11-02T12:00:00Z'),
      busy: [{ startAt: '2026-11-02T07:00:00Z', endAt: '2026-11-02T10:00:00Z' }] })).toBeNull();
  });
});
