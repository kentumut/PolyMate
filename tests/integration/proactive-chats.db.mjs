import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssignment } from '../../packages/db/src/assignments.ts';
import { ChatNotFound, appendChatMessages, chatTurnContext, checkInStore, checkInsPaused, getChat, listChats, listCheckInOwnerIds, markChatRead, setCheckInsPaused } from '../../packages/db/src/chats.ts';
import { runCheckIns, webCheckInChannel } from '../../packages/core/checkins/service.ts';

// Optional SQL/restart check, using the same external PGlite setup as study-progress.db.mjs.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const { pgcrypto } = await import(process.env.PGCRYPTO_MODULE || '@electric-sql/pglite/contrib/pgcrypto');
const directory = await mkdtemp(join(tmpdir(), 'polymate-chats-'));
let db = new PGlite({ dataDir: directory, extensions: { pgcrypto } });
process.env.DATABASE_URL = 'postgresql://isolated-test-adapter';
const query = async (sql, params) => {
  const result = await db.query(sql, params);
  return { rows: result.rows, rowCount: /^\s*SELECT/i.test(sql) ? result.rows.length : result.affectedRows ?? result.rows.length };
};
globalThis.polymatePool = { query, async connect() { return { query, release() {} }; } };
const owner = { userId: crypto.randomUUID(), externalId: 'student@example.test', displayName: 'Student' };
const other = { userId: crypto.randomUUID(), externalId: 'other@example.test', displayName: 'Other' };
// Saturday 10 October 2026, 15:00 in Zurich.
const now = new Date('2026-10-10T13:00:00Z');
const run = (student, at = now, options) => runCheckIns(student.userId, checkInStore, [webCheckInChannel], at, options);

