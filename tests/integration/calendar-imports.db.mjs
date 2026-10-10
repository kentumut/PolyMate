import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCalendarImport } from '../../packages/core/calendar/import.ts';
import { saveImportPreview, readImportState, confirmCalendarImport, listImportedCommitments } from '../../packages/db/src/imports.ts';
import { listAssignments } from '../../packages/db/src/assignments.ts';
import { studyProgressStore } from '../../packages/db/src/study-progress.ts';
import { planStudyWeek, assertStudyPlanFits } from '../../packages/core/scheduling/planner.ts';
import { DEFAULT_STUDY_PREFERENCES } from '../../packages/contracts/src/planning.ts';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const { pgcrypto } = await import(process.env.PGCRYPTO_MODULE || '@electric-sql/pglite/contrib/pgcrypto');
const directory = await mkdtemp(join(tmpdir(), 'polymate-imports-'));
let db = new PGlite({ dataDir: directory, extensions: { pgcrypto } });
process.env.DATABASE_URL = 'postgresql://isolated-test-adapter';
let failAfterEntry = false;
const query = async (sql, params) => {
  const result = await db.query(sql, params);
  if (failAfterEntry && /^INSERT INTO calendar_import_entries/i.test(sql)) { failAfterEntry = false; throw new Error('Injected failure after entry write.'); }
  return { rows: result.rows, rowCount: /^\s*SELECT/i.test(sql) ? result.rows.length : result.affectedRows ?? result.rows.length };
};
globalThis.polymatePool = { query, async connect() { return { query, release() {} }; } };
const owner = { userId: crypto.randomUUID(), externalId: 'imports@example.test', displayName: 'Import student' };
const other = { userId: crypto.randomUUID(), externalId: 'other-imports@example.test', displayName: 'Other student' };
const now = new Date('2026-10-12T06:00:00Z');
const source = (date = '20261014T160000Z', title = 'Problem sheet') => `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:sheet\nDTSTART:${date}\nSUMMARY:${title}\nEND:VEVENT\nBEGIN:VEVENT\nUID:lecture\nDTSTART:20261012T080000Z\nDTEND:20261012T100000Z\nSUMMARY:Lecture\nEND:VEVENT\nEND:VCALENDAR`;
const assignmentSelection = (preview, minutes = 100) => ({ key: preview.events.find(event => event.uid === 'sheet').key, kind: 'assignment', input: { title: preview.events.find(event => event.uid === 'sheet').title, dueAt: preview.events.find(event => event.uid === 'sheet').startAt, estimatedMinutes: minutes } });
const request = (preview, selections) => ({ previewId: preview.id, requestId: preview.id, selections });

