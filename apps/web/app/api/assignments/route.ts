import { AssignmentValidationError, parseAssignmentCreateRequest } from '@polymate/contracts/assignments';
import { resolveOwner } from '@polymate/core/identity';
import { createAssignment, listAssignments } from '@polymate/db/assignments';
import type { NextRequest } from 'next/server';
import { assertAssignmentMutation, assignmentRouteError } from '@/lib/assignment-route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    return Response.json({ assignments: await listAssignments(owner.userId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return assignmentRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    assertAssignmentMutation(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AssignmentValidationError('Send JSON.');
    let body: unknown;
    try { body = await request.json(); } catch { throw new AssignmentValidationError('Request body is not valid JSON.'); }
    const result = await createAssignment(owner, parseAssignmentCreateRequest(body));
    return Response.json({ assignment: result.assignment }, { status: result.created ? 201 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return assignmentRouteError(error); }
}
