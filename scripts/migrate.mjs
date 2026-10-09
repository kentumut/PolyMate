import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5_000 });
// Override is used by isolated container tests; production uses the versioned SQL directory.
const migrationDir = process.env.MIGRATIONS_DIR
  ? pathToFileURL(`${resolve(process.env.MIGRATIONS_DIR)}${sep}`)
  : new URL('../packages/db/migrations/', import.meta.url);
try {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  await client.connect();
  await client.query("select pg_advisory_lock(hashtext('polymate:migrations'))");
  await client.query('create table if not exists _polymate_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now())');
  const files = (await readdir(migrationDir)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!files.length) console.log('No application migrations yet; OAuth schema is not implemented by this foundation.');
  for (const name of files) {
    const sql = await readFile(new URL(name, migrationDir), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = await client.query('select checksum from _polymate_migrations where name = $1', [name]);
    if (previous.rowCount) {
      if (previous.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
      continue;
    }
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into _polymate_migrations(name, checksum) values($1,$2)', [name, checksum]);
      await client.query('commit');
      console.log(`Applied ${name}`);
    } catch { await client.query('rollback'); throw new Error(`Migration failed: ${name}. Inspect SQL privately.`); }
  }
} catch (error) {
  const message = error instanceof Error && /^(DATABASE_URL|Applied migration|Migration failed)/.test(error.message) ? error.message : 'Migration connection/setup failed; credentials were not printed.';
  console.error(message); process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
