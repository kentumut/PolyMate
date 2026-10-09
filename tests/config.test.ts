import { describe, expect, it } from 'vitest';
// @ts-expect-error The executable config checker is intentionally plain Node JavaScript.
import { validateConfiguration } from '../scripts/config-check.mjs';

const valid = {
  AUTH_MODE: 'managed-proxy', MANAGED_PROXY_ONLY: 'true',
  APP_ORIGIN: 'https://07.hackathon.ethz.ch', POSTGRES_PASSWORD: 'a'.repeat(64),
};
describe('release configuration', () => {
  it('does not require later integrations for the foundation', () => {
    expect(validateConfiguration(valid)).toEqual([]);
  });
  it('rejects development authentication and unsafe origins in production', () => {
    expect(validateConfiguration({ ...valid, AUTH_MODE: 'development' }).length).toBeGreaterThan(0);
    expect(validateConfiguration({ ...valid, APP_ORIGIN: 'http://localhost:3000' }).length).toBeGreaterThan(0);
    expect(validateConfiguration({ ...valid, APP_ORIGIN: `${valid.APP_ORIGIN}/` }).length).toBeGreaterThan(0);
  });
  it('rejects credentials missing from an enabled integration', () => {
    expect(validateConfiguration({ ...valid, GOOGLE_ENABLED: 'true' })).toContain('GOOGLE_CLIENT_ID is required when GOOGLE_ENABLED=true.');
  });
  it('rejects invalid OAuth key material before deployment', () => {
    const config = { ...valid, GOOGLE_ENABLED: 'true', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REDIRECT_URI: `${valid.APP_ORIGIN}/api/integrations/google/callback`, TOKEN_ENCRYPTION_KEY: 'short', OAUTH_STATE_SECRET: 'short' };
    expect(validateConfiguration(config)).toContain('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
    expect(validateConfiguration(config)).toContain('OAUTH_STATE_SECRET must contain at least 32 bytes.');
  });
});
