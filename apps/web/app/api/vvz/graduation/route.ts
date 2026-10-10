import type { NextRequest } from 'next/server';
import { assertSameOrigin, resolveOwner } from '@polymate/core/identity';
import { VvzClient, VvzError } from '@polymate/core/vvz';
import { checkMscCsGraduation } from '@polymate/core/vvz/graduation';
import { readBoundedText } from '@polymate/core/agent/http';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    resolveOwner(request.headers);
    assertSameOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new VvzError('invalid_request', 'Send a JSON graduation check.');
    const body = JSON.parse(await readBoundedText(request.body, 16_000)) as unknown;
    const result = await checkMscCsGraduation(new VvzClient(), body);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof VvzError ? error.code === 'invalid_request' ? 422 : error.code === 'not_found' ? 404 : 502 : error instanceof SyntaxError ? 422 : 401;
    const message = error instanceof Error ? error.message : 'Graduation check failed.';
    return Response.json({ error: { message } }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
