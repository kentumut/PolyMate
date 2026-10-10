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

/**
 * One-line plain text for chat lists and notices. Assistant replies are Markdown, which the list
 * shows as raw text, so links keep their label and emphasis, headings, bullets, and code fences drop away.
 */
export function chatPreviewText(markdown: string, max = 200): string {
  const text = markdown
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w_])_(?!\s)([^_\n]+?)_(?!\w)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

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
