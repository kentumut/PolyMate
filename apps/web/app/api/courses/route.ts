import type { NextRequest } from 'next/server';
import { parseCourseMutation } from '@polymate/contracts/courses';
import { assertSameOrigin, resolveOwner } from '@polymate/core/identity';
import { deleteCourse, listCourses, saveCourse } from '@polymate/db/courses';
import { courseRouteError } from '@/lib/course-route';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    return Response.json({ courses: await listCourses(owner.userId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return courseRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    assertSameOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new SyntaxError('Send JSON.');
    const mutation = parseCourseMutation(await request.json());
    if (mutation.action === 'save') await saveCourse(owner, mutation.course);
    else await deleteCourse(owner.userId, mutation.id, mutation.expectedVersion);
    return Response.json({ courses: await listCourses(owner.userId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return courseRouteError(error); }
}
