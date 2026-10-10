import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssignment } from '../../packages/db/src/assignments.ts';
import { reserveBlockAssignment, observeStudyCalendarChange, studyProgressStore, listStudyActivity, syncStudyCalendarRead } from '../../packages/db/src/study-progress.ts';
import { StudyProgressService } from '../../packages/core/progress/service.ts';

// Optional real-SQL verification with a separately installed PGlite, without root dependencies.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const { pgcrypto } = await import(process.env.PGCRYPTO_MODULE || '@electric-sql/pglite/contrib/pgcrypto');
const directory = await mkdtemp(join(tmpdir(), 'polymate-progress-'));
let db = new PGlite({ dataDir: directory, extensions: { pgcrypto } });
process.env.DATABASE_URL = 'postgresql://isolated-test-adapter';
let tail = Promise.resolve();
let failNextMoveUpdate = false;
function bind() {
  const query = async (sql, params) => {
    if (failNextMoveUpdate && /^UPDATE assignment_block_links SET last_start_at/.test(sql)) {
      failNextMoveUpdate = false;
      throw new Error('Injected secondary move-metadata failure');
    }
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: /^\s*SELECT/i.test(sql) ? result.rows.length : result.affectedRows ?? result.rows.length };
  };
  globalThis.polymatePool = {
    query,
    async connect() {
      const previous = tail; let release;
      tail = new Promise(resolve => { release = resolve; });
      await previous;
      return { query, release: () => release() };
    },
  };
}
bind();
const owner = { userId: '00000000-0000-4000-8000-000000000010', externalId: 'student@example.test', displayName: 'Student' };
const other = { userId: '00000000-0000-4000-8000-000000000011', externalId: 'other@example.test', displayName: 'Other' };
const sql = (text, params) => db.query(text, params);

