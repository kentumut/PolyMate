import { isDeepStrictEqual } from 'node:util';
import { parseAssignment, parseAssignmentCreateRequest, type Assignment, type AssignmentCreateRequest, type AssignmentInput } from '@polymate/contracts/assignments';
import type { OwnerContext } from '@polymate/core/identity';
import { getPool } from './connection';
import { ensureUser } from './google-oauth';

type Row = {
  id: string; title: string; due_at: Date; estimated_minutes: number; remaining_minutes: number;
  status: Assignment['status']; version: number; creation_input: AssignmentInput;
};
const columns = 'id, title, due_at, estimated_minutes, remaining_minutes, status, version, creation_input';

export class AssignmentRequestConflict extends Error {
  constructor() { super('This save request already belongs to different assignment details. Start a new save for your changes.'); this.name = 'AssignmentRequestConflict'; }
}

export function assignmentFromRow(row: Omit<Row, 'creation_input'>): Assignment {
  return parseAssignment({ id: row.id, title: row.title, dueAt: row.due_at.toISOString(), estimatedMinutes: row.estimated_minutes,
    remainingMinutes: row.remaining_minutes, status: row.status, version: row.version });
}

export async function listAssignments(ownerId: string): Promise<Assignment[]> {
  const result = await getPool().query<Row>(`SELECT ${columns} FROM assignments WHERE owner_id = $1 ORDER BY due_at, id`, [ownerId]);
  return result.rows.map(assignmentFromRow);
}

export async function createAssignment(owner: OwnerContext, request: AssignmentCreateRequest): Promise<{ assignment: Assignment; created: boolean }> {
  const { clientRequestId, ...input } = parseAssignmentCreateRequest(request);
  // Managed users can create assignments before connecting Google.
  await ensureUser(owner);
  const inserted = await getPool().query<Row>(
    `INSERT INTO assignments (owner_id, title, due_at, estimated_minutes, remaining_minutes, client_request_id, creation_input)
     VALUES ($1, $2, $3, $4, $4, $5, $6)
     ON CONFLICT (owner_id, client_request_id) DO NOTHING RETURNING ${columns}`,
    [owner.userId, input.title, input.dueAt, input.estimatedMinutes, clientRequestId, input],
  );
  if (inserted.rows[0]) return { assignment: assignmentFromRow(inserted.rows[0]), created: true };
  const existing = await getPool().query<Row>(
    `SELECT ${columns} FROM assignments WHERE owner_id = $1 AND client_request_id = $2`, [owner.userId, clientRequestId],
  );
  const row = existing.rows[0];
  if (!row || !isDeepStrictEqual(row.creation_input, input)) throw new AssignmentRequestConflict();
  return { assignment: assignmentFromRow(row), created: false };
}
