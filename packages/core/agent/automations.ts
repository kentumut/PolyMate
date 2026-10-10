import type { OwnerContext } from '../src/identity';

export type AutomationSchedule = Readonly<{ expression: string; timezone: 'Europe/Zurich' }>;
export type AutomationSpec = Readonly<{
  key: string;
  name: string;
  schedule: AutomationSchedule;
  prompt: string;
  tools: readonly ('moodle_get_calendar_events' | 'polymate_check_connections')[];
}>;
export type RegisteredAutomation = Readonly<{ id: string; key: string; name: string }>;

/** Shared server-side contract used by Moodle monitoring and progress check-ins. */
export interface AutomationScheduler {
  register(owner: OwnerContext, spec: AutomationSpec): Promise<RegisteredAutomation>;
  cancel(owner: OwnerContext, registrationId: string): Promise<void>;
}

export function validateAutomationSpec(spec: AutomationSpec): void {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(spec.key)) throw new Error('Automation key is invalid.');
  if (!spec.name.trim() || spec.name.length > 100 || /[\u0000-\u001f\u007f]/.test(spec.name)) throw new Error('Automation name is invalid.');
  if (spec.schedule.timezone !== 'Europe/Zurich' || !/^[0-9*/,-]+\s+[0-9*/,-]+\s+[0-9*/,-]+\s+[0-9*/,-]+\s+[0-9*/,-]+$/.test(spec.schedule.expression)) {
    throw new Error('Use a five-field cron expression in Europe/Zurich.');
  }
  if (!spec.prompt.trim() || spec.prompt.length > 1200 || /[\u0000]/.test(spec.prompt)) throw new Error('Automation prompt is invalid.');
  if (!spec.tools.length || spec.tools.length > 4 || new Set(spec.tools).size !== spec.tools.length || spec.tools.some(tool => !['moodle_get_calendar_events', 'polymate_check_connections'].includes(tool))) {
    throw new Error('Automation tool is not allowlisted.');
  }
}
