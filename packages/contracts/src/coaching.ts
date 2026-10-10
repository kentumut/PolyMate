import { ContractError, parseInstant, parseOperationId } from './calendar';

export type StudentMemoryCategory = 'plan' | 'preference' | 'goal' | 'constraint' | 'weekly_context';

export type StudentMemory = Readonly<{
  id: string;
  category: StudentMemoryCategory;
  content: string;
  validUntil: string | null;
  createdAt: string;
}>;

export type CoachMessage = Readonly<{
  id: string;
  kind: 'weekly_question' | 'digest' | 'reminder' | 'follow_up';
  title: string;
  body: string;
  requiresResponse: boolean;
  status: 'unread' | 'read' | 'responded' | 'dismissed';
  weekStart: string | null;
  questionKey: string | null;
  createdAt: string;
  respondedAt: string | null;
}>;

export type CoachingState = Readonly<{
  messages: CoachMessage[];
  memories: StudentMemory[];
  currentWeekStart: string;
}>;

export type RememberStudentContext = Readonly<{
  category: Exclude<StudentMemoryCategory, 'weekly_context'>;
  content: string;
  sourceText: string;
  validUntil?: string;
}>;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('Send a coaching object.');
  return value as Record<string, unknown>;
}

export function parseRememberStudentContext(value: unknown): RememberStudentContext {
  const body = object(value);
  if (Object.keys(body).some(key => !['category', 'content', 'sourceText', 'validUntil'].includes(key))) throw new ContractError('Memory contains unsupported fields.');
  if (typeof body.category !== 'string' || !['plan', 'preference', 'goal', 'constraint'].includes(body.category)) throw new ContractError('Choose a valid memory category.');
  if (typeof body.content !== 'string' || !body.content.trim() || body.content.trim().length > 500) throw new ContractError('Keep remembered context between 1 and 500 characters.');
  if (typeof body.sourceText !== 'string' || body.sourceText.trim().length < 2 || body.sourceText.length > 500) throw new ContractError('Include the student’s exact supporting words.');
  const validUntil = body.validUntil === undefined ? undefined : parseInstant(body.validUntil, 'validUntil');
  return { category: body.category as RememberStudentContext['category'], content: body.content.trim(), sourceText: body.sourceText.trim(), ...(validUntil ? { validUntil } : {}) };
}

export type CoachingMutation =
  | Readonly<{ action: 'respond'; messageId: string; response: string }>
  | Readonly<{ action: 'forget'; memoryId: string }>;

export function parseCoachingMutation(value: unknown): CoachingMutation {
  const body = object(value);
  if (body.action === 'respond' && Object.keys(body).every(key => ['action', 'messageId', 'response'].includes(key))) {
    if (typeof body.response !== 'string' || !body.response.trim() || body.response.trim().length > 2000) throw new ContractError('Write a response of at most 2,000 characters.');
    return { action: 'respond', messageId: parseOperationId(body.messageId), response: body.response.trim() };
  }
  if (body.action === 'forget' && Object.keys(body).every(key => ['action', 'memoryId'].includes(key))) {
    return { action: 'forget', memoryId: parseOperationId(body.memoryId) };
  }
  throw new ContractError('Choose a coaching message response or a memory to forget.');
}
