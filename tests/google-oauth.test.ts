import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthorization, consumeCallbackState, exchangeAuthorizationCode, refreshAccessToken, verifyGoogleCalendarAccess, type OAuthStateStore } from '../packages/core/integrations/google-auth/oauth';
import { decryptSecret, encryptSecret, openBrowserBinding, sealBrowserBinding } from '../packages/core/integrations/google-auth/crypto';

afterEach(() => vi.unstubAllEnvs());

describe('Google OAuth state', () => {
  it('binds a one-use state to the same browser and expires it', async () => {
    let saved: { ownerId: string; stateHash: Buffer; browserBindingHash: Buffer; expiresAt: Date } | undefined;
    const store: OAuthStateStore = {
      async create(input) { saved = input; },
      async consume(input) {
        if (!saved || input.now >= saved.expiresAt ||
            !input.stateHash.equals(saved.stateHash) || !input.browserBindingHash.equals(saved.browserBindingHash)) return null;
        const ownerId = saved.ownerId;
        saved = undefined;
        return ownerId;
      },
    };
    const now = new Date('2026-10-09T12:00:00Z');
    const result = await createAuthorization({ ownerId: 'owner-a', browserBinding: '', store,
      config: { clientId: 'client-a', redirectUri: 'https://example.test/callback' }, now });
    const state = new URL(result.url).searchParams.get('state')!;
    expect(saved?.stateHash.toString()).not.toContain(state);
    expect(saved?.expiresAt.toISOString()).toBe('2026-10-09T12:10:00.000Z');
    await expect(consumeCallbackState({ state, browserBinding: 'other', store, now })).rejects.toThrow();
    expect(await consumeCallbackState({ state, browserBinding: result.browserBinding, store, now })).toBe('owner-a');
    await expect(consumeCallbackState({ state, browserBinding: result.browserBinding, store, now })).rejects.toThrow();
  });

  it('rejects altered browser cookies', () => {
    vi.stubEnv('OAUTH_STATE_SECRET', 'this-is-a-long-random-test-secret-value');
    const sealed = sealBrowserBinding('browser-nonce');
    expect(openBrowserBinding(sealed)).toBe('browser-nonce');
    expect(openBrowserBinding(`${sealed}changed`)).toBeNull();
  });
});

describe('Google credentials', () => {
  it('encrypts tokens and rejects tampering', () => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
    const encrypted = encryptSecret('refresh-secret');
    expect(encrypted).not.toContain('refresh-secret');
    expect(decryptSecret(encrypted)).toBe('refresh-secret');
    expect(() => decryptSecret(`${encrypted}x`)).toThrow();
  });

  it('exchanges and refreshes tokens with the correct grant types', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as URLSearchParams;
      if (body.get('grant_type') === 'authorization_code') {
        expect(body.get('code')).toBe('code-a');
        return Response.json({ access_token: 'access-a', refresh_token: 'refresh-a', expires_in: 3600, scope: 'calendar' });
      }
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('refresh-a');
      return Response.json({ access_token: 'access-b', expires_in: 3600 });
    });
    const exchanged = await exchangeAuthorizationCode({ code: 'code-a', clientId: 'id', clientSecret: 'secret',
      redirectUri: 'https://example.test/callback', fetcher });
    expect(exchanged.refreshToken).toBe('refresh-a');
    const refreshed = await refreshAccessToken({ refreshToken: 'refresh-a', clientId: 'id', clientSecret: 'secret', fetcher });
    expect(refreshed.accessToken).toBe('access-b');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('verifies primary-calendar access before accepting a connection', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain('/calendars/primary/events?');
      return Response.json({ items: [] });
    });

    await expect(verifyGoogleCalendarAccess({
      accessToken: async () => 'access-a', fetcher, now: new Date('2026-10-10T12:00:00Z'),
    })).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects a connection when Google does not grant Calendar access', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: { errors: [{ reason: 'insufficientPermissions' }] } }, { status: 403 }));
    await expect(verifyGoogleCalendarAccess({ accessToken: async () => 'access-a', fetcher })).rejects.toThrow('Google Calendar must be connected.');
  });
});
