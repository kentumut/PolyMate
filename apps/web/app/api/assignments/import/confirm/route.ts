import type { NextRequest } from 'next/server';
import { resolveOwner } from '@polymate/core/identity';
import { readBoundedText } from '@polymate/core/agent/http';
import { ContractError } from '@polymate/contracts/calendar';
import { parseImportSaveRequest } from '@polymate/contracts/imports';
import { confirmCalendarImport } from '@polymate/db/imports';
import { assertAssignmentMutation } from '@/lib/assignment-route';
import { importRouteError } from '@/lib/import-route';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers); assertAssignmentMutation(request);
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ContractError('Send JSON import confirmation.');
    let body: unknown;
    try { body = JSON.parse(await readBoundedText(request.body, 512_000)); }
    catch { throw new ContractError('Send valid import details under 512 KB.'); }
    return Response.json(await confirmCalendarImport(owner, parseImportSaveRequest(body)), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return importRouteError(error); }
}
