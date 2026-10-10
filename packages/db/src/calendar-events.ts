import type { CalendarEvent, Completion, StudyBlockChanges, StudyBlockInput } from '@polymate/contracts/calendar';
import type { DateRange } from '@polymate/contracts/time';
import type { OwnerContext } from '@polymate/core/identity';
import { getPool } from './connection';
import { calendarOperationSessionClient } from './calendar-operations';
import { ensureUser } from './google-oauth';

const queries = () => calendarOperationSessionClient() ?? getPool();

export type StandaloneCalendarEvent = CalendarEvent & { source: 'polymate'; editable: true };

type Row = {
  id: string;
  title: string;
  start_at: Date;
  end_at: Date;
  all_day: boolean;
  completion: Completion;
  version: number;
};

const columns = 'id, title, start_at, end_at, all_day, completion, version';

function event(row: Row): StandaloneCalendarEvent {
  return {
    id: row.id,
    title: row.title,
    startAt: row.start_at.toISOString(),
    endAt: row.end_at.toISOString(),
    timezone: 'Europe/Zurich',
    allDay: row.all_day,
    source: 'polymate',
    editable: true,
    completion: row.completion,
    etag: `"${row.version}"`,
  };
}

export async function listStandaloneCalendarEvents(ownerId: string, range: DateRange): Promise<StandaloneCalendarEvent[]> {
  const result = await queries().query<Row>(
    `SELECT ${columns} FROM calendar_events
     WHERE owner_id = $1 AND start_at < $3 AND end_at > $2
     ORDER BY start_at, end_at, id`,
    [ownerId, range.from, range.to],
  );
  return result.rows.map(event);
}

export async function findStandaloneCalendarEvent(ownerId: string, id: string): Promise<StandaloneCalendarEvent | null> {
  const result = await queries().query<Row>(`SELECT ${columns} FROM calendar_events WHERE owner_id = $1 AND id = $2`, [ownerId, id]);
  return result.rows[0] ? event(result.rows[0]) : null;
}

export async function createStandaloneCalendarEvent(owner: OwnerContext, id: string, input: StudyBlockInput): Promise<StandaloneCalendarEvent | null> {
  await ensureUser(owner);
  const result = await queries().query<Row>(
    `INSERT INTO calendar_events (id, owner_id, title, start_at, end_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING RETURNING ${columns}`,
    [id, owner.userId, input.title, input.startAt, input.endAt],
  );
  return result.rows[0] ? event(result.rows[0]) : null;
}

export async function updateStandaloneCalendarEvent(
  ownerId: string,
  id: string,
  changes: StudyBlockChanges,
  expectedVersion: number,
): Promise<StandaloneCalendarEvent | null> {
  const result = await queries().query<Row>(
    `UPDATE calendar_events SET
       title = COALESCE($4, title),
       start_at = COALESCE($5, start_at),
       end_at = COALESCE($6, end_at),
       version = version + 1,
       updated_at = now()
     WHERE owner_id = $1 AND id = $2 AND version = $3
     RETURNING ${columns}`,
    [ownerId, id, expectedVersion, changes.title ?? null, changes.startAt ?? null, changes.endAt ?? null],
  );
  return result.rows[0] ? event(result.rows[0]) : null;
}

export async function completeStandaloneCalendarEvent(ownerId: string, id: string, expectedVersion: number): Promise<StandaloneCalendarEvent | null> {
  const result = await queries().query<Row>(
    `UPDATE calendar_events SET completion = 'done', version = version + 1, updated_at = now()
     WHERE owner_id = $1 AND id = $2 AND version = $3 RETURNING ${columns}`,
    [ownerId, id, expectedVersion],
  );
  return result.rows[0] ? event(result.rows[0]) : null;
}

export async function deleteStandaloneCalendarEvent(ownerId: string, id: string, expectedVersion: number): Promise<boolean> {
  const result = await queries().query('DELETE FROM calendar_events WHERE owner_id = $1 AND id = $2 AND version = $3', [ownerId, id, expectedVersion]);
  return result.rowCount === 1;
}
