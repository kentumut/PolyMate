import type { NextRequest } from 'next/server';
import { progressJson, progressRouteError, progressWriteOwner, rescheduleStudySessionFor } from '@/lib/study-progress';
import { operationResponse } from '@/lib/calendar-route';

export async function POST(request: NextRequest) {
  try {
    const owner = progressWriteOwner(request);
    return operationResponse(await rescheduleStudySessionFor(owner, await progressJson(request)));
  } catch (error) { return progressRouteError(error); }
}
