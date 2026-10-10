import type { NextRequest } from 'next/server';
import { assertSameOrigin, resolveOwner } from '@polymate/core/identity';
import { readBoundedText } from '@polymate/core/agent/http';
import { VvzError } from '@polymate/core/vvz';
import { suggestCourseAlternative } from '@/lib/semester-plan-agent';
import { z } from 'zod';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    resolveOwner(request.headers);
    assertSameOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
      return Response.json({ error: { message: 'Send a JSON semester plan and course selection.' } }, { status: 422 });
    }
    const body = JSON.parse(await readBoundedText(request.body, 32_000)) as unknown;
    return Response.json(await suggestCourseAlternative(body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof z.ZodError || error instanceof SyntaxError ? 422 : error instanceof VvzError ? 502 : 400;
    const message = error instanceof z.ZodError ? error.issues[0]?.message ?? 'The alternative request is invalid.'
      : error instanceof Error ? error.message : 'PolyMate could not suggest an alternative course.';
    return Response.json({ error: { message } }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
