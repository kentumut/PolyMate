import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { installGoogleEnv } from '../scripts/install-google-env.mjs';

const directories = [];
const secrets = {
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'GOCSPX-test-secret',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  OAUTH_STATE_SECRET: Buffer.alloc(48, 9).toString('base64'),
};

function privateEnv() {
  const directory = mkdtempSync(join(tmpdir(), 'polymate-google-env-'));
  directories.push(directory);
  const path = join(directory, '.env');
  writeFileSync(path, 'APP_ORIGIN=https://07.hackathon.ethz.ch\nAUTH_MODE=managed-proxy\nMANAGED_PROXY_ONLY=true\nPOSTGRES_PASSWORD=0123456789abcdef0123456789abcdef\nGOOGLE_ENABLED=false\nGOOGLE_CLIENT_ID=\nTOKEN_ENCRYPTION_KEY=\nOAUTH_STATE_SECRET=\n', { mode: 0o600 });
  return path;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('install Google production configuration', () => {
  it('preserves other VM settings and installs the Google values with private permissions', () => {
    const path = privateEnv();
    installGoogleEnv(path, secrets);
    const result = readFileSync(path, 'utf8');
    expect(result).toContain('POSTGRES_PASSWORD=0123456789abcdef0123456789abcdef');
    expect(result).toContain(`TOKEN_ENCRYPTION_KEY=${secrets.TOKEN_ENCRYPTION_KEY}`);
    expect(result).toContain('GOOGLE_REDIRECT_URI=https://07.hackathon.ethz.ch/api/integrations/google/callback');
    expect(result).toContain('GOOGLE_ENABLED=true');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const check = spawnSync(process.execPath, [`--env-file=${path}`, 'scripts/config-check.mjs'], { encoding: 'utf8' });
    expect(check.status).toBe(0);
    installGoogleEnv(path, secrets);
    expect(readFileSync(path, 'utf8')).toBe(result);
  });

  it('refuses key rotation without altering the existing file', () => {
    const path = privateEnv();
    installGoogleEnv(path, secrets);
    const before = readFileSync(path, 'utf8');
    expect(() => installGoogleEnv(path, { ...secrets, TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64') })).toThrow('Existing TOKEN_ENCRYPTION_KEY differs');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('rotates a client only when the current ID is explicitly named, preserving encryption keys', () => {
    const path = privateEnv();
    installGoogleEnv(path, secrets);
    const before = readFileSync(path, 'utf8');
    const next = { ...secrets, GOOGLE_CLIENT_ID: 'replacement.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'GOCSPX-replacement' };
    expect(() => installGoogleEnv(path, next)).toThrow('Existing GOOGLE_CLIENT_ID differs');
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(() => installGoogleEnv(path, { ...next, GOOGLE_CLIENT_ROTATION_FROM: 'wrong-client' })).toThrow('Existing GOOGLE_CLIENT_ID differs');
    installGoogleEnv(path, { ...next, GOOGLE_CLIENT_ROTATION_FROM: secrets.GOOGLE_CLIENT_ID });
    const result = readFileSync(path, 'utf8');
    expect(result).toContain(`GOOGLE_CLIENT_ID=${next.GOOGLE_CLIENT_ID}`);
    expect(result).toContain(`TOKEN_ENCRYPTION_KEY=${secrets.TOKEN_ENCRYPTION_KEY}`);
    expect(result).toContain(`OAUTH_STATE_SECRET=${secrets.OAUTH_STATE_SECRET}`);
    installGoogleEnv(path, next);
  });

  it('accepts secret JSON on standard input without printing its values', () => {
    const path = privateEnv();
    const result = spawnSync(process.execPath, ['scripts/install-google-env.mjs', path], {
      input: JSON.stringify(secrets),
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('configuration installed');
    expect(result.stdout).not.toContain(secrets.GOOGLE_CLIENT_SECRET);
    expect(readFileSync(path, 'utf8')).toContain(`GOOGLE_CLIENT_SECRET=${secrets.GOOGLE_CLIENT_SECRET}`);
  });
});