try {
  const migrations = new URL('../../packages/db/migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    await db.exec(await readFile(new URL(file, migrations), 'utf8'));
  }
  const input = { title: 'Sheet 4', dueAt: '2026-10-16T16:00:00Z', estimatedMinutes: 150, clientRequestId: crypto.randomUUID() };
  const assignment = (await createAssignment(owner, input)).assignment;
  const otherAssignment = (await createAssignment(other, { ...input, clientRequestId: crypto.randomUUID() })).assignment;
  const creationId = crypto.randomUUID();
  let event = { id: 'study1', title: 'Questions 1–2', startAt: '2026-10-12T09:00:00.000Z', endAt: '2026-10-12T09:50:00.000Z', allDay: false, timezone: 'Europe/Zurich', source: 'polymate', editable: true, completion: 'open', etag: '"v1"' };
  const calendar = {
    async readStudyBlock() { return { ...event }; },
    async completeStudyBlock(id, etag, operationId) {
      assert.equal(id, event.id); assert.equal(etag, event.etag);
      event = { ...event, completion: 'done', etag: '"done"' };
      const result = { operationId, status: 'synced', event };
      await insertOperation(operationId, 'complete', result);
      return result;
    },
  };
  async function insertOperation(operationId, kind, result) {
    await sql(`INSERT INTO calendar_operations(operation_id,owner_id,operation_kind,target_event_id,expected_etag,intended_change,status,result)
      VALUES ($1,$2,$3,$4,$5,'{}','synced',$6)`, [operationId, owner.userId, kind, event.id, '"old"', result]);
  }
  const service = new StudyProgressService(owner.userId, calendar, studyProgressStore);
  await reserveBlockAssignment(owner.userId, creationId, assignment.id, 1);
  const createResult = { operationId: creationId, status: 'synced', event };
  await insertOperation(creationId, 'create', createResult);
  await observeStudyCalendarChange(owner.userId, 'create', event.id, createResult);
  let state = await service.state();
  assert.equal(state.links[0].assignmentId, assignment.id);
  await observeStudyCalendarChange(owner.userId, 'create', event.id, createResult);
  assert.equal((await listStudyActivity(owner.userId, '0')).filter(item => item.kind === 'block_linked').length, 1);
  console.log('PASS create intent and duplicate-safe assignment/block link');

  const base = { eventId: event.id, assignmentId: assignment.id, expectedAssignmentVersion: 1, expectedSessionRevision: 1, expectedEtag: event.etag };
  const partial = { ...base, action: 'partly_done', remainingMinutes: 100, clientRequestId: crypto.randomUUID() };
  const [a,b] = await Promise.all([service.record(partial), service.record(partial)]);
  assert.equal(a.report.id, b.report.id); assert.equal(a.assignment.remainingMinutes, 100);
  assert.equal((await service.state()).reports.length, 1);
  await assert.rejects(service.record({ ...partial, remainingMinutes: 50 }));
  await assert.rejects(service.record({ ...partial, clientRequestId: crypto.randomUUID() }));
  assert.equal((await service.state()).assignments[0].version, 2);
  console.log('PASS atomic partial progress, concurrent deduplication, and stale-version rejection');

  const stuck = await service.record({ ...base, expectedAssignmentVersion: 2, action: 'stuck', note: 'Question 2 induction', clientRequestId: crypto.randomUUID() });
  assert.equal(stuck.assignment.remainingMinutes, 100);
  const missed = await service.record({ ...base, expectedAssignmentVersion: 3, action: 'missed', clientRequestId: crypto.randomUUID() });
  assert.equal(missed.assignment.remainingMinutes, 100);
  event = { ...event, startAt: '2026-10-13T09:00:00.000Z', endAt: '2026-10-13T09:50:00.000Z', etag: '"moved"' };
  const moved = { operationId: crypto.randomUUID(), status: 'synced', event };
  await insertOperation(moved.operationId, 'update', moved);
  failNextMoveUpdate = true;
  await assert.rejects(observeStudyCalendarChange(owner.userId, 'update', event.id, moved), /Injected secondary/);
  assert.equal((await sql('SELECT session_revision FROM assignment_block_links WHERE owner_id=$1 AND event_id=$2', [owner.userId, event.id])).rows[0].session_revision, 1);
  assert.equal((await sql('SELECT count(*)::int AS count FROM study_calendar_effects WHERE owner_id=$1 AND operation_id=$2', [owner.userId, moved.operationId])).rows[0].count, 0);
  // The confirmed Google ledger survives rollback. A subsequent state read repairs it exactly once.
  await service.state();
  await observeStudyCalendarChange(owner.userId, 'update', event.id, moved);
  state = await service.state();
  assert.equal(state.links[0].sessionRevision, 2);
  assert.equal(state.reports.filter(item => item.sessionRevision === 2).length, 0);
  assert.equal(state.assignments[0].remainingMinutes, 100);
  assert.equal((await listStudyActivity(owner.userId, '0')).filter(item => item.kind === 'block_rescheduled').length, 1);
  console.log('PASS failed move-metadata transaction rolls back; state recovery increments revision and emits one event');

  const ownerBefore = state.assignments[0];
  await assert.rejects(studyProgressStore.link(other.userId, { eventId: 'forged', assignmentId: assignment.id, expectedAssignmentVersion: 4, expectedEtag: event.etag }, { ...event, id: 'forged' }));
  assert.equal((await studyProgressStore.state(other.userId)).reports.length, 0);
  assert.equal((await studyProgressStore.state(other.userId)).assignments[0].id, otherAssignment.id);
  assert.equal((await service.state()).assignments[0].version, ownerBefore.version);
  assert.deepEqual(await listStudyActivity(other.userId, '0'), []);
  console.log('PASS owner isolation and transaction rollback');

  // Database commit succeeds but completion hasn't started (crash between the two systems).
  const done = { ...base, clientRequestId: crypto.randomUUID(), action: 'done', expectedAssignmentVersion: 4, expectedSessionRevision: 2, expectedEtag: event.etag };
  await studyProgressStore.record(owner.userId, done, event);
  assert.equal((await service.state()).pendingCompletions[0].clientRequestId, done.clientRequestId);
  await db.close(); db = new PGlite({ dataDir: directory, extensions: { pgcrypto } }); bind();
  state = await service.state();
  assert.equal(state.reports.length, 4); assert.equal(state.links[0].sessionRevision, 2);
  const finishedSession = await service.record(done);
  assert.equal(finishedSession.calendarOperation.status, 'synced');
  assert.equal(finishedSession.assignment.remainingMinutes, 100);
  assert.equal((await service.state()).pendingCompletions.length, 0);
  assert.equal((await service.state()).assignments[0].version, 5);
  const cursor = (await listStudyActivity(owner.userId, '0')).at(-1).id;
  assert.deepEqual(await listStudyActivity(owner.userId, cursor), []);
  console.log('PASS restart/crashed-Done recovery and cursor-based activity');

  const allDone = await service.record({ ...done, clientRequestId: crypto.randomUUID(), expectedAssignmentVersion: 5, expectedEtag: event.etag, assignmentFinished: true });
  assert.equal(allDone.assignment.status, 'completed'); assert.equal(allDone.assignment.remainingMinutes, 0);
  assert.equal(allDone.calendarAlreadyDone, true);
  const deletion = { operationId: crypto.randomUUID(), status: 'synced' };
  await insertOperation(deletion.operationId, 'delete', deletion);
  await observeStudyCalendarChange(owner.userId, 'delete', event.id, deletion);
  state = await service.state();
  assert.equal(state.links[0].deleted, true); assert.equal(state.reports.length, 5);
  assert.equal(state.assignments[0].status, 'completed');
  console.log('PASS explicit assignment completion and preserved history after deletion');

  // Observing a stale calendar read must not roll a moved session back.
  const secondEvent = { ...event, id: 'study2', completion: 'open', etag: '"s1"' };
  const secondAssignment = (await createAssignment(owner, { ...input, clientRequestId: crypto.randomUUID() })).assignment;
  await studyProgressStore.link(owner.userId, { assignmentId: secondAssignment.id, eventId: secondEvent.id, expectedAssignmentVersion: 1, expectedEtag: secondEvent.etag }, secondEvent);
  const staleReadAt = new Date(0);
  await syncStudyCalendarRead(owner.userId, [{ ...secondEvent, startAt: originalStart(), etag: '"stale-read"' }], staleReadAt);
  assert.equal((await service.state()).links.find(item => item.eventId === 'study2').etag, '"s1"');
  console.log('PASS stale read cannot overwrite newer link metadata');
} finally {
  await db.close(); delete globalThis.polymatePool; await rm(directory, { recursive: true, force: true });
}

function originalStart() { return '2026-10-12T09:00:00.000Z'; }
