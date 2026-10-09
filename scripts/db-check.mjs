import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3_000 });
try {
  if (!process.env.DATABASE_URL) throw new Error();
  await client.connect();
  await client.query('select 1');
  console.log('Database connection is ready.');
} catch { console.error('Database connection check failed. Verify DATABASE_URL privately.'); process.exitCode = 1; }
finally { await client.end().catch(() => {}); }
