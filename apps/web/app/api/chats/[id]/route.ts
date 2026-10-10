import type { NextRequest } from 'next/server';
import { parseChatId } from '@polymate/contracts/chats';
import { resolveOwner } from '@polymate/core/identity';
import { getChat } from '@polymate/db/chats';
import { chatRouteError } from '@/lib/chats';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/chats/[id]'>) {
  try {
    const owner = resolveOwner(request.headers);
    const { id } = await ctx.params;
    return Response.json(await getChat(owner.userId, parseChatId(id)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return chatRouteError(error); }
}
