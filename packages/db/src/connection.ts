import { Pool } from 'pg';

const globalDb = globalThis as typeof globalThis & { polymatePool?: Pool };

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
  if (!globalDb.polymatePool) {
    globalDb.polymatePool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 3_000,
    });
    globalDb.polymatePool.on('error', () => console.error('Database pool connection failed.'));
  }
  return globalDb.polymatePool;
}

export async function databaseReady(): Promise<boolean> {
  try {
    await getPool().query('select 1');
    return true;
  } catch { return false; }
}
