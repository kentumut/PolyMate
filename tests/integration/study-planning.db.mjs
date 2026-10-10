import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAssignment, listAssignments } from '../../packages/db/src/assignments.ts';
import { getStudyPlan, getStudyPreferences, linkedStudyBlocks, saveStudyPlan } from '../../packages/db/src/planning.ts';
import { studyProgressStore } from '../../packages/db/src/study-progress.ts';
import { DEFAULT_STUDY_PREFERENCES } from '../../packages/contracts/src/planning.ts';
import { planStudyWeek } from '../../packages/core/scheduling/planner.ts';

// Optional SQL/restart check, using the same external PGlite setup as study-progress.db.mjs.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const { pgcrypto } = await import(process.env.PGCRYPTO_MODULE || '@electric-sql/pglite/contrib/pgcrypto');
const directory = await mkdtemp(join(tmpdir(), 'polymate-planning-'));
let db = new PGlite({ dataDir: directory, extensions: { pgcrypto } });
process.env.DATABASE_URL = 'postgresql://isolated-test-adapter';
const query = async (sql, params) => {
  const result = await db.query(sql, params);
  return { rows: result.rows, rowCount: /^\s*SELECT/i.test(sql) ? result.rows.length : result.affectedRows ?? result.rows.length };
};
globalThis.polymatePool = { query, async connect() { return { query, release() {} }; } };
const owner = { userId: crypto.randomUUID(), externalId: 'student@example.test', displayName: 'Student' };
const other = { userId: crypto.randomUUID(), externalId: 'other@example.test', displayName: 'Other' };
const now = new Date('2026-10-12T06:00:00Z');

try {
  const migrations = new URL('../../packages/db/migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    await db.exec(await readFile(new URL(file, migrations), 'utf8'));
  }
  const input = { title: 'Sheet', dueAt: '2026-10-13T16:00:00Z', estimatedMinutes: 50, clientRequestId: crypto.randomUUID() };
  const assignment = (await createAssignment(owner, input)).assignment;
  const foreign = (await createAssignment(other, { ...input, clientRequestId: crypto.randomUUID() })).assignment;
  const plan = planStudyWeek({ assignments: [assignment], events: [], linkedEvents: [], preferences: DEFAULT_STUDY_PREFERENCES,
    now, planId: crypto.randomUUID(), operationId: () => crypto.randomUUID() });
  const snapshot = { plan, assignments: [assignment], linkedEvents: [], approved: false, results: [] };
  await saveStudyPlan(owner, snapshot);
  assert.deepEqual((await getStudyPlan(owner.userId)).plan, plan);
  assert.deepEqual(await getStudyPreferences(owner.userId), DEFAULT_STUDY_PREFERENCES);
  assert.equal(await getStudyPlan(other.userId, plan.id), null);
  assert.equal((await query('SELECT * FROM assignment_block_intents WHERE owner_id=$1', [owner.userId])).rows.length, 1);
  console.log('PASS transactional preferences, preview, progress intent, and owner isolation');

  // Simulate a crash after Google/log confirmation, before progress and preview bookkeeping.
  const block = plan.blocks[0];
  const event = { ...block, id: 'google1', timezone: 'Europe/Zurich', allDay: false, source: 'polymate', editable: true, completion: 'open', etag: '"v1"' };
  const result = { operationId: block.operationId, status: 'synced', event };
  await query(`INSERT INTO calendar_operations(operation_id,owner_id,operation_kind,target_event_id,intended_change,status,result)
    VALUES ($1,$2,'create',$3,$4,'synced',$5)`, [block.operationId, owner.userId, event.id, block, result]);
  await db.close();
  db = new PGlite({ dataDir: directory, extensions: { pgcrypto } });
  assert.equal((await getStudyPlan(owner.userId)).plan.id, plan.id);
  assert.deepEqual(await linkedStudyBlocks(owner.userId), [{ assignmentId: assignment.id, eventId: event.id }]);
  assert.deepEqual(await linkedStudyBlocks(owner.userId, plan.id), []);
  console.log('PASS restart persistence and repair of Google confirmations into shared progress links');

  await studyProgressStore.record(owner.userId, { eventId: event.id, assignmentId: assignment.id, action: 'partly_done',
    remainingMinutes: 30, expectedAssignmentVersion: 1, expectedSessionRevision: 1, expectedEtag: event.etag, clientRequestId: crypto.randomUUID() }, event);
  assert.deepEqual(await linkedStudyBlocks(owner.userId), []);
  assert.equal((await listAssignments(owner.userId))[0].remainingMinutes, 30);
  console.log('PASS explicit progress is not subtracted twice when planning again');

  const foreignSnapshot = structuredClone(snapshot);
  foreignSnapshot.plan.id = crypto.randomUUID();
  foreignSnapshot.plan.blocks[0].operationId = crypto.randomUUID();
  foreignSnapshot.plan.blocks[0].assignmentId = foreign.id;
  foreignSnapshot.plan.preferences.dailyMinutes = 60;
  await assert.rejects(saveStudyPlan(owner, foreignSnapshot));
  assert.equal(await getStudyPlan(owner.userId, foreignSnapshot.plan.id), null);
  assert.equal((await getStudyPreferences(owner.userId)).dailyMinutes, 180);
  console.log('PASS foreign assignment rejected by SQL constraint; preferences and draft rolled back');
} finally {
  await db.close();
  delete globalThis.polymatePool;
  await rm(directory, { recursive: true, force: true });
}
