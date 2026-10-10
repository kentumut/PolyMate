import type { OwnerContext } from '@polymate/core/identity';
import type { MoodleSnapshot } from '@polymate/contracts/moodle';
import { encryptSecret } from '@polymate/core/google-auth/crypto';
import { getPool } from './connection';
import { ensureUser } from './google-oauth';

export type MoodleCalendarSubscription = { connectionId: string; site: string; urlCiphertext: string; snapshot: MoodleSnapshot; lastSyncedAt: string };

export async function findMoodleCalendarSubscription(ownerId: string): Promise<MoodleCalendarSubscription | null> {
  const result = await getPool().query<{ connection_id: string; site: string; url_ciphertext: string; snapshot: MoodleSnapshot; last_synced_at: Date }>(
    'SELECT connection_id, site, url_ciphertext, snapshot, last_synced_at FROM moodle_calendar_subscriptions WHERE owner_id = $1', [ownerId]);
  const row = result.rows[0];
  return row ? { connectionId: row.connection_id, site: row.site, urlCiphertext: row.url_ciphertext, snapshot: row.snapshot, lastSyncedAt: row.last_synced_at.toISOString() } : null;
}

export async function saveMoodleCalendarSubscription(owner: OwnerContext, input: { site: string; url: string; snapshot: MoodleSnapshot }): Promise<void> {
  await ensureUser(owner);
  await getPool().query(`INSERT INTO moodle_calendar_subscriptions (owner_id, site, url_ciphertext, snapshot, last_synced_at)
    VALUES ($1, $2, $3, $4, $5) ON CONFLICT (owner_id) DO UPDATE SET connection_id = gen_random_uuid(),
    site = EXCLUDED.site, url_ciphertext = EXCLUDED.url_ciphertext, snapshot = EXCLUDED.snapshot, last_synced_at = EXCLUDED.last_synced_at, updated_at = now()`,
  [owner.userId, input.site, encryptSecret(input.url), JSON.stringify(input.snapshot), input.snapshot.fetchedAt]);
}

export async function updateMoodleCalendarSnapshot(ownerId: string, connectionId: string, snapshot: MoodleSnapshot): Promise<void> {
  await getPool().query('UPDATE moodle_calendar_subscriptions SET snapshot = $3, last_synced_at = $4, updated_at = now() WHERE owner_id = $1 AND connection_id = $2',
    [ownerId, connectionId, JSON.stringify(snapshot), snapshot.fetchedAt]);
}

export async function deleteMoodleCalendarSubscription(ownerId: string): Promise<void> {
  await getPool().query('DELETE FROM moodle_calendar_subscriptions WHERE owner_id = $1', [ownerId]);
}
