import type { NextRequest } from 'next/server';
import { parseChatMutation } from '@polymate/contracts/chats';
import { assertSameOrigin, resolveOwner } from '@polymate/core/identity';
import { markChatRead, setCheckInsPaused } from '@polymate/db/chats';
import { ensureUser } from '@polymate/db/google-oauth';
import { chatListFor, chatRouteError, runCheckInsFor } from '@/lib/chats';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    return Response.json(await chatListFor(owner), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return chatRouteError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const owner = resolveOwner(request.headers);
    assertSameOrigin(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new SyntaxError('Send JSON.');
    const mutation = parseChatMutation(await request.json());
    let openedChatId: string | null = null;
    if (mutation.action === 'read') await markChatRead(owner.userId, mutation.chatId);
    else if (mutation.action === 'pause_check_ins') await setCheckInsPaused(owner, mutation.paused);
    else {
      // The student asked for this check-in, so the unsolicited-message limits do not apply.
      await ensureUser(owner);
      openedChatId = (await runCheckInsFor(owner.userId, new Date(), { force: true }))[0]?.chatId ?? null;
    }
    return Response.json({ ...await chatListFor(owner), openedChatId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return chatRouteError(error); }
}
