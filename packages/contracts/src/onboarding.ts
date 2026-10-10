import { ContractError } from './calendar';

export type OnboardingGoal = 'deadline' | 'exam' | 'balance';
export type OnboardingSessionMinutes = 30 | 50;
export type OnboardingCoachCadence = 'proactive' | 'weekly';

export type OnboardingProfile = Readonly<{
  goal: OnboardingGoal;
  sessionMinutes: OnboardingSessionMinutes;
  coachCadence: OnboardingCoachCadence;
}>;

export type OnboardingState = Readonly<{
  completed: boolean;
  profile: OnboardingProfile | null;
}>;

export function parseOnboardingProfile(value: unknown): OnboardingProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('Choose your onboarding preferences.');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['goal', 'sessionMinutes', 'coachCadence'].includes(key))) throw new ContractError('Onboarding contains unsupported fields.');
  if (body.goal !== 'deadline' && body.goal !== 'exam' && body.goal !== 'balance') throw new ContractError('Choose what PolyMate should optimize for.');
  if (body.sessionMinutes !== 30 && body.sessionMinutes !== 50) throw new ContractError('Choose a 30- or 50-minute focus rhythm.');
  if (body.coachCadence !== 'proactive' && body.coachCadence !== 'weekly') throw new ContractError('Choose a coaching style.');
  return { goal: body.goal, sessionMinutes: body.sessionMinutes, coachCadence: body.coachCadence };
}
