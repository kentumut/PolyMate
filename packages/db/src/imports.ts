import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import type { Assignment, AssignmentInput } from '@polymate/contracts/assignments';
import { ImportStoreError, parseImportCollectionName, parseImportSaveRequest, type DurableImportPreview, type ImportCollection, type ImportEvent,
  type ImportPreview, type ImportReviewRow, type ImportSaveRequest, type ImportSaveResult, type ImportState, type ImportedCommitment } from '@polymate/contracts/imports';
import type { DateRange } from '@polymate/contracts/time';
import type { OwnerContext } from '@polymate/core/identity';
import { getPool } from './connection';
import { ensureUser } from './google-oauth';
import { assignmentFromRow } from './assignments';
import { withPlanningLock } from './planning';

type CollectionRow = { id: string; source: ImportCollection['source']; name: string; revision: number; imported_at: Date | null };
type Entry = { event_key: string; kind: 'assignment' | 'commitment'; source_event: ImportEvent; assignment_id: string | null; reviewed_input: AssignmentInput | null };
type AssignmentRow = { id: string; title: string; due_at: Date; estimated_minutes: number; remaining_minutes: number; status: Assignment['status']; version: number };
const collection = (row: CollectionRow): ImportCollection => ({ id: row.id, source: row.source, name: row.name, revision: row.revision, importedAt: row.imported_at?.toISOString() ?? null });
const columns = 'id,title,due_at,estimated_minutes,remaining_minutes,status,version';

async function transaction<T>(ownerId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Same lock/order as progress reporting: source changes never overwrite a concurrent report.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`study-progress:${ownerId}`]);
    const result = await run(client); await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function saveImportPreview(owner: OwnerContext, parsed: ImportPreview, target: { collectionId?: string; name?: string }, now = new Date()): Promise<DurableImportPreview> {
  await ensureUser(owner);
  return transaction(owner.userId, async client => {
    let row: CollectionRow;
    if (target.collectionId) {
      const found = await client.query<CollectionRow>('SELECT * FROM calendar_import_collections WHERE owner_id=$1 AND id=$2 FOR UPDATE', [owner.userId, target.collectionId]);
      if (!found.rows[0]) throw new ImportStoreError('not_found', 'Import collection not found.');
      row = found.rows[0];
      if (row.source !== parsed.source) throw new ImportStoreError('conflict', 'This collection uses a different calendar source.');
    } else {
      const created = await client.query<CollectionRow>('INSERT INTO calendar_import_collections(owner_id,source,name) VALUES($1,$2,$3) RETURNING *', [owner.userId, parsed.source, parseImportCollectionName(target.name)]);
      row = created.rows[0];
    }
    const entries = await client.query<Entry>('SELECT * FROM calendar_import_entries WHERE owner_id=$1 AND collection_id=$2', [owner.userId, row.id]);
    const existing = new Map(entries.rows.map(entry => [entry.event_key, entry]));
    const assignments = await client.query<AssignmentRow>(`SELECT ${columns} FROM assignments WHERE owner_id=$1`, [owner.userId]);
    const byId = new Map(assignments.rows.map(item => [item.id, assignmentFromRow(item)]));
    const rows: ImportReviewRow[] = parsed.events.map(event => {
      const prior = existing.get(event.key);
      const assignment = prior?.assignment_id ? byId.get(prior.assignment_id) ?? null : null;
      const suggestedInput = assignment ? { title: prior?.source_event.title !== event.title ? event.title : assignment.title,
        dueAt: prior?.source_event.startAt !== event.startAt && !event.allDay ? event.startAt : assignment.dueAt, estimatedMinutes: assignment.estimatedMinutes } : null;
      return { event, previousKind: prior?.kind ?? null, assignment, suggestedInput,
        change: !prior ? 'new' : isDeepStrictEqual(prior.source_event, event) ? 'unchanged' : 'changed' };
    });
    const preview: DurableImportPreview = { ...parsed, id: randomUUID(), collection: collection(row), rows, expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString() };
    await client.query('INSERT INTO calendar_import_previews(id,owner_id,collection_id,snapshot,expires_at) VALUES($1,$2,$3,$4,$5)', [preview.id, owner.userId, row.id, preview, preview.expiresAt]);
    return preview;
  });
}

