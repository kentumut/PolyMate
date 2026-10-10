import type { NextRequest } from 'next/server';
import { dispatchOpenClawTool } from '@/lib/agent-runtime';
import { readBoundedText } from '@polymate/core/agent/http';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(request: NextRequest): Promise<Response> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    return Response.json({ error: { message: 'Send JSON.' } }, { status: 415, headers: NO_STORE });
  }
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 200_000) {
    return Response.json({ error: { message: 'Tool request is too large.' } }, { status: 413, headers: NO_STORE });
  }
  let rawBody: string;
  try { rawBody = await readBoundedText(request.body, 200_000); }
  catch { return Response.json({ error: { message: 'Tool request is too large or incomplete.' } }, { status: 413, headers: NO_STORE }); }
  let body: unknown;
  try { body = JSON.parse(rawBody) as unknown; }
  catch { return Response.json({ error: { message: 'Send valid JSON.' } }, { status: 400, headers: NO_STORE }); }
  const result = await dispatchOpenClawTool({ rawBody, body,
    timestamp: request.headers.get('x-polymate-timestamp'),
    nonce: request.headers.get('x-polymate-nonce'),
    signature: request.headers.get('x-polymate-signature'),
  });
  if (result.error) return Response.json({ error: { message: result.error.message } }, { status: result.error.status, headers: NO_STORE });
  const serialized = JSON.stringify(result.result);
  if (Buffer.byteLength(serialized) > 900_000) return Response.json({ error: { message: 'Tool result exceeded the response limit. Ask for fewer assignments.' } }, { status: 502, headers: NO_STORE });
  return new Response(serialized, { headers: { ...NO_STORE, 'Content-Type': 'application/json; charset=utf-8' } });
}
