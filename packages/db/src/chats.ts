import { randomUUID } from 'node:crypto';
import { chatPreviewText, type ChatSummary, type ChatThread, type CheckInKind, type StoredChatMessage } from '@polymate/contracts/chats';
import type { CheckInChannelId, CheckInStore, DeliveryOutcome } from '@polymate/core/checkins';
import type { OwnerContext } from '@polymate/core/identity';
import { getPool } from './connection';
import { listCourses } from './courses';
import { ensureUser } from './google-oauth';
import { studyProgressStore } from './study-progress';

type ChatRow = {
  id: string; origin: ChatSummary['origin']; check_in_kind: CheckInKind | null; title: string; quick_replies: string[];
  read_at: Date | null; created_at: Date; updated_at: Date; preview: string | null; replied: boolean;
};
type MessageRow = { id: string; role: StoredChatMessage['role']; content: string; created_at: Date };

const CHAT_MESSAGE_MAX = 8000;
const summaryColumns = `c.id, c.origin, c.check_in_kind, c.title, c.quick_replies, c.read_at, c.created_at, c.updated_at,
  (SELECT content FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS preview,
  EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS replied`;

export class ChatNotFound extends Error {
  constructor() { super('This chat no longer exists.'); this.name = 'ChatNotFound'; }
}

