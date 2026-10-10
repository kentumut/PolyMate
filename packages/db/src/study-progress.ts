import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Assignment } from '@polymate/contracts/assignments';
import type { CalendarEvent, OperationResult } from '@polymate/contracts/calendar';
import { assertProgressContext, assignmentAfterReport, progressSignature, type BlockAssignmentLink, type ProgressReceipt, type ProgressReport, type ProgressRequest, type StudyActivity, type StudyActivityKind } from '@polymate/contracts/study-progress';
import { ProgressError, progressConflict, type StudyProgressStore } from '@polymate/core/progress';
import { assignmentFromRow, listAssignments } from './assignments';
import { getPool } from './connection';

type AssignmentRow = { id: string; title: string; due_at: Date; estimated_minutes: number; remaining_minutes: number; status: Assignment['status']; version: number };
type LinkRow = { event_id: string; assignment_id: string; session_revision: number; last_start_at: Date; last_end_at: Date; last_etag: string; completion: 'open' | 'done'; deleted_at: Date | null; created_at: Date; last_observed_at: Date };
type ReportRow = { request_snapshot: ProgressRequest; result_snapshot: ProgressReceipt; calendar_result: OperationResult | null };
type CalendarKind = 'create' | 'update' | 'complete' | 'delete';
const assignmentColumns = 'id, title, due_at, estimated_minutes, remaining_minutes, status, version';

function link(row: LinkRow): BlockAssignmentLink {
  return { eventId: row.event_id, assignmentId: row.assignment_id, sessionRevision: row.session_revision,
    startAt: row.last_start_at.toISOString(), endAt: row.last_end_at.toISOString(), etag: row.last_etag, completion: row.completion, deleted: Boolean(row.deleted_at) };
}
function receipt(row: ReportRow): ProgressReceipt { return { ...row.result_snapshot, ...(row.calendar_result ? { calendarOperation: row.calendar_result } : {}) }; }

async function transaction<T>(ownerId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`study-progress:${ownerId}`]);
    const result = await run(client);
    await client.query('COMMIT'); return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function emit(client: PoolClient, ownerId: string, key: string, kind: StudyActivityKind, payload: Record<string, unknown>) {
  await client.query(`INSERT INTO study_activity_events (owner_id, event_key, kind, payload) VALUES ($1,$2,$3,$4)
    ON CONFLICT (owner_id,event_key) DO NOTHING`, [ownerId, key, kind, payload]);
}
async function ownedAssignment(client: PoolClient, ownerId: string, assignmentId: string) {
  const result = await client.query<AssignmentRow>(`SELECT ${assignmentColumns} FROM assignments WHERE owner_id=$1 AND id=$2 FOR UPDATE`, [ownerId, assignmentId]);
  if (!result.rows[0]) throw new ProgressError('not_found', 'Assignment not found.');
  return assignmentFromRow(result.rows[0]);
}
async function insertLink(client: PoolClient, ownerId: string, assignmentId: string, event: CalendarEvent, createdAt?: Date, observedAt?: Date) {
  const result = await client.query<LinkRow>(`INSERT INTO assignment_block_links
    (owner_id,event_id,assignment_id,last_start_at,last_end_at,last_etag,completion,created_at,last_observed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,now()),COALESCE($9,now())) ON CONFLICT (owner_id,event_id) DO NOTHING RETURNING *`,
    [ownerId, event.id, assignmentId, event.startAt, event.endAt, event.etag, event.completion, createdAt ?? null, observedAt ?? null]);
  if (result.rows[0]) {
    const linked = link(result.rows[0]);
    await emit(client, ownerId, `link:${event.id}`, 'block_linked', { ...linked });
    return linked;
  }
  const prior = await client.query<LinkRow>('SELECT * FROM assignment_block_links WHERE owner_id=$1 AND event_id=$2', [ownerId, event.id]);
  if (!prior.rows[0] || prior.rows[0].assignment_id !== assignmentId || prior.rows[0].deleted_at) throw new ProgressError('conflict', 'This block already belongs to another assignment or was deleted.');
  return link(prior.rows[0]);
}