try {
  const migrations = new URL('../../packages/db/migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()) await db.exec(await readFile(new URL(file, migrations), 'utf8'));
  const parsed = await parseCalendarImport(source(), 'moodle', now);
  const preview = await saveImportPreview(owner, parsed, { name: 'My Moodle export' }, now);
  assert.equal((await listAssignments(owner.userId)).length, 0);
  assert.equal((await readImportState(owner.userId)).preview.id, preview.id);
  await db.close(); db = new PGlite({ dataDir: directory, extensions: { pgcrypto } });
  assert.equal((await readImportState(owner.userId)).preview.id, preview.id);
  const confirmation = request(preview, [assignmentSelection(preview), { key: preview.events.find(event => event.uid === 'lecture').key, kind: 'commitment' }]);
  const saved = await confirmCalendarImport(owner, confirmation, now);
  assert.equal(saved.created, 2); assert.equal(saved.commitments, 1);
  assert.equal((await listAssignments(owner.userId)).length, 1);
  assert.deepEqual((await readImportState(owner.userId)).result, saved);
  await db.close(); db = new PGlite({ dataDir: directory, extensions: { pgcrypto } });
  assert.deepEqual(await confirmCalendarImport(owner, confirmation, new Date('2027-01-01T00:00:00Z')), saved);
  await assert.rejects(confirmCalendarImport(owner, { ...confirmation, selections: [assignmentSelection(preview, 90)] }, now), /different selection/);
  console.log('PASS preview/confirmation restart persistence, lost-reply receipt replay and immutable request IDs');

  const target = { collectionId: preview.collection.id };
  const again = await saveImportPreview(owner, parsed, target, now);
  assert.ok(again.rows.every(row => row.change === 'unchanged'));
  const unchanged = await confirmCalendarImport(owner, request(again, [assignmentSelection(again), { key: again.events.find(event => event.uid === 'lecture').key, kind: 'commitment' }]), now);
  assert.equal(unchanged.unchanged, 2); assert.equal(unchanged.created, 0);
  assert.equal((await listAssignments(owner.userId))[0].id, saved.assignments[0].id);
  console.log('PASS persistent reimport deduplication without assignment ID churn');

  const assignment = saved.assignments[0];
  const block = { id: 'linked-study', title: assignment.title, source: 'polymate', editable: true, etag: 'v1', completion: 'open', timezone: 'Europe/Zurich', allDay: false, startAt: '2026-10-12T12:00:00.000Z', endAt: '2026-10-12T12:50:00.000Z' };
  await studyProgressStore.link(owner.userId, { eventId: block.id, assignmentId: assignment.id, expectedAssignmentVersion: 1, expectedEtag: block.etag }, block);
  const stale = await saveImportPreview(owner, await parseCalendarImport(source('20261015T160000Z'), 'moodle', now), target, now);
  const partial = { clientRequestId: crypto.randomUUID(), eventId: block.id, assignmentId: assignment.id, action: 'partly_done', expectedAssignmentVersion: 1, expectedSessionRevision: 1, expectedEtag: block.etag, remainingMinutes: 30 };
  await studyProgressStore.record(owner.userId, partial, block);
  await assert.rejects(confirmCalendarImport(owner, request(stale, [assignmentSelection(stale)]), now), /assignment changed/i);
  assert.equal((await listAssignments(owner.userId))[0].dueAt, assignment.dueAt);
  const fresh = await saveImportPreview(owner, await parseCalendarImport(source('20261015T160000Z'), 'moodle', now), target, now);
  const updated = await confirmCalendarImport(owner, request(fresh, [assignmentSelection(fresh, 200)]), now);
  assert.equal(updated.updated, 1); assert.equal(updated.assignments[0].remainingMinutes, 30); assert.equal(updated.assignments[0].estimatedMinutes, 200);
  const progress = await studyProgressStore.state(owner.userId);
  assert.equal(progress.reports.length, 1); assert.equal(progress.links[0].eventId, block.id); assert.equal(progress.links[0].sessionRevision, 1);
  await studyProgressStore.record(owner.userId, { ...partial, clientRequestId: crypto.randomUUID(), action: 'done', remainingMinutes: 0, assignmentFinished: true, expectedAssignmentVersion: updated.assignments[0].version }, { ...block, completion: 'done' });
  const completedPreview = await saveImportPreview(owner, await parseCalendarImport(source('20261016T160000Z', 'Renamed sheet'), 'moodle', now), target, now);
  const closed = await confirmCalendarImport(owner, request(completedPreview, [assignmentSelection(completedPreview)]), now);
  assert.equal(closed.assignments[0].remainingMinutes, 0); assert.equal(closed.assignments[0].status, 'completed');
  console.log('PASS optimistic progress conflict, metadata updates preserving remaining effort/history/links and closed assignments');

  const older = await saveImportPreview(owner, parsed, target, now);
  const newer = await saveImportPreview(owner, parsed, target, now);
  await confirmCalendarImport(owner, request(newer, [assignmentSelection(newer)]), now);
  await assert.rejects(confirmCalendarImport(owner, request(older, [assignmentSelection(older)]), now), /collection changed/i);
  const expired = await saveImportPreview(owner, parsed, target, now);
  await assert.rejects(confirmCalendarImport(owner, request(expired, [assignmentSelection(expired)]), new Date(now.getTime() + 31 * 60000)), /expired/);
  const foreignPreview = await saveImportPreview(other, parsed, { name: 'Other Moodle export' }, now);
  await assert.rejects(confirmCalendarImport(owner, request(foreignPreview, [assignmentSelection(foreignPreview)]), now), /not found/);
  await assert.rejects(saveImportPreview(other, parsed, target, now), /not found/);
  await assert.rejects(readImportState(other.userId, undefined, preview.id), /not found/);
  const otherSaved = await confirmCalendarImport(other, request(foreignPreview, [assignmentSelection(foreignPreview)]), now);
  assert.notEqual(otherSaved.assignments[0].id, assignment.id);
  console.log('PASS source revisions, expired new confirmations and cross-student isolation');

  const rollbackParsed = await parseCalendarImport(source().replace('UID:sheet', 'UID:new-sheet').replace('UID:lecture', 'UID:zero-lecture').replace('DTEND:20261012T100000Z', 'DTEND:20261012T080000Z'), 'moodle', now);
  const rollback = await saveImportPreview(owner, rollbackParsed, target, now);
  const first = rollback.events.find(event => event.uid === 'new-sheet'); const second = rollback.events.find(event => event.uid === 'zero-lecture');
  const bad = request(rollback, [{ key: first.key, kind: 'assignment', input: { title: first.title, dueAt: first.startAt, estimatedMinutes: 50 } }, { key: second.key, kind: 'commitment' }]);
  const before = (await listAssignments(owner.userId)).length;
  await assert.rejects(confirmCalendarImport(owner, bad, now), /positive duration/);
  assert.equal((await listAssignments(owner.userId)).length, before);
  assert.equal((await query('SELECT * FROM calendar_import_confirmations WHERE owner_id=$1 AND preview_id=$2', [owner.userId, rollback.id])).rows.length, 0);
  // Inject after the assignment AND provenance entry were inserted, before the transaction commits.
  failAfterEntry = true;
  await assert.rejects(confirmCalendarImport(owner, { ...bad, selections: [bad.selections[0]] }, now), /Injected failure/);
  assert.equal((await listAssignments(owner.userId)).length, before);
  assert.equal((await query('SELECT * FROM calendar_import_entries WHERE owner_id=$1 AND event_key=$2', [owner.userId, first.key])).rows.length, 0);
  const retry = await confirmCalendarImport(owner, { ...bad, selections: [bad.selections[0]] }, now);
  assert.equal(retry.created, 1);
  assert.equal((await listAssignments(owner.userId)).length, before + 1);
  console.log('PASS atomic rollback of partial imports and retry after a definite failure');

  const range = { from: now.toISOString(), to: '2026-10-19T06:00:00.000Z' };
  const lectures = await listImportedCommitments(owner.userId, range);
  assert.equal(lectures.length, 1); assert.equal(lectures[0].editable, false);
  assert.equal((await listImportedCommitments(other.userId, range)).length, 0);
  const work = retry.assignments[0];
  const plan = planStudyWeek({ assignments: [work], events: lectures, linkedEvents: [], preferences: DEFAULT_STUDY_PREFERENCES, now, planId: crypto.randomUUID(), operationId: () => crypto.randomUUID() });
  assert.ok(plan.blocks.every(block => block.endAt <= lectures[0].startAt || block.startAt >= lectures[0].endAt));
  assert.throws(() => assertStudyPlanFits(plan, [{ ...lectures[0], startAt: plan.blocks[0].startAt, endAt: plan.blocks[0].endAt }], plan.blocks), /commitments changed/);
  console.log('PASS omitted entries retained, read-only lecture persistence/isolation and planner conflict protection');

  await assert.rejects(query(`INSERT INTO calendar_import_entries(owner_id,collection_id,event_key,uid,kind,source_event,assignment_id,reviewed_input,start_at,end_at) VALUES($1,$2,$3,'foreign','assignment',$4,$5,$6,$7,$8)`,
    [owner.userId, preview.collection.id, 'a'.repeat(64), parsed.events[0], otherSaved.assignments[0].id, confirmation.selections[0].input, now, now]));
  console.log('PASS SQL-level foreign-assignment provenance binding rejected');
  const separate = await saveImportPreview(owner, parsed, { name: 'Separate Moodle collection' }, now);
  const separateResult = await confirmCalendarImport(owner, request(separate, [assignmentSelection(separate)]), now);
  assert.notEqual(separateResult.assignments[0].id, assignment.id);
  console.log('PASS identical UIDs scoped to distinct source collections, never deduplicated by title');
} finally {
  await db.close(); delete globalThis.polymatePool; await rm(directory, { recursive: true, force: true });
}
