import { describe, expect, it } from 'vitest';
import { parseCoachingMutation, parseRememberStudentContext } from '../packages/contracts/src/coaching';
import { currentZurichWeekStart } from '../packages/db/src/coaching';

describe('coaching contracts', () => {
  it('finds the Monday of the current Zurich week across a DST boundary', () => {
    expect(currentZurichWeekStart(new Date('2026-10-25T23:30:00Z'))).toBe('2026-10-26');
    expect(currentZurichWeekStart(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-19');
  });

  it('accepts bounded explicit memory and rejects inferred categories', () => {
    expect(parseRememberStudentContext({ category: 'plan', content: 'Dinner Thursday at 19:00.', sourceText: 'dinner Thursday', validUntil: '2026-10-16T00:00:00Z' }))
      .toMatchObject({ category: 'plan', content: 'Dinner Thursday at 19:00.' });
    expect(() => parseRememberStudentContext({ category: 'inference', content: 'Prefers mornings', sourceText: 'probably' })).toThrow('valid memory category');
  });

  it('parses weekly responses and memory removal without extra fields', () => {
    expect(parseCoachingMutation({ action: 'respond', messageId: '11111111-1111-4111-8111-111111111111', response: 'Tuesday evening is unavailable.' }))
      .toMatchObject({ action: 'respond' });
    expect(() => parseCoachingMutation({ action: 'forget', memoryId: '11111111-1111-4111-8111-111111111111', ownerId: 'other' })).toThrow('Choose a coaching');
  });
});
