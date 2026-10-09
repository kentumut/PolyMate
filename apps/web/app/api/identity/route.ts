import { IdentityError, resolveOwner } from '@polymate/core/identity';

export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  try {
    const owner = resolveOwner(request.headers);
    return Response.json({ userId: owner.userId, displayName: owner.displayName }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof IdentityError ? error.status : 500;
    return Response.json({ error: { code: 'IDENTITY_UNAVAILABLE', message: 'Managed sign-in is required.' } }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