export async function reserveBlockAssignment(ownerId: string, operationId: string, assignmentId: string, expectedVersion: number) {
  return transaction(ownerId, async client => {
    const prior = await client.query<{ assignment_id: string }>('SELECT assignment_id FROM assignment_block_intents WHERE owner_id=$1 AND operation_id=$2', [ownerId, operationId]);
    if (prior.rows[0]) {
      if (prior.rows[0].assignment_id !== assignmentId) throw new ProgressError('conflict', 'This calendar operation already belongs to another assignment.');
      return;
    }
    const operation = await client.query('SELECT operation_id FROM calendar_operations WHERE operation_id=$1', [operationId]);
    if (operation.rows.length) throw new ProgressError('conflict', 'Use a new calendar operation for this assignment link.');
    const assignment = await ownedAssignment(client, ownerId, assignmentId);
    if (assignment.version !== expectedVersion || ['completed','cancelled'].includes(assignment.status)) throw new ProgressError('conflict', 'Assignment changed or is closed. Refresh before scheduling.');
    await client.query('INSERT INTO assignment_block_intents(owner_id,operation_id,assignment_id) VALUES ($1,$2,$3)', [ownerId, operationId, assignmentId]);
  });
}

async function calendarEffect(client: PoolClient, ownerId: string, kind: CalendarKind, targetId: string | null, result: OperationResult) {
  if (result.status !== 'synced') return;
  const marker = await client.query(`INSERT INTO study_calendar_effects(owner_id,operation_id) VALUES ($1,$2)
    ON CONFLICT (owner_id,operation_id) DO NOTHING RETURNING operation_id`, [ownerId, result.operationId]);
  if (!marker.rows.length) return;
  const eventId = result.event?.id ?? targetId;
  if (!eventId) return;
  const operation = await client.query<{ created_at: Date; updated_at: Date }>('SELECT created_at,updated_at FROM calendar_operations WHERE owner_id=$1 AND operation_id=$2', [ownerId, result.operationId]);
  const createdAt = operation.rows[0]?.created_at;
  const observedAt = operation.rows[0]?.updated_at;
  if (kind === 'create' && result.event) {
    const intent = await client.query<{ assignment_id: string }>('SELECT assignment_id FROM assignment_block_intents WHERE owner_id=$1 AND operation_id=$2', [ownerId, result.operationId]);
    if (intent.rows[0]) await insertLink(client, ownerId, intent.rows[0].assignment_id, result.event, createdAt, observedAt);
  }
  const rows = await client.query<LinkRow>('SELECT * FROM assignment_block_links WHERE owner_id=$1 AND event_id=$2 FOR UPDATE', [ownerId, eventId]);
  const current = rows.rows[0];
  if (!current || current.deleted_at || (observedAt && observedAt < current.last_observed_at)) return;
  if (kind === 'delete') {
    await client.query('UPDATE assignment_block_links SET deleted_at=now(),last_observed_at=now(),session_revision=session_revision+1 WHERE owner_id=$1 AND event_id=$2', [ownerId, eventId]);
    await emit(client, ownerId, `delete:${result.operationId}`, 'block_deleted', { eventId, assignmentId: current.assignment_id, sessionRevision: current.session_revision + 1 });
  } else if (result.event) {
    const moved = current.last_start_at.toISOString() !== result.event.startAt || current.last_end_at.toISOString() !== result.event.endAt;
    await client.query(`UPDATE assignment_block_links SET last_start_at=$3,last_end_at=$4,last_etag=$5,completion=$6,
      session_revision=session_revision+$7,last_observed_at=COALESCE($8,now()) WHERE owner_id=$1 AND event_id=$2`,
      [ownerId, eventId, result.event.startAt, result.event.endAt, result.event.etag, result.event.completion, moved ? 1 : 0, observedAt ?? null]);
    if (moved) await emit(client, ownerId, `move:${result.operationId}`, 'block_rescheduled', {
      eventId, assignmentId: current.assignment_id, sessionRevision: current.session_revision + 1,
      oldStartAt: current.last_start_at.toISOString(), oldEndAt: current.last_end_at.toISOString(), startAt: result.event.startAt, endAt: result.event.endAt,
    });
    if (kind === 'complete') {
      await emit(client, ownerId, `complete:${result.operationId}`, 'block_completed', { eventId, assignmentId: current.assignment_id, sessionRevision: current.session_revision });
      await client.query(`UPDATE study_progress_reports SET calendar_result=$3 WHERE owner_id=$1 AND client_request_id=$2 AND event_id=$4 AND action='done'`, [ownerId, result.operationId, result, eventId]);
    }
  }
}

