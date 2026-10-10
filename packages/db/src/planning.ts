import type { StoredStudyPlan, StudyPreferences } from '@polymate/contracts/planning';
import { CalendarBusyError } from '@polymate/core/calendar/operations';
import type { OwnerContext } from '@polymate/core/identity';
import { getPool } from './connection';
import { ensureUser } from './google-oauth';
import { studyProgressStore } from './study-progress';

export async function getStudyPreferences(ownerId: string): Promise<StudyPreferences | null> {
  const result = await getPool().query<{ preferences: StudyPreferences }>('SELECT preferences FROM study_preferences WHERE owner_id = $1', [ownerId]);
  return result.rows[0]?.preferences ?? null;
}

export async function saveStudyPlan(owner: OwnerContext, snapshot: StoredStudyPlan): Promise<void> {
  await ensureUser(owner);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO study_preferences (owner_id, preferences) VALUES ($1, $2)
      ON CONFLICT (owner_id) DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = now()`, [owner.userId, snapshot.plan.preferences]);
    await client.query('INSERT INTO study_plans (id, owner_id, snapshot) VALUES ($1, $2, $3)', [snapshot.plan.id, owner.userId, snapshot]);
    for (const block of snapshot.plan.blocks) {
      await client.query(`INSERT INTO study_plan_blocks (operation_id, owner_id, plan_id, assignment_id) VALUES ($1, $2, $3, $4)`,
        [block.operationId, owner.userId, snapshot.plan.id, block.assignmentId]);
      await client.query('INSERT INTO assignment_block_intents (owner_id, operation_id, assignment_id) VALUES ($1, $2, $3)',
        [owner.userId, block.operationId, block.assignmentId]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function getStudyPlan(ownerId: string, planId?: string): Promise<StoredStudyPlan | null> {
  const result = await getPool().query<{ snapshot: StoredStudyPlan }>(
    `SELECT snapshot FROM study_plans WHERE owner_id = $1 ${planId ? 'AND id = $2' : ''} ORDER BY created_at DESC, id LIMIT 1`,
    planId ? [ownerId, planId] : [ownerId]);
  return result.rows[0]?.snapshot ?? null;
}

export async function updateStudyPlan(ownerId: string, snapshot: StoredStudyPlan): Promise<void> {
  await getPool().query('UPDATE study_plans SET snapshot = $3 WHERE owner_id = $1 AND id = $2', [ownerId, snapshot.plan.id, snapshot]);
}

export async function linkedStudyBlocks(ownerId: string, excludingPlanId?: string): Promise<{ assignmentId: string; eventId: string }[]> {
  // Repair post-Google crash windows through the shared progress store before reading links.
  const state = await studyProgressStore.state(ownerId);
  const own = excludingPlanId ? await getPool().query<{ event_id: string }>(
    `SELECT o.result->'event'->>'id' AS event_id FROM study_plan_blocks b
     JOIN calendar_operations o ON o.operation_id = b.operation_id AND o.owner_id = b.owner_id
     WHERE b.owner_id = $1 AND b.plan_id = $2`, [ownerId, excludingPlanId]) : { rows: [] };
  const excluded = new Set(own.rows.map(row => row.event_id));
  return state.links.filter(link => !link.deleted && !excluded.has(link.eventId)
    && !state.reports.some(report => report.eventId === link.eventId && report.sessionRevision === link.sessionRevision))
    .map(link => ({ assignmentId: link.assignmentId, eventId: link.eventId }));
}

/** Serialize whole planning requests; individual writes retain the existing calendar lock. No open transaction across Google. */
export async function withPlanningLock<T>(ownerId: string, run: () => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 1)) AS locked', [ownerId]);
    locked = result.rows[0].locked;
    if (!locked) throw new CalendarBusyError();
    return await run();
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 1))', [ownerId]);
      client.release();
    } catch (error) { client.release(true); throw error; }
  }
}
