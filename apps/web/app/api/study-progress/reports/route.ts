import type { NextRequest } from 'next/server';
import { progressJson, progressRouteError, progressWriteOwner, studyProgressServiceFor } from '@/lib/study-progress';

export async function POST(request: NextRequest) {
  try {
    const owner = progressWriteOwner(request);
    const receipt = await studyProgressServiceFor(owner).record(await progressJson(request));
    return Response.json({ receipt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return progressRouteError(error); }
}