export async function readImportState(ownerId: string, collectionId?: string, previewId?: string): Promise<ImportState> {
  const collections = await getPool().query<CollectionRow>('SELECT * FROM calendar_import_collections WHERE owner_id=$1 ORDER BY created_at,id', [ownerId]);
  if (collectionId && !collections.rows.some(row => row.id === collectionId)) throw new ImportStoreError('not_found', 'Import collection not found.');
  const previews = await getPool().query<{ snapshot: DurableImportPreview }>(`SELECT snapshot FROM calendar_import_previews WHERE owner_id=$1 ${previewId ? 'AND id=$2' : collectionId ? 'AND collection_id=$2' : ''} ORDER BY created_at DESC,id DESC LIMIT 1`, previewId ? [ownerId, previewId] : collectionId ? [ownerId, collectionId] : [ownerId]);
  const preview = previews.rows[0]?.snapshot ?? null;
  if (previewId && !preview) throw new ImportStoreError('not_found', 'Import preview not found.');
  const confirmations = preview ? await getPool().query<{ result_snapshot: ImportSaveResult }>('SELECT result_snapshot FROM calendar_import_confirmations WHERE owner_id=$1 AND preview_id=$2', [ownerId, preview.id]) : { rows: [] };
  return { collections: collections.rows.map(collection), preview, result: confirmations.rows[0]?.result_snapshot ?? null };
}

