import type { ChatList, ChatMutation, ChatSummary, ChatThread } from '@polymate/contracts/chats';

type Problem = { error?: { message?: string } };
export type ChatListResult = ChatList & { openedChatId?: string | null };

async function read<T>(response: Response, fallback: string): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & Problem;
  if (!response.ok) throw new Error(body.error?.message ?? fallback);
  return body;
}

export async function fetchChats(fetchImpl: typeof fetch = fetch): Promise<ChatList> {
  return read(await fetchImpl('/api/chats', { credentials: 'same-origin', cache: 'no-store' }), 'Chats could not be loaded.');
}

export async function fetchChat(chatId: string, fetchImpl: typeof fetch = fetch): Promise<ChatThread> {
  return read(await fetchImpl(`/api/chats/${encodeURIComponent(chatId)}`, { credentials: 'same-origin', cache: 'no-store' }), 'This chat could not be opened.');
}

export async function mutateChats(mutation: ChatMutation, fetchImpl: typeof fetch = fetch): Promise<ChatListResult> {
  return read(await fetchImpl('/api/chats', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mutation) }), 'That chat action could not be saved.');
}

/** Check-in chats PolyMate started that the student has not opened, newest first. */
export function unreadCheckIns(chats: readonly ChatSummary[], activeChatId?: string): ChatSummary[] {
  return chats.filter(chat => chat.unread && chat.origin === 'check_in' && chat.id !== activeChatId);
}
