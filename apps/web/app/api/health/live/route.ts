export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ status: 'ok', release: process.env.RELEASE_SHA ?? 'development' }, { headers: { 'Cache-Control': 'no-store' } });
}
