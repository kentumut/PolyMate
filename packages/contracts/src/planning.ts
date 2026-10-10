import { ContractError, parseInstant, parseOperationId, type OperationResult, type StudyBlockInput } from './calendar';
import type { Assignment } from './assignments';

export type StudyPreferences = Readonly<{
  weekdays: readonly number[];
  startTime: string;
  endTime: string;
  dailyMinutes: number;
  weeklyMinutes: number;
}>;
export const DEFAULT_STUDY_PREFERENCES: StudyPreferences = {
  weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00', dailyMinutes: 180, weeklyMinutes: 900,
};
export type PlannedBlock = StudyBlockInput & Readonly<{ assignmentId: string; operationId: string }>;
export type StudyPlan = Readonly<{
  id: string;
  createdAt: string;
  expiresAt: string;
  horizon: { from: string; to: string };
  preferences: StudyPreferences;
  blocks: readonly PlannedBlock[];
  unscheduled: readonly { assignmentId: string; title: string; remainingMinutes: number; reason: string }[];
  preservedMinutes: number;
}>;
/** Private server snapshot; the browser applies only the stored plan ID. */
export type StoredStudyPlan = {
  plan: StudyPlan;
  assignments: Assignment[];
  linkedEvents: { assignmentId: string; id: string; etag: string }[];
  approved: boolean;
  results: OperationResult[];
};
export type PlanningState = { preferences: StudyPreferences | null; plan: StudyPlan | null; results: OperationResult[]; warning?: string };
export type PlanningRequest = { action: 'generate'; preferences: StudyPreferences }
  | { action: 'apply'; planId: string; allowPartial: boolean };

export function parseStudyPreferences(value: unknown): StudyPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('Choose study preferences.');
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some(key => !['weekdays', 'startTime', 'endTime', 'dailyMinutes', 'weeklyMinutes'].includes(key))) throw new ContractError('Unsupported study preference.');
  if (!Array.isArray(p.weekdays) || !p.weekdays.length || p.weekdays.length > 7 || p.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)
    || new Set(p.weekdays).size !== p.weekdays.length) throw new ContractError('Choose at least one distinct study day.');
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (typeof p.startTime !== 'string' || typeof p.endTime !== 'string' || !time.test(p.startTime) || !time.test(p.endTime) || p.startTime >= p.endTime) {
    throw new ContractError('Choose a study window that ends after it starts on the same day.');
  }
  if (typeof p.dailyMinutes !== 'number' || !Number.isInteger(p.dailyMinutes) || p.dailyMinutes < 10 || p.dailyMinutes > 1440
    || typeof p.weeklyMinutes !== 'number' || !Number.isInteger(p.weeklyMinutes) || p.weeklyMinutes < 10 || p.weeklyMinutes > 10080) {
    throw new ContractError('Daily capacity must be 10–1440 minutes and weekly capacity 10–10080 minutes.');
  }
  return { weekdays: [...p.weekdays].sort(), startTime: p.startTime, endTime: p.endTime, dailyMinutes: p.dailyMinutes, weeklyMinutes: p.weeklyMinutes };
}

export function parsePlanningRequest(value: unknown): PlanningRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('Send a planning request.');
  const input = value as Record<string, unknown>;
  if (input.action === 'generate' && Object.keys(input).every(key => ['action', 'preferences'].includes(key))) {
    return { action: 'generate', preferences: parseStudyPreferences(input.preferences) };
  }
  if (input.action === 'apply' && typeof input.allowPartial === 'boolean' && Object.keys(input).every(key => ['action', 'planId', 'allowPartial'].includes(key))) {
    return { action: 'apply', planId: parseOperationId(input.planId), allowPartial: input.allowPartial };
  }
  throw new ContractError('Choose Generate Plan or explicitly apply the stored preview.');
}

export function assertPlanCurrent(plan: StudyPlan, now: Date): void {
  if (Date.parse(parseInstant(plan.expiresAt, 'expiresAt')) <= now.getTime()) throw new ContractError('This preview expired. Generate a fresh plan.');
}
