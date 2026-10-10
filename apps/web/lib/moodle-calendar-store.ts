import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OwnerContext } from '@polymate/core/identity';
import type { MoodleSnapshot } from '@polymate/contracts/moodle';
import { encryptSecret } from '@polymate/core/google-auth/crypto';
import { findMoodleCalendarSubscription, saveMoodleCalendarSubscription, updateMoodleCalendarSnapshot, deleteMoodleCalendarSubscription, type MoodleCalendarSubscription } from '@polymate/db/moodle-calendar';

const local = () => process.env.NODE_ENV === 'development' && !process.env.DATABASE_URL;
const localFile = () => path.join(process.cwd(), '.local', 'moodle-subscriptions.json');
const runtime = globalThis as typeof globalThis & { __moodleCalendarFileQueue?: Promise<unknown> };

async function readLocal(): Promise<Record<string, MoodleCalendarSubscription>> {
  try { return JSON.parse(await readFile(localFile(), 'utf8')) as Record<string, MoodleCalendarSubscription>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw new Error('Local Moodle calendar storage is unavailable.'); }
}

async function editLocal(change: (rows: Record<string, MoodleCalendarSubscription>) => void): Promise<void> {
  const next = (runtime.__moodleCalendarFileQueue ?? Promise.resolve()).catch(() => {}).then(async () => {
    const rows = await readLocal(); change(rows);
    const file = localFile(), temporary = `${file}.${randomUUID()}.tmp`;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(temporary, JSON.stringify(rows), { mode: 0o600 });
    await rename(temporary, file);
  });
  runtime.__moodleCalendarFileQueue = next;
  await next;
}

/** Production uses owner-scoped Postgres; local development can run without a database. */
export async function findCalendarSubscription(ownerId: string): Promise<MoodleCalendarSubscription | null> {
  if (local()) { await runtime.__moodleCalendarFileQueue?.catch(() => {}); return (await readLocal())[ownerId] ?? null; }
  if (!process.env.DATABASE_URL) return null;
  return findMoodleCalendarSubscription(ownerId);
}
export async function saveCalendarSubscription(owner: OwnerContext, input: { site: string; url: string; snapshot: MoodleSnapshot }): Promise<void> {
  if (!local()) return saveMoodleCalendarSubscription(owner, input);
  await editLocal(rows => { rows[owner.userId] = { connectionId: randomUUID(), site: input.site, urlCiphertext: encryptSecret(input.url), snapshot: input.snapshot, lastSyncedAt: input.snapshot.fetchedAt }; });
}
export async function updateCalendarSnapshot(ownerId: string, connectionId: string, snapshot: MoodleSnapshot): Promise<void> {
  if (!local()) return updateMoodleCalendarSnapshot(ownerId, connectionId, snapshot);
  await editLocal(rows => { const row = rows[ownerId]; if (row?.connectionId === connectionId) { row.snapshot = snapshot; row.lastSyncedAt = snapshot.fetchedAt; } });
}
export async function deleteCalendarSubscription(ownerId: string): Promise<void> {
  if (!local()) { if (process.env.DATABASE_URL) await deleteMoodleCalendarSubscription(ownerId); return; }
  await editLocal(rows => { delete rows[ownerId]; });
}
