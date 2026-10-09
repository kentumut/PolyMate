import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [mode, directory] = process.argv.slice(2);
const files = ['database.dump', 'release.txt', 'database-version.txt', 'README.txt'];
try {
  if (!directory || !['write', 'verify'].includes(mode)) throw new Error('Usage: backup-manifest.mjs write|verify <directory>');
  const lines = [];
  for (const name of files) {
    const hash = createHash('sha256').update(await readFile(join(directory, name))).digest('hex');
    lines.push(`${hash}  ${name}`);
  }
  const manifest = `${lines.join('\n')}\n`;
  const path = join(directory, 'SHA256SUMS');
  if (mode === 'write') await writeFile(path, manifest, { mode: 0o600 });
  else if (await readFile(path, 'utf8') !== manifest) throw new Error('Backup checksum mismatch; restore was not started.');
  console.log(`Backup manifest ${mode === 'write' ? 'created' : 'verified'}.`);
} catch (error) {
  console.error(error.message === 'Backup checksum mismatch; restore was not started.' ? error.message : 'Backup manifest could not be processed.');
  process.exitCode = 1;
}
