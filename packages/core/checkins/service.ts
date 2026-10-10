import { dueCheckIns, type CheckInDraft, type CheckInSnapshot } from './rules';

export type CheckInChannelId = 'web' | 'telegram';
export type DeliveryOutcome = Readonly<{ status: 'sent' | 'failed' | 'skipped' | 'unknown'; externalId?: string }>;
export type OpenedCheckIn = Readonly<{ chatId: string; draft: CheckInDraft }>;

/**
 * One way of reaching the student. The chat itself is stored before any channel runs, so a channel
 * only announces it. A future Telegram channel sends `draft.body` with `draft.quickReplies` as buttons
 * and routes the student's reply into the same chat.
 */
export interface CheckInChannel {
  readonly id: CheckInChannelId;
  deliver(ownerId: string, checkIn: OpenedCheckIn): Promise<DeliveryOutcome>;
}

/** The web app reads stored chats directly, so the stored chat is the delivery. */
export const webCheckInChannel: CheckInChannel = { id: 'web', deliver: async () => ({ status: 'sent' }) };

export interface CheckInStore {
  snapshot(ownerId: string, now: Date): Promise<CheckInSnapshot>;
  /** Opens the chat with its first message. Returns null when this question was already asked. */
  open(ownerId: string, draft: CheckInDraft): Promise<string | null>;
  recordDelivery(ownerId: string, chatId: string, channel: CheckInChannelId, outcome: DeliveryOutcome): Promise<void>;
}

/**
 * Opens the check-in chats that are due for one student. Safe to run from a page load and from a
 * timer at once: each question has a dedupe key, so repeated runs never ask it twice.
 */
export async function runCheckIns(ownerId: string, store: CheckInStore, channels: readonly CheckInChannel[], now = new Date(), options: { force?: boolean } = {}): Promise<OpenedCheckIn[]> {
  const opened: OpenedCheckIn[] = [];
  for (const draft of dueCheckIns(await store.snapshot(ownerId, now), now, options)) {
    const chatId = await store.open(ownerId, draft);
    if (!chatId) continue;
    const checkIn = { chatId, draft };
    opened.push(checkIn);
    for (const channel of channels) {
      // A send that may have gone out is never repeated blindly.
      const outcome = await channel.deliver(ownerId, checkIn).catch((): DeliveryOutcome => ({ status: 'unknown' }));
      await store.recordDelivery(ownerId, chatId, channel.id, outcome);
    }
  }
  return opened;
}