/** One atomic import; saved receipts are replayable after expiry and process restarts. */
export async function confirmCalendarImport(owner: OwnerContext, value: ImportSaveRequest, now = new Date()): Promise<ImportSaveResult> {
  const request = parseImportSaveRequest(value);
  return withPlanningLock(owner.userId, () => transaction(owner.userId, async client => {
    const replay = await client.query<{ request_snapshot: ImportSaveRequest; result_snapshot: ImportSaveResult }>('SELECT request_snapshot,result_snapshot FROM calendar_import_confirmations WHERE owner_id=$1 AND request_id=$2', [owner.userId, request.requestId]);
    if (replay.rows[0]) {
      if (!isDeepStrictEqual(replay.rows[0].request_snapshot, request)) throw new ImportStoreError('conflict', 'This request ID already belongs to a different selection. Retry the original request.');
      return replay.rows[0].result_snapshot;
    }
    const stored = await client.query<{ snapshot: DurableImportPreview }>('SELECT snapshot FROM calendar_import_previews WHERE owner_id=$1 AND id=$2 FOR UPDATE', [owner.userId, request.previewId]);
    const preview = stored.rows[0]?.snapshot;
    if (!preview) throw new ImportStoreError('not_found', 'Import preview not found.');
    const confirmed = await client.query('SELECT request_id FROM calendar_import_confirmations WHERE owner_id=$1 AND preview_id=$2', [owner.userId, preview.id]);
    if (confirmed.rows.length) throw new ImportStoreError('conflict', 'This preview was already confirmed. Reload its saved result or upload a new export.');
    if (Date.parse(preview.expiresAt) <= now.getTime()) throw new ImportStoreError('expired', 'This preview expired. Upload the export again and review a fresh preview.');
    const current = await client.query<CollectionRow>('SELECT * FROM calendar_import_collections WHERE owner_id=$1 AND id=$2 FOR UPDATE', [owner.userId, preview.collection.id]);
    if (current.rows[0]?.revision !== preview.collection.revision) throw new ImportStoreError('conflict', 'This collection changed since preview. Upload the export again.');
    const reviewed = new Map(preview.rows.map(row => [row.event.key, row]));
    const result: ImportSaveResult = { requestId: request.requestId, previewId: preview.id, collectionId: preview.collection.id, created: 0, updated: 0, unchanged: 0, assignments: [], commitments: 0, savedAt: now.toISOString() };
    for (const selection of request.selections) {
      const row = reviewed.get(selection.key);
      if (!row) throw new ImportStoreError('conflict', 'A selected event does not belong to this preview.');
      if (row.previousKind && row.previousKind !== selection.kind) throw new ImportStoreError('conflict', 'An imported assignment cannot become a lecture, or vice versa. Keep its original type.');
      const event = row.event;
      let assignmentId: string | null = null; let input: AssignmentInput | null = null; let changed = row.change !== 'unchanged';
      if (selection.kind === 'assignment') {
        input = selection.input;
        if (row.assignment) {
          const existing = await client.query<AssignmentRow>(`SELECT ${columns} FROM assignments WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [owner.userId, row.assignment.id]);
          const actual = existing.rows[0] ? assignmentFromRow(existing.rows[0]) : null;
          if (!actual || actual.version !== row.assignment.version) throw new ImportStoreError('conflict', 'An assignment changed since preview. Your progress is preserved; upload and review again.');
          assignmentId = actual.id;
          const update = actual.title !== input.title || actual.dueAt !== input.dueAt || actual.estimatedMinutes !== input.estimatedMinutes;
          if (update) {
            // Metadata/estimate changes never reset student-reported remaining effort or completion.
            const updated = await client.query<AssignmentRow>(`UPDATE assignments SET title=$3,due_at=$4,estimated_minutes=$5,version=version+1,updated_at=now() WHERE owner_id=$1 AND id=$2 RETURNING ${columns}`, [owner.userId, actual.id, input.title, input.dueAt, input.estimatedMinutes]);
            result.assignments.push(assignmentFromRow(updated.rows[0])); changed = true;
          } else result.assignments.push(actual);
        } else {
          assignmentId = randomUUID();
          const added = await client.query<AssignmentRow>(`INSERT INTO assignments(id,owner_id,title,due_at,estimated_minutes,remaining_minutes,client_request_id,creation_input) VALUES($1,$2,$3,$4,$5,$5,$6,$7) RETURNING ${columns}`, [assignmentId, owner.userId, input.title, input.dueAt, input.estimatedMinutes, randomUUID(), input]);
          result.assignments.push(assignmentFromRow(added.rows[0]));
        }
      } else {
        if (Date.parse(event.endAt) <= Date.parse(event.startAt)) throw new ImportStoreError('conflict', 'A read-only commitment must have a positive duration. Re-export it with an end time.');
        result.commitments++;
      }
      await client.query(`INSERT INTO calendar_import_entries(owner_id,collection_id,event_key,uid,recurrence_id,kind,source_event,assignment_id,reviewed_input,start_at,end_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(owner_id,collection_id,event_key) DO UPDATE SET source_event=EXCLUDED.source_event,reviewed_input=EXCLUDED.reviewed_input,start_at=EXCLUDED.start_at,end_at=EXCLUDED.end_at,updated_at=now()`,
      [owner.userId, preview.collection.id, event.key, event.uid, event.recurrenceId ?? '', selection.kind, event, assignmentId, input, event.startAt, event.endAt]);
      if (!row.previousKind) result.created++; else if (changed) result.updated++; else result.unchanged++;
    }
    await client.query('UPDATE calendar_import_collections SET revision=revision+1,imported_at=$3 WHERE owner_id=$1 AND id=$2', [owner.userId, preview.collection.id, now]);
    await client.query('INSERT INTO calendar_import_confirmations(owner_id,request_id,preview_id,request_snapshot,result_snapshot) VALUES($1,$2,$3,$4,$5)', [owner.userId, request.requestId, preview.id, request, result]);
    return result;
  }));
}

export async function listImportedCommitments(ownerId: string, range: DateRange): Promise<ImportedCommitment[]> {
  const rows = await getPool().query<{ collection_id: string; event_key: string; source_event: ImportEvent }>(`SELECT collection_id,event_key,source_event FROM calendar_import_entries WHERE owner_id=$1 AND kind='commitment' AND start_at < $3 AND end_at > $2 ORDER BY start_at,collection_id,event_key`, [ownerId, range.from, range.to]);
  return rows.rows.map(row => ({ id: `import-${row.collection_id}-${row.event_key}`, title: row.source_event.title, startAt: row.source_event.startAt, endAt: row.source_event.endAt, allDay: row.source_event.allDay, source: 'imported', editable: false }));
}
