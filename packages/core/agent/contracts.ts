export const AGENT_MESSAGE_MAX_LENGTH = 4000;
export const AGENT_TOOL_CALL_LIMIT = 8;
export const AGENT_TOOL_NAMES = [
  'moodle_get_calendar_events',
  'moodle_plan_assignment_timeline',
  'moodle_schedule_assignment_timeline',
  'polymate_check_connections',
  'polymate_get_calendar',
  'polymate_create_study_block',
  'polymate_edit_study_block',
  'polymate_move_study_block',
  'polymate_delete_study_blocks',
  'polymate_get_study_progress',
  'polymate_link_study_session',
  'polymate_report_study_progress',
] as const;

export type AgentToolName = typeof AGENT_TOOL_NAMES[number];
export type AgentChatRequest = Readonly<{ message: string }>;
export type AgentToolCard = Readonly<{ name: AgentToolName; result: unknown }>;

export function parseAgentChatRequest(value: unknown): AgentChatRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Send a JSON object.');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => key !== 'message') || typeof body.message !== 'string') throw new Error('Send a message.');
  const message = body.message.trim();
  if (!message) throw new Error('Write a message first.');
  if (message.length > AGENT_MESSAGE_MAX_LENGTH) throw new Error(`Keep messages under ${AGENT_MESSAGE_MAX_LENGTH} characters.`);
  return { message };
}

export function isExplicitCalendarConsent(message: string): boolean {
  if (hasConsentQualifier(message)) return false;
  if (currentPlanApproval(message)?.allowPartial === false) return true;
  return /\b(add|create|put|schedule)\b.{0,80}\b(calendar|blocks?|timeline|study sessions?)\b|\b(add it|add them|schedule it|schedule them)\b.{0,40}\b(calendar|now|please)\b/i.test(message);
}

/** Only complete approval commands may bypass the model; revisions must not apply an old draft. */
export function currentPlanApproval(message: string): { allowPartial: boolean } | null {
  if (hasConsentQualifier(message)) return null;
  const text = message.trim();
  if (/^(?:please\s+)?(?:schedule|add)\s+(?:it|them|(?:this|the)\s+(?:plan|timeline|blocks))(?:\s+to\s+(?:my\s+|the\s+)?calendar)?(?:\s+(?:now|please))?[.!\s]*$/i.test(text)) return { allowPartial: false };
  if (/^(?:please\s+)?(?:schedule|add)\s+only the blocks? that fit(?:\s+to\s+(?:my\s+|the\s+)?calendar)?(?:\s+(?:now|please))?[.!\s]*$/i.test(text)) return { allowPartial: true };
  return null;
}

export function isExplicitPartialConsent(message: string): boolean {
  if (hasConsentQualifier(message)) return false;
  return /\b(add|schedule|include)\b.{0,80}\b(partial|only the blocks? that fit|what fits|feasible blocks?)\b|\bpartial plan\b.{0,40}\b(add|schedule|yes|okay|ok)\b/i.test(message);
}

/** Ambiguous, hypothetical, quoted, or negated requests require the explicit preview action. */
function hasConsentQualifier(message: string): boolean {
  return /\b(no|not|never|don['’]t|dont|do not|without|unless|if|maybe|should|would|could|example|quote|said|says|explain|why|how|when|what|whether|describe|consider)\b|["“”]/i.test(message);
}

export function isExplicitMoveConsent(message: string): boolean {
  return !hasConsentQualifier(message) && /\b(move|reschedule)\b.{0,100}\b(tomorrow|today|to|at|on|block|session|event)\b/i.test(message);
}

export function isExplicitEditConsent(message: string): boolean {
  return isExplicitMoveConsent(message) || (!hasConsentQualifier(message) &&
    /\b(edit|rename|change|update)\b.{0,100}\b(title|name|time|date|block|session|event)\b/i.test(message));
}

export function isExplicitDeleteConsent(message: string): boolean {
  return !hasConsentQualifier(message) &&
    /\b(delete|remove|clear)\b.{0,100}\b(blocks?|sessions?|events?|items?|calendar|it|them|all)\b/i.test(message);
}

export function isAffirmative(message: string): boolean {
  return /^(yes|yes please|go ahead|please do|confirm|confirmed|okay|ok|sure)[.!\s]*$/i.test(message.trim());
}

export function isEmptyRecord(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
}