try {
  const migrations = new URL('../../packages/db/migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    await db.exec(await readFile(new URL(file, migrations), 'utf8'));
  }
  // An assignment due tomorrow with nothing planned is the most pressing question.
  const assignment = (await createAssignment(owner, { title: 'Analysis Serie 4', dueAt: '2026-10-11T16:00:00Z', estimatedMinutes: 150, clientRequestId: crypto.randomUUID() })).assignment;
  await createAssignment(other, { title: 'Other work', dueAt: '2026-10-20T16:00:00Z', estimatedMinutes: 60, clientRequestId: crypto.randomUUID() });

  const [opened] = await run(owner);
  assert.equal(opened.draft.kind, 'deadline_risk');
  assert.deepEqual(opened.draft.topic, { assignmentId: assignment.id });
  // Concurrent and repeated runs never ask the same question twice.
  assert.deepEqual(await Promise.all([run(owner), run(owner)]), [[], []]);
  assert.equal(await checkInStore.open(owner.userId, opened.draft), null);

  let chats = await listChats(owner.userId);
  assert.equal(chats.length, 1);
  assert.deepEqual({ id: chats[0].id, origin: chats[0].origin, kind: chats[0].checkInKind, unread: chats[0].unread, replies: chats[0].quickReplies.length },
    { id: opened.chatId, origin: 'check_in', kind: 'deadline_risk', unread: true, replies: 3 });
  assert.match(chats[0].preview, /is due tomorrow at 18:00/);
  assert.deepEqual((await db.query('SELECT channel, status FROM chat_deliveries WHERE conversation_id = $1', [opened.chatId])).rows, [{ channel: 'web', status: 'sent' }]);

  // The minimum gap holds the next question back until an hour has passed since the last one.
  await db.query(`UPDATE chat_conversations SET created_at = $2 WHERE id = $1`, [opened.chatId, new Date('2026-10-10T12:30:00Z')]);
  assert.deepEqual(await run(owner), []);
  await db.query(`UPDATE chat_conversations SET created_at = $2 WHERE id = $1`, [opened.chatId, new Date('2026-10-10T11:30:00Z')]);
  assert.deepEqual((await run(owner)).map(item => item.draft.kind), ['general']);

  // Students never see each other's chats.
  assert.deepEqual(await listChats(other.userId), []);
  await assert.rejects(getChat(other.userId, opened.chatId), ChatNotFound);
  await assert.rejects(chatTurnContext(other, opened.chatId, 'Hello'), ChatNotFound);
  await appendChatMessages(other.userId, opened.chatId, [{ role: 'user', content: 'Not mine' }]);
  await markChatRead(other.userId, opened.chatId);
  assert.equal((await getChat(owner.userId, opened.chatId)).messages.length, 1);
  assert.equal((await listChats(owner.userId))[0].unread, true);

  // Replying uses the stored opening question as history, marks the chat read and retires the suggestions.
  const turn = await chatTurnContext(owner, opened.chatId, 'ignored for an existing chat');
  assert.equal(turn.history.length, 1);
  assert.equal(turn.history[0].role, 'assistant');
  assert.match(turn.agentContext, new RegExp(assignment.id));
  await appendChatMessages(owner.userId, opened.chatId, [{ role: 'user', content: 'Yes, find me a slot' }, { role: 'assistant', content: 'Tomorrow at 09:00 is free.' }, { role: 'assistant', content: '   ' }]);
  const thread = await getChat(owner.userId, opened.chatId);
  assert.deepEqual(thread.messages.map(item => item.role), ['assistant', 'user', 'assistant']);
  assert.deepEqual({ unread: thread.chat.unread, replies: thread.chat.quickReplies, title: thread.chat.title }, { unread: false, replies: [], title: 'No time planned for Analysis Serie 4' });
  assert.equal(thread.chat.preview, 'Tomorrow at 09:00 is free.');

  // A student-started chat is created on first use, hidden while empty, and keeps only its latest turns as history.
  const studentChat = crypto.randomUUID();
  assert.deepEqual(await chatTurnContext(owner, studentChat, '  Plan   my week\nplease  '), { history: [], agentContext: null });
  assert.equal((await listChats(owner.userId)).length, 2);
  for (let index = 0; index < 8; index += 1) await appendChatMessages(owner.userId, studentChat, [{ role: 'user', content: `Question ${index}` }, { role: 'assistant', content: `Answer ${index}` }]);
  chats = await listChats(owner.userId);
  assert.deepEqual(chats.map(chat => chat.id).slice(0, 2), [studentChat, opened.chatId]);
  assert.deepEqual({ title: chats[0].title, origin: chats[0].origin, unread: chats[0].unread }, { title: 'Plan my week please', origin: 'student', unread: false });
  const history = (await chatTurnContext(owner, studentChat, 'later')).history;
  assert.equal(history.length, 12);
  assert.deepEqual([history[0].content, history.at(-1).content], ['Question 2', 'Answer 7']);

  // The student's messages and earlier check-ins feed the next decision.
  const snapshot = await checkInStore.snapshot(owner.userId, now);
  assert.ok(snapshot.lastStudentMessageAt);
  assert.deepEqual(snapshot.prior.map(item => item.dedupeKey).sort(), ['general:2026-10-10', opened.draft.dedupeKey].sort());
  assert.equal(snapshot.assignments.length, 1);

  // Pause is per student and survives a restart; an explicit request still opens a chat.
  await setCheckInsPaused(owner, true);
  await db.close();
  db = new PGlite({ dataDir: directory, extensions: { pgcrypto } });
  assert.equal(await checkInsPaused(owner.userId), true);
  assert.equal(await checkInsPaused(other.userId), false);
  assert.equal((await listChats(owner.userId)).length, 3);
  await db.query(`UPDATE chat_conversations SET created_at = created_at - interval '2 hours' WHERE owner_id = $1`, [owner.userId]);
  assert.deepEqual(await run(owner, new Date()), []);
  const [asked] = await run(owner, new Date(), { force: true });
  assert.ok(asked.chatId);
  await setCheckInsPaused(owner, false);
  assert.equal(await checkInsPaused(owner.userId), false);

  // The database refuses malformed chats, and deleting a student removes their chats.
  await assert.rejects(db.query(`INSERT INTO chat_conversations (id, owner_id, origin, title) VALUES ($1, $2, 'check_in', 'No key')`, [crypto.randomUUID(), owner.userId]));
  await assert.rejects(db.query(`INSERT INTO chat_messages (conversation_id, owner_id, role, content) VALUES ($1, $2, 'user', 'cross-owner')`, [opened.chatId, other.userId]));
  assert.deepEqual((await listCheckInOwnerIds()).sort(), [owner.userId, other.userId].sort());
  await db.query('DELETE FROM users WHERE id = $1', [owner.userId]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM chat_messages')).rows[0].n, 0);
  console.log('Proactive chat SQL checks passed.');
} finally {
  await db.close();
  await rm(directory, { recursive: true, force: true });
}
