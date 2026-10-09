import { createHash } from 'node:crypto';

export type OwnerContext = Readonly<{ userId: string; externalId: string; displayName: string }>;
type Environment = Record<string, string | undefined>;

export class IdentityError extends Error {
  constructor(message: string, public readonly status = 401) {
    super(message);
    this.name = 'IdentityError';
  }
}

/** This adapter requires proxy-only ingress; it is not public-header authentication. */
export function resolveOwner(headers: Headers, env: Environment = process.env): OwnerContext {
  const mode = env.AUTH_MODE ?? (env.NODE_ENV === 'development' ? 'development' : 'managed-proxy');
  let externalId: string;
  let displayName: string;

  if (mode === 'development') {
    if (env.NODE_ENV !== 'development') {
      throw new IdentityError('Development identity is disabled outside development.', 503);
    }
    externalId = 'local-student@polymate.invalid';
    displayName = 'Local student';
  } else if (mode === 'managed-proxy') {
    if (env.MANAGED_PROXY_ONLY !== 'true') {
      throw new IdentityError('Managed proxy trust boundary is not configured.', 503);
    }
    externalId = (headers.get('x-user-id') ?? '').trim().toLowerCase();
    if (!/^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(externalId) || externalId.length > 254) {
      throw new IdentityError('Sign in through the managed hackathon address.');
    }
    const rawName = headers.get('x-user-name') ?? externalId;
    try { displayName = decodeURIComponent(rawName); } catch { displayName = rawName; }
    displayName = displayName.slice(0, 150);
  } else {
    throw new IdentityError('Unknown identity mode.', 503);
  }

  // Stable, opaque owner UUID available before Bartek's user repository is integrated.
  const digest = createHash('sha256').update(`polymate:owner:${externalId}`).digest('hex');
  const userId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  return Object.freeze({ userId, externalId, displayName });
}

export function assertSameOrigin(request: Request, env: Environment = process.env): void {
  const configured = env.APP_ORIGIN ?? (env.NODE_ENV === 'development' ? 'http://127.0.0.1:3000' : undefined);
  if (!configured) throw new IdentityError('Application origin is not configured.', 503);
  let expected: string;
  try { expected = new URL(configured).origin; }
  catch { throw new IdentityError('Application origin is invalid.', 503); }
  if (request.headers.get('origin') !== expected) {
    throw new IdentityError('This action must originate from the PolyMate application.', 403);
  }
}
