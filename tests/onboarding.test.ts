import { describe, expect, it } from 'vitest';
import { parseOnboardingProfile } from '../packages/contracts/src/onboarding';

describe('student onboarding contract', () => {
  it('accepts the supported onboarding choices', () => {
    expect(parseOnboardingProfile({ goal: 'exam', sessionMinutes: 50, coachCadence: 'proactive' }))
      .toEqual({ goal: 'exam', sessionMinutes: 50, coachCadence: 'proactive' });
  });

  it('rejects unsupported or extra choices', () => {
    expect(() => parseOnboardingProfile({ goal: 'grades', sessionMinutes: 50, coachCadence: 'proactive' })).toThrow();
    expect(() => parseOnboardingProfile({ goal: 'exam', sessionMinutes: 45, coachCadence: 'weekly' })).toThrow();
    expect(() => parseOnboardingProfile({ goal: 'exam', sessionMinutes: 50, coachCadence: 'weekly', admin: true })).toThrow();
  });
});