function summary(row: ChatRow): ChatSummary {
  return { id: row.id, origin: row.origin, checkInKind: row.check_in_kind, title: row.title, preview: chatPreviewText(row.preview ?? ''),
    unread: row.origin === 'check_in' && !row.read_at, quickReplies: row.replied ? [] : row.quick_replies,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}

/** Chats with at least one message, newest activity first. */
export async function listChats(ownerId: string): Promise<ChatSummary[]> {
  const result = await getPool().query<ChatRow>(
    `SELECT ${summaryColumns} FROM chat_conversations c
     WHERE c.owner_id = $1 AND EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id)
     ORDER BY c.updated_at DESC, c.id LIMIT 30`, [ownerId],
  );
  return result.rows.map(summary);
}

export async function getChat(ownerId: string, chatId: string): Promise<ChatThread> {
  const [chat, messages] = await Promise.all([
    getPool().query<ChatRow>(`SELECT ${summaryColumns} FROM chat_conversations c WHERE c.owner_id = $1 AND c.id = $2`, [ownerId, chatId]),
    getPool().query<MessageRow>(
      `SELECT id, role, content, created_at FROM (
         SELECT id, role, content, created_at FROM chat_messages WHERE owner_id = $1 AND conversation_id = $2 ORDER BY id DESC LIMIT 40
       ) recent ORDER BY id`, [ownerId, chatId],
    ),
  ]);
  if (!chat.rows[0]) throw new ChatNotFound();
  return { chat: summary(chat.rows[0]), messages: messages.rows.map(row => ({ id: String(row.id), role: row.role, content: row.content, createdAt: row.created_at.toISOString() })) };
}

/**
 * Makes sure the student's chat exists, then returns what the agent needs for the next turn.
 * A chat ID that belongs to another student is reported as missing.
 */
export async function chatTurnContext(owner: OwnerContext, chatId: string, title: string): Promise<{ history: Array<{ role: 'user' | 'assistant'; content: string }>; agentContext: string | null }> {
  await ensureUser(owner);
  await getPool().query(
    `INSERT INTO chat_conversations (id, owner_id, origin, title, read_at) VALUES ($1, $2, 'student', $3, now()) ON CONFLICT (id) DO NOTHING`,
    [chatId, owner.userId, title.replace(/\s+/g, ' ').trim().slice(0, 120) || 'New chat'],
  );
  const chat = await getPool().query<{ agent_context: string | null }>(`SELECT agent_context FROM chat_conversations WHERE owner_id = $1 AND id = $2`, [owner.userId, chatId]);
  if (!chat.rows[0]) throw new ChatNotFound();
  const history = await getPool().query<MessageRow>(
    `SELECT id, role, content, created_at FROM (
       SELECT id, role, content, created_at FROM chat_messages WHERE owner_id = $1 AND conversation_id = $2 ORDER BY id DESC LIMIT 12
     ) recent ORDER BY id`, [owner.userId, chatId],
  );
  return { history: history.rows.map(row => ({ role: row.role, content: row.content })), agentContext: chat.rows[0].agent_context };
}

/** Stores a finished exchange. Replying also marks the chat as read. */
export async function appendChatMessages(ownerId: string, chatId: string, messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>): Promise<void> {
  const kept = messages.map(item => ({ role: item.role, content: item.content.trim().slice(0, CHAT_MESSAGE_MAX) })).filter(item => item.content);
  if (!kept.length) return;
  await getPool().query(
    `WITH touched AS (
       UPDATE chat_conversations SET updated_at = now(), read_at = COALESCE(read_at, now()) WHERE owner_id = $1 AND id = $2 RETURNING id, owner_id
     )
     INSERT INTO chat_messages (conversation_id, owner_id, role, content)
     SELECT touched.id, touched.owner_id, item.role, item.content
     FROM touched, unnest($3::text[], $4::text[]) WITH ORDINALITY AS item(role, content, position) ORDER BY item.position`,
    [ownerId, chatId, kept.map(item => item.role), kept.map(item => item.content)],
  );
}

export async function markChatRead(ownerId: string, chatId: string): Promise<void> {
  await getPool().query(`UPDATE chat_conversations SET read_at = COALESCE(read_at, now()) WHERE owner_id = $1 AND id = $2`, [ownerId, chatId]);
}

export async function checkInsPaused(ownerId: string): Promise<boolean> {
  const result = await getPool().query<{ paused: boolean }>(`SELECT paused FROM check_in_preferences WHERE owner_id = $1`, [ownerId]);
  return result.rows[0]?.paused ?? false;
}

export async function setCheckInsPaused(owner: OwnerContext, paused: boolean): Promise<void> {
  await ensureUser(owner);
  await getPool().query(
    `INSERT INTO check_in_preferences (owner_id, paused) VALUES ($1, $2)
     ON CONFLICT (owner_id) DO UPDATE SET paused = EXCLUDED.paused, updated_at = now()`, [owner.userId, paused],
  );
}

/** Students known to PolyMate, for the timer that checks in while the app is closed. */
export async function listCheckInOwnerIds(limit = 500): Promise<string[]> {
  const result = await getPool().query<{ id: string }>(`SELECT id FROM users ORDER BY id LIMIT $1`, [limit]);
  return result.rows.map(row => row.id);
}

export const checkInStore: CheckInStore = {
  async snapshot(ownerId, now) {
    const [progress, courses, prior, lastMessage, paused] = await Promise.all([
      studyProgressStore.state(ownerId),
      listCourses(ownerId),
      getPool().query<{ dedupe_key: string; check_in_kind: CheckInKind; created_at: Date }>(
        `SELECT dedupe_key, check_in_kind, created_at FROM chat_conversations
         WHERE owner_id = $1 AND origin = 'check_in' AND created_at > $2 ORDER BY created_at DESC LIMIT 200`,
        [ownerId, new Date(now.getTime() - 14 * 24 * 60 * 60_000)],
      ),
      getPool().query<{ created_at: Date | null }>(`SELECT max(created_at) AS created_at FROM chat_messages WHERE owner_id = $1 AND role = 'user'`, [ownerId]),
      checkInsPaused(ownerId),
    ]);
    return {
      assignments: progress.assignments, links: progress.links, reports: progress.reports,
      courses: courses.map(course => ({ id: course.id, name: course.name, examDate: course.examDate })),
      prior: prior.rows.map(row => ({ dedupeKey: row.dedupe_key, kind: row.check_in_kind, createdAt: row.created_at.toISOString() })),
      lastStudentMessageAt: lastMessage.rows[0]?.created_at?.toISOString() ?? null, paused,
    };
  },
  async open(ownerId, draft) {
    // One statement: the chat and its opening question are stored together or not at all.
    const result = await getPool().query<{ conversation_id: string }>(
      `WITH opened AS (
         INSERT INTO chat_conversations (id, owner_id, origin, title, check_in_kind, dedupe_key, topic, quick_replies, agent_context)
         VALUES ($1, $2, 'check_in', $3, $4, $5, $6, $7, $8)
         ON CONFLICT (owner_id, dedupe_key) DO NOTHING RETURNING id, owner_id
       )
       INSERT INTO chat_messages (conversation_id, owner_id, role, content)
       SELECT id, owner_id, 'assistant', $9 FROM opened RETURNING conversation_id`,
      [randomUUID(), ownerId, draft.title, draft.kind, draft.dedupeKey, JSON.stringify(draft.topic), draft.quickReplies, draft.agentContext.slice(0, 2000), draft.body],
    );
    return result.rows[0]?.conversation_id ?? null;
  },
  async recordDelivery(ownerId, chatId, channel: CheckInChannelId, outcome: DeliveryOutcome) {
    await getPool().query(
      `INSERT INTO chat_deliveries (conversation_id, owner_id, channel, status, external_id) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (conversation_id, channel) DO NOTHING`, [chatId, ownerId, channel, outcome.status, outcome.externalId ?? null],
    );
  },
};
