import { ContractError } from '@polymate/contracts/calendar';
import type { ChatList } from '@polymate/contracts/chats';
import { runCheckIns, webCheckInChannel, type CheckInChannel } from '@polymate/core/checkins';
import { IdentityError, type OwnerContext } from '@polymate/core/identity';
import { ChatNotFound, checkInStore, checkInsPaused, listChats } from '@polymate/db/chats';
import { ensureUser } from '@polymate/db/google-oauth';

/** Every channel a check-in is announced on. A Telegram channel is added here once pairing exists. */
export const checkInChannels: readonly CheckInChannel[] = [webCheckInChannel];

export function runCheckInsFor(ownerId: string, now = new Date(), options: { force?: boolean } = {}) {
  return runCheckIns(ownerId, checkInStore, checkInChannels, now, options);
}

/**
 * The student's chats, after opening any check-in that has become due. A failed check-in run
 * never hides existing chats.
 */
export async function chatListFor(owner: OwnerContext, now = new Date()): Promise<ChatList> {
  await ensureUser(owner);
  try { await runCheckInsFor(owner.userId, now); }
  catch (error) { console.error('Check-in run failed.', error instanceof Error ? error.name : 'unknown error'); }
  const [chats, paused] = await Promise.all([listChats(owner.userId), checkInsPaused(owner.userId)]);
  return { chats, checkInsPaused: paused };
}

export function chatRouteError(error: unknown): Response {
  let status = 500; let code = 'chats_unavailable'; let message = 'Chats are unavailable. Please retry.';
  if (error instanceof IdentityError) [status, code, message] = [error.status, 'identity', error.message];
  else if (error instanceof ContractError) [status, code, message] = [422, 'validation', error.message];
  else if (error instanceof ChatNotFound) [status, code, message] = [404, 'not_found', error.message];
  else if (error instanceof SyntaxError) [status, code, message] = [422, 'validation', 'Send valid JSON.'];
  else console.error('Chat request failed.', error instanceof Error ? error.name : typeof error);
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}
