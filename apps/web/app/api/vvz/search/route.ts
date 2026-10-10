import type { NextRequest } from 'next/server';
import { resolveOwner } from '@polymate/core/identity';
import { VvzClient, VvzError } from '@polymate/core/vvz';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  try {
    resolveOwner(request.headers);
    const query = request.nextUrl.searchParams.get('q')?.trim() ?? '';
    const semester = request.nextUrl.searchParams.get('semester')?.trim() ?? '';
    if (!query || query.length > 200) return Response.json({ error: { message: 'Enter a course title or number.' } }, { status: 422 });
    const filter = /^\d{3}-/.test(query) ? { number: query } : { title: query };
    const result = await new VvzClient().searchCourses({ semester, ...filter, limit: 8, offset: 0 });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof VvzError ? error.code === 'not_found' ? 404 : error.code === 'invalid_request' ? 422 : 502 : 401;
    const message = error instanceof Error ? error.message : 'Course search failed.';
    return Response.json({ error: { message } }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
