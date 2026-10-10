import { ContractError, parseOperationId } from './calendar';

export const CHECK_IN_KINDS = ['session_follow_up', 'deadline_risk', 'stuck_follow_up', 'assignment', 'course', 'general'] as const;
export type CheckInKind = typeof CHECK_IN_KINDS[number];

/** What a PolyMate-started chat is about. IDs are server-resolved, never model- or client-selected. */
export type CheckInTopic = Readonly<{ assignmentId?: string; courseId?: string; eventId?: string; sessionRevision?: number }>;

export type ChatSummary = Readonly<{
  id: string;
  origin: 'student' | 'check_in';
  checkInKind: CheckInKind | null;
  title: string;
  preview: string;
  unread: boolean;
  /** Suggested answers, offered only until the student has replied. */
  quickReplies: string[];
  createdAt: string;
  updatedAt: string;
}>;

export type StoredChatMessage = Readonly<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }>;
export type ChatList = Readonly<{ chats: ChatSummary[]; checkInsPaused: boolean }>;
export type ChatThread = Readonly<{ chat: ChatSummary; messages: StoredChatMessage[] }>;

export type ChatMutation =
  | Readonly<{ action: 'read'; chatId: string }>
  | Readonly<{ action: 'pause_check_ins'; paused: boolean }>
  | Readonly<{ action: 'check_in_now' }>;

export function parseChatId(value: unknown): string {
  try { return parseOperationId(value); } catch { throw new ContractError('Chat ID is invalid.'); }
}

export function parseChatMutation(value: unknown): ChatMutation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('Send a chat action.');
  const body = value as Record<string, unknown>;
  const only = (...allowed: string[]) => Object.keys(body).every(key => allowed.includes(key));
  if (body.action === 'read' && only('action', 'chatId')) return { action: 'read', chatId: parseChatId(body.chatId) };
  if (body.action === 'pause_check_ins' && only('action', 'paused') && typeof body.paused === 'boolean') return { action: 'pause_check_ins', paused: body.paused };
  if (body.action === 'check_in_now' && only('action')) return { action: 'check_in_now' };
  throw new ContractError('Choose a supported chat action.');
}
