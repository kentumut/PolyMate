import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deleteCalendarSubscription, findCalendarSubscription, saveCalendarSubscription, updateCalendarSnapshot } from '../apps/web/lib/moodle-calendar-store';
import { decryptSecret } from '../packages/core/integrations/google-auth/crypto';
import type { MoodleSnapshot } from '../packages/contracts/src/moodle';

let directory: string;
const snapshot: MoodleSnapshot = { source: 'calendar-subscription', assignments: [], announcements: [], courses: [], calendarEvents: [], warnings: [], fetchedAt: '2026-10-10T08:00:00Z' };
const owner = { userId: 'owner-one', externalId: 'one@example.test', displayName: 'One' };
const url = 'https://moodle.test/calendar/export_execute.php?userid=1&authtoken=private-secret';
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'polymate-moodle-store-'));
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'));
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
it('persists encrypted URLs per owner, guards stale refreshes, and deletes only the selected connection', async () => {
  await Promise.all([
    saveCalendarSubscription(owner, { site: 'https://moodle.test', url, snapshot }),
    saveCalendarSubscription({ ...owner, userId: 'owner-two' }, { site: 'https://moodle.test', url, snapshot }),
  ]);
  const disk = await readFile(path.join(directory, '.local', 'moodle-subscriptions.json'), 'utf8');
  expect(disk).not.toContain('private-secret'); expect(disk).not.toContain(url);
  const initial = (await findCalendarSubscription(owner.userId))!;
  expect(decryptSecret(initial.urlCiphertext)).toBe(url); expect(await findCalendarSubscription('missing')).toBeNull();
  await saveCalendarSubscription(owner, { site: 'https://moodle.test', url, snapshot });
  const next = (await findCalendarSubscription(owner.userId))!;
  expect(next.connectionId).not.toBe(initial.connectionId);
  await updateCalendarSnapshot(owner.userId, initial.connectionId, { ...snapshot, fetchedAt: '2026-10-11T08:00:00Z' });
  expect((await findCalendarSubscription(owner.userId))!.lastSyncedAt).toBe(snapshot.fetchedAt);
  await updateCalendarSnapshot(owner.userId, next.connectionId, { ...snapshot, fetchedAt: '2026-10-12T08:00:00Z' });
  expect((await findCalendarSubscription(owner.userId))!.lastSyncedAt).toBe('2026-10-12T08:00:00Z');
  await deleteCalendarSubscription(owner.userId);
  expect(await findCalendarSubscription(owner.userId)).toBeNull(); expect(await findCalendarSubscription('owner-two')).not.toBeNull();
});
