import type { OwnerContext } from '@polymate/core/identity';
import type { CoachMessage, CoachingState, RememberStudentContext, StudentMemory, StudentMemoryCategory } from '@polymate/contracts/coaching';
import { getPool } from './connection';
import { ensureUser } from './google-oauth';

type MemoryRow = { id: string; category: StudentMemoryCategory; content: string; valid_until: Date | null; created_at: Date };
type MessageRow = {
  id: string; kind: CoachMessage['kind']; title: string; body: string; requires_response: boolean;
  status: CoachMessage['status']; week_start: string | Date | null; question_key: string | null;
  created_at: Date; responded_at: Date | null; response_text?: string | null;
};

const WEEKLY_QUESTIONS = [
  { key: 'priorities', title: 'Choose this week’s priorities', body: 'What are the one to three study outcomes that matter most this week?' },
  { key: 'commitments', title: 'Protect your existing plans', body: 'What fixed plans or unavailable times should PolyMate work around this week?' },
  { key: 'capacity', title: 'Set a realistic pace', body: 'How much focused study time feels realistic this week, and are any days unusually demanding?' },
  { key: 'carry-over', title: 'Review unfinished work', body: 'What should carry over from last week, and is anything currently blocked or difficult?' },
] as const;

export class CoachingConflict extends Error {
  constructor(message: string) { super(message); this.name = 'CoachingConflict'; }
}

export function currentZurichWeekStart(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(now).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const localDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  localDate.setUTCDate(localDate.getUTCDate() - ((weekday + 6) % 7));
  return localDate.toISOString().slice(0, 10);
}

function memory(row: MemoryRow): StudentMemory {
  return { id: row.id, category: row.category, content: row.content, validUntil: row.valid_until?.toISOString() ?? null, createdAt: row.created_at.toISOString() };
}

function message(row: MessageRow): CoachMessage {
  const weekStart = row.week_start instanceof Date ? row.week_start.toISOString().slice(0, 10) : row.week_start;
  return { id: row.id, kind: row.kind, title: row.title, body: row.body, requiresResponse: row.requires_response,
    status: row.status, weekStart, questionKey: row.question_key, createdAt: row.created_at.toISOString(), respondedAt: row.responded_at?.toISOString() ?? null };
}

export async function ensureWeeklyCoachMessages(owner: OwnerContext, now = new Date()): Promise<string> {
  await ensureUser(owner);
  const weekStart = currentZurichWeekStart(now);
  for (const question of WEEKLY_QUESTIONS) {
    await getPool().query(
      `INSERT INTO coach_messages (owner_id, kind, title, body, requires_response, week_start, question_key)
       VALUES ($1, 'weekly_question', $2, $3, true, $4::date, $5)
       ON CONFLICT (owner_id, week_start, question_key) DO NOTHING`,
      [owner.userId, question.title, question.body, weekStart, question.key],
    );
  }
  return weekStart;
}

export async function listActiveStudentMemories(ownerId: string): Promise<StudentMemory[]> {
  const result = await getPool().query<MemoryRow>(
    `SELECT id, category, content, valid_until, created_at FROM student_memories
     WHERE owner_id = $1 AND archived_at IS NULL AND (valid_until IS NULL OR valid_until > now())
     ORDER BY updated_at DESC, id LIMIT 60`, [ownerId],
  );
  return result.rows.map(memory);
}

export async function coachingState(owner: OwnerContext, now = new Date()): Promise<CoachingState> {
  const currentWeekStart = await ensureWeeklyCoachMessages(owner, now);
  const [messages, memories] = await Promise.all([
    getPool().query<MessageRow>(
      `SELECT id, kind, title, body, requires_response, status, week_start, question_key, created_at, responded_at
       FROM coach_messages WHERE owner_id = $1
       ORDER BY week_start DESC NULLS LAST,
         CASE question_key WHEN 'priorities' THEN 1 WHEN 'commitments' THEN 2 WHEN 'capacity' THEN 3 WHEN 'carry-over' THEN 4 ELSE 5 END,
         created_at DESC LIMIT 100`, [owner.userId],
    ),
    listActiveStudentMemories(owner.userId),
  ]);
  return { messages: messages.rows.map(message), memories, currentWeekStart };
}

export async function rememberStudentContext(owner: OwnerContext, input: RememberStudentContext): Promise<StudentMemory> {
  await ensureUser(owner);
  const existing = await getPool().query<MemoryRow>(
    `SELECT id, category, content, valid_until, created_at FROM student_memories
     WHERE owner_id = $1 AND archived_at IS NULL AND (valid_until IS NULL OR valid_until > now()) AND lower(content) = lower($2)
     ORDER BY updated_at DESC LIMIT 1`, [owner.userId, input.content],
  );
  if (existing.rows[0]) return memory(existing.rows[0]);
  const result = await getPool().query<MemoryRow>(
    `INSERT INTO student_memories (owner_id, category, content, valid_until)
     VALUES ($1, $2, $3, $4) RETURNING id, category, content, valid_until, created_at`,
    [owner.userId, input.category, input.content, input.validUntil ?? null],
  );
  return memory(result.rows[0]);
}

export async function respondToCoachMessage(owner: OwnerContext, messageId: string, response: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<MessageRow>(
      `SELECT id, kind, title, body, requires_response, status, week_start, question_key, created_at, responded_at, response_text
       FROM coach_messages WHERE owner_id = $1 AND id = $2 FOR UPDATE`, [owner.userId, messageId],
    );
    const row = found.rows[0];
    if (!row || !row.requires_response) throw new CoachingConflict('This coaching message no longer accepts a response.');
    if (row.status === 'responded') {
      if (row.response_text !== response) throw new CoachingConflict('This coaching question already has a different response.');
      await client.query('COMMIT'); return;
    }
    if (row.status === 'dismissed') throw new CoachingConflict('This coaching message was dismissed.');
    await client.query(
      `UPDATE coach_messages SET status = 'responded', response_text = $3, responded_at = now()
       WHERE owner_id = $1 AND id = $2`, [owner.userId, messageId, response],
    );
    const weekStart = row.week_start instanceof Date ? row.week_start.toISOString().slice(0, 10) : row.week_start;
    await client.query(
      `INSERT INTO student_memories (owner_id, category, content)
       VALUES ($1, 'weekly_context', $2)`, [owner.userId, `Week of ${weekStart ?? 'current week'} — ${row.title}: ${response}`],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}

export async function forgetStudentMemory(ownerId: string, memoryId: string): Promise<void> {
  await getPool().query(`UPDATE student_memories SET archived_at = now(), updated_at = now() WHERE owner_id = $1 AND id = $2`, [ownerId, memoryId]);
}
