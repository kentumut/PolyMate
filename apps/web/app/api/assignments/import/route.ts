import type { NextRequest } from 'next/server';
import { resolveOwner } from '@polymate/core/identity';
import { ContractError, parseOperationId } from '@polymate/contracts/calendar';
import { readImportState } from '@polymate/db/imports';
import { importRouteError } from '@/lib/import-route';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    const params = request.nextUrl.searchParams;
    if ([...params.keys()].some(key => !['collectionId','previewId'].includes(key) || params.getAll(key).length !== 1) || (params.has('collectionId') && params.has('previewId'))) throw new ContractError('Unsupported import query fields.');
    const id = params.has('collectionId') ? parseOperationId(params.get('collectionId')) : undefined;
    const previewId = params.has('previewId') ? parseOperationId(params.get('previewId')) : undefined;
    return Response.json(await readImportState(owner.userId, id, previewId), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return importRouteError(error); }
}
