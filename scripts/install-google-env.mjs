import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const secretNames = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY', 'OAUTH_STATE_SECRET'];
const managedNames = [...secretNames, 'GOOGLE_REDIRECT_URI', 'GOOGLE_ENABLED'];
const stableNames = ['GOOGLE_CLIENT_ID', 'TOKEN_ENCRYPTION_KEY', 'OAUTH_STATE_SECRET'];

export function installGoogleEnv(path, input) {
  if (!existsSync(path)) throw new Error('The private VM .env is missing.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a JSON object of Google secrets.');
  const secret = Object.fromEntries(secretNames.map(name => [name, input[name]]));
  for (const name of secretNames) {
    if (typeof secret[name] !== 'string' || !/^[A-Za-z0-9._~+\/-]+={0,2}$/.test(secret[name])) {
      throw new Error(`${name} must be present and safe for .env files.`);
    }
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(secret.TOKEN_ENCRYPTION_KEY) ||
      Buffer.from(secret.TOKEN_ENCRYPTION_KEY, 'base64').length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes.');
  }
  if (Buffer.byteLength(secret.OAUTH_STATE_SECRET) < 32) {
    throw new Error('OAUTH_STATE_SECRET must contain at least 32 bytes.');
  }

  const current = readFileSync(path, 'utf8');
  const lines = current.split(/\r?\n/);
  const old = new Map();
  for (const line of lines) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match && managedNames.includes(match[1])) {
      if (old.has(match[1])) throw new Error(`Duplicate ${match[1]} in the private .env.`);
      old.set(match[1], match[2]);
    }
  }
  for (const name of stableNames) {
    if (old.get(name) && old.get(name) !== secret[name]) {
      throw new Error(`Existing ${name} differs. Reconcile it privately before deploying.`);
    }
  }

  const origin = /^APP_ORIGIN=(.+)$/m.exec(current)?.[1];
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || parsed.origin !== origin) throw new Error();
  } catch {
    throw new Error('The private .env needs a canonical HTTPS APP_ORIGIN.');
  }
  const updated = {
    ...secret,
    GOOGLE_REDIRECT_URI: `${origin}/api/integrations/google/callback`,
    GOOGLE_ENABLED: 'true',
  };
  const kept = lines.filter(line => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    return !match || !managedNames.includes(match[1]);
  });
  while (kept.at(-1) === '') kept.pop();
  const contents = `${kept.join('\n')}\n${managedNames.map(name => `${name}=${updated[name]}`).join('\n')}\n`;
  const temporary = `${path}.${process.pid}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, contents);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

if (process.argv[1]?.endsWith('/install-google-env.mjs')) {
  try {
    let json = '';
    for await (const chunk of process.stdin) json += chunk;
    let input;
    try {
      input = JSON.parse(json);
    } catch {
      throw new Error('Invalid Google secret payload.');
    }
    installGoogleEnv(resolve(process.argv[2] ?? '.env'), input);
    console.log('Google production configuration installed. Secret values were not printed.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Could not install Google production configuration.');
    process.exitCode = 1;
  }
}