export async function observeStudyCalendarChange(ownerId: string, kind: CalendarKind, targetId: string | null, result: OperationResult) {
  if (result.status !== 'synced') return;
  await transaction(ownerId, client => calendarEffect(client, ownerId, kind, targetId, result));
}
async function repairCalendarEffects(ownerId: string) {
  const rows = await getPool().query<{ operation_kind: CalendarKind; target_event_id: string | null; result: OperationResult }>(
    `SELECT c.operation_kind,c.target_event_id,c.result FROM calendar_operations c
     LEFT JOIN study_calendar_effects e ON e.owner_id=c.owner_id AND e.operation_id=c.operation_id
     WHERE c.owner_id=$1 AND c.status='synced' AND e.operation_id IS NULL ORDER BY c.updated_at,c.operation_id`, [ownerId]);
  for (const row of rows.rows) await observeStudyCalendarChange(ownerId, row.operation_kind, row.target_event_id, row.result);
}

export const studyProgressStore: StudyProgressStore = {
  async state(ownerId) {
    await repairCalendarEffects(ownerId);
    const [assignments, links, reports] = await Promise.all([
      listAssignments(ownerId), getPool().query<LinkRow>('SELECT * FROM assignment_block_links WHERE owner_id=$1 ORDER BY event_id', [ownerId]),
      getPool().query<ReportRow>('SELECT request_snapshot,result_snapshot,calendar_result FROM study_progress_reports WHERE owner_id=$1 ORDER BY reported_at,id', [ownerId]),
    ]);
    return { assignments, links: links.rows.map(link), reports: reports.rows.map(row => row.result_snapshot.report),
      pendingCompletions: reports.rows.filter(row => row.request_snapshot.action === 'done' && !row.result_snapshot.calendarAlreadyDone
        && (!row.calendar_result || ['unknown', 'pending'].includes(row.calendar_result.status))).map(row => row.request_snapshot) };
  },
  async link(ownerId, request, event) {
    return transaction(ownerId, async client => {
      const existing = await client.query<LinkRow>('SELECT * FROM assignment_block_links WHERE owner_id=$1 AND event_id=$2', [ownerId, event.id]);
      if (existing.rows[0]) {
        if (existing.rows[0].assignment_id !== request.assignmentId || existing.rows[0].deleted_at) throw new ProgressError('conflict', 'Assignment links cannot be silently reassigned.');
        return link(existing.rows[0]);
      }
      const assignment = await ownedAssignment(client, ownerId, request.assignmentId);
      if (assignment.version !== request.expectedAssignmentVersion || assignment.status === 'cancelled') throw new ProgressError('conflict', 'Assignment changed. Refresh and review it.');
      return insertLink(client, ownerId, request.assignmentId, event);
    });
  },
  async attempt(ownerId, requestId) {
    const result = await getPool().query<ReportRow>('SELECT request_snapshot,result_snapshot,calendar_result FROM study_progress_reports WHERE owner_id=$1 AND client_request_id=$2', [ownerId, requestId]);
    return result.rows[0] ? { request: result.rows[0].request_snapshot, receipt: receipt(result.rows[0]) } : null;
  },
  async record(ownerId, request, event) {
    return transaction(ownerId, async client => {
      const prior = await client.query<ReportRow>('SELECT request_snapshot,result_snapshot,calendar_result FROM study_progress_reports WHERE owner_id=$1 AND client_request_id=$2', [ownerId, request.clientRequestId]);
      if (prior.rows[0]) {
        if (progressSignature(prior.rows[0].request_snapshot) !== progressSignature(request)) throw new ProgressError('conflict', 'This report ID already has different progress.');
        return receipt(prior.rows[0]);
      }
      const assignment = await ownedAssignment(client, ownerId, request.assignmentId);
      const linked = await client.query<LinkRow>('SELECT * FROM assignment_block_links WHERE owner_id=$1 AND event_id=$2 FOR UPDATE', [ownerId, request.eventId]);
      if (!linked.rows[0]) throw new ProgressError('not_found', 'Link this study block to an assignment first.');
      try { assertProgressContext(assignment, link(linked.rows[0]), request, event); } catch (error) { progressConflict(error); }
      const next = assignmentAfterReport(assignment, request);
      await client.query('UPDATE assignments SET remaining_minutes=$3,status=$4,version=$5,updated_at=now() WHERE owner_id=$1 AND id=$2', [ownerId, request.assignmentId, next.remainingMinutes, next.status, next.version]);
      const inserted = await client.query<{ id: string; reported_at: Date }>(`INSERT INTO study_progress_reports
        (id,owner_id,client_request_id,event_id,assignment_id,session_revision,action,note,reported_remaining_minutes,assignment_finished,request_snapshot,result_snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'{}'::jsonb) RETURNING id,reported_at`,
        [randomUUID(), ownerId, request.clientRequestId, request.eventId, request.assignmentId, request.expectedSessionRevision, request.action,
          request.note ?? '', request.assignmentFinished ? 0 : request.remainingMinutes ?? null, request.assignmentFinished ?? false, request]);
      const report: ProgressReport = { id: inserted.rows[0].id, clientRequestId: request.clientRequestId, eventId: request.eventId, assignmentId: request.assignmentId,
        sessionRevision: request.expectedSessionRevision, action: request.action, note: request.note ?? '', reportedRemainingMinutes: request.assignmentFinished ? 0 : request.remainingMinutes ?? null,
        assignmentFinished: request.assignmentFinished === true, reportedAt: inserted.rows[0].reported_at.toISOString() };
      const saved: ProgressReceipt = { report, assignment: next, ...(request.action === 'done' && event.completion === 'done' ? { calendarAlreadyDone: true } : {}) };
      await client.query('UPDATE study_progress_reports SET result_snapshot=$3 WHERE owner_id=$1 AND client_request_id=$2', [ownerId, request.clientRequestId, saved]);
      await emit(client, ownerId, `progress:${request.clientRequestId}`, 'progress_recorded', { eventId: request.eventId, assignmentId: request.assignmentId,
        sessionRevision: request.expectedSessionRevision, reportId: report.id, action: request.action, remainingMinutes: next.remainingMinutes, assignmentVersion: next.version });
      return saved;
    });
  },
  async calendarResult(ownerId, requestId, result) {
    return transaction(ownerId, async client => {
      const prior = await client.query<ReportRow>('SELECT request_snapshot,result_snapshot,calendar_result FROM study_progress_reports WHERE owner_id=$1 AND client_request_id=$2 FOR UPDATE', [ownerId, requestId]);
      if (!prior.rows[0]) throw new ProgressError('not_found', 'Progress report not found.');
      if (prior.rows[0].calendar_result?.status === 'synced' || prior.rows[0].calendar_result?.status === 'failed') return receipt(prior.rows[0]);
      if (result.status === 'synced') await calendarEffect(client, ownerId, 'complete', prior.rows[0].request_snapshot.eventId, result);
      await client.query('UPDATE study_progress_reports SET calendar_result=$3 WHERE owner_id=$1 AND client_request_id=$2', [ownerId, requestId, result]);
      return { ...prior.rows[0].result_snapshot, calendarOperation: result };
    });
  },
};

