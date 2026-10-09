const base = process.env.SMOKE_ORIGIN ?? 'http://127.0.0.1:8080';
try {
  for (const path of ['/api/health/live', '/api/health/ready']) {
    const response = await fetch(new URL(path, base), { redirect: 'manual', signal: AbortSignal.timeout(8_000) });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error(`Health check failed: ${path}`);
    const body = await response.json();
    if (!['ok', 'ready'].includes(body.status)) throw new Error(`Unexpected health state: ${path}`);
    if (path.endsWith('/live') && process.env.EXPECTED_RELEASE_SHA && body.release !== process.env.EXPECTED_RELEASE_SHA) throw new Error('The running release does not match the requested commit.');
  }
  if (process.env.SMOKE_MANAGED_IDENTITY === 'true') {
    const response = await fetch(new URL('/api/identity', base), { redirect: 'manual', signal: AbortSignal.timeout(8_000) });
    if (response.status !== 401) throw new Error('Direct requests without proxy identity must be rejected.');
  }
  console.log('Liveness, database readiness, and requested release/identity checks passed.');
} catch (error) { console.error(error instanceof Error ? error.message : 'Smoke check failed.'); process.exitCode = 1; }
