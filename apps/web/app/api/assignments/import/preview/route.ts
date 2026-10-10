import type { NextRequest } from 'next/server';
import { resolveOwner } from '@polymate/core/identity';
import { readBoundedText } from '@polymate/core/agent/http';
import { CalendarImportError, IMPORT_MAX_BYTES, parseCalendarImport, type ImportSource } from '@polymate/core/calendar/import';
import { parseOperationId } from '@polymate/contracts/calendar';
import { parseImportCollectionName } from '@polymate/contracts/imports';
import { saveImportPreview } from '@polymate/db/imports';
import { assertAssignmentMutation } from '@/lib/assignment-route';
import { importRouteError } from '@/lib/import-route';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    assertAssignmentMutation(request);
    const source = request.nextUrl.searchParams.get('source');
    const params = request.nextUrl.searchParams;
    if (!['moodle', 'mystudies'].includes(source ?? '') || [...params.keys()].some(key => !['source','collectionId','name','fixture'].includes(key) || params.getAll(key).length !== 1)) throw new CalendarImportError('Choose a source and a valid import collection.');
    const fixture = params.get('fixture');
    if (fixture !== null && (fixture !== 'true' || process.env.NODE_ENV === 'production')) throw new CalendarImportError('Fixture preview is available only in development.');
    if (params.has('collectionId') && params.has('name')) throw new CalendarImportError('Choose an existing collection or name a new one.');
    const target = params.has('collectionId') ? { collectionId: parseOperationId(params.get('collectionId')) } : { name: parseImportCollectionName(params.get('name') ?? (source === 'moodle' ? 'My Moodle calendar' : 'MyStudies timetable')) };
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/calendar') throw new CalendarImportError('Upload an ICS calendar file.');
    let raw: string;
    try { raw = await readBoundedText(request.body, IMPORT_MAX_BYTES); }
    catch { throw new CalendarImportError('The file could not be read or exceeds the 1 MB limit.'); }
    const parsed = await parseCalendarImport(raw, source as ImportSource);
    return Response.json(fixture ? parsed : await saveImportPreview(owner, parsed, target), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return importRouteError(error);
  }
}