export async function listStudyActivity(ownerId: string, after: string): Promise<StudyActivity[]> {
  const result = await getPool().query<{ id: string; kind: StudyActivityKind; payload: Record<string, unknown>; created_at: Date }>(
    'SELECT id,kind,payload,created_at FROM study_activity_events WHERE owner_id=$1 AND id>$2 ORDER BY id LIMIT 100', [ownerId, after]);
  return result.rows.map(row => ({ id: String(row.id), kind: row.kind, payload: row.payload, createdAt: row.created_at.toISOString() }));
}

/** Observed external Google moves refresh metadata; absence from a week is not deletion evidence. */
export async function syncStudyCalendarRead(ownerId: string, events: readonly CalendarEvent[], observedAt = new Date()) {
  const owned = events.filter(event => event.source === 'polymate' && event.editable);
  if (!owned.length) return;
  await transaction(ownerId, async client => {
    for (const event of owned) {
      const result = await client.query<LinkRow>('SELECT * FROM assignment_block_links WHERE owner_id=$1 AND event_id=$2 FOR UPDATE', [ownerId, event.id]);
      const previous = result.rows[0];
      if (!previous || previous.deleted_at || previous.last_etag === event.etag || observedAt < previous.last_observed_at) continue;
      const moved = previous.last_start_at.toISOString() !== event.startAt || previous.last_end_at.toISOString() !== event.endAt;
      await client.query(`UPDATE assignment_block_links SET last_start_at=$3,last_end_at=$4,last_etag=$5,completion=$6,
        session_revision=session_revision+$7,last_observed_at=$8 WHERE owner_id=$1 AND event_id=$2`,
        [ownerId, event.id, event.startAt, event.endAt, event.etag, event.completion, moved ? 1 : 0, observedAt]);
      if (moved) await emit(client, ownerId, `observed-move:${event.id}:${event.etag}`, 'block_rescheduled', {
        eventId: event.id, assignmentId: previous.assignment_id, sessionRevision: previous.session_revision + 1, startAt: event.startAt, endAt: event.endAt,
      });
      if (event.completion === 'done' && previous.completion !== 'done') await emit(client, ownerId, `observed-done:${event.id}:${event.etag}`, 'block_completed', { eventId: event.id, assignmentId: previous.assignment_id, sessionRevision: previous.session_revision });
    }
  });
}
