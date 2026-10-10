'use client';

import type { ChatList as ChatListState, ChatSummary } from '@polymate/contracts/chats';
import { MessagesSquare, Plus, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { fetchChats, mutateChats, unreadCheckIns } from './chat-client';

const CHAT_POLL_MS = 60_000;
const when = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

/**
 * Loads the student's chats and keeps them fresh. Loading the list is also what lets the server
 * open a check-in that has become due, so it is repeated on a timer and whenever the tab regains focus.
 */
export function useChats(sample: boolean) {
  const [state, setState] = useState<ChatListState>({ chats: [], checkInsPaused: false });
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (sample) return;
    try { setState(await fetchChats()); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Chats could not be loaded.'); }
  }, [sample]);

  useEffect(() => {
    if (sample) return;
    const load = () => { if (document.visibilityState === 'visible') void refresh(); };
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(load, CHAT_POLL_MS);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    return () => { window.clearTimeout(first); window.clearInterval(timer); window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', load); };
  }, [refresh, sample]);

  const markRead = useCallback(async (chatId: string) => {
    setState(previous => ({ ...previous, chats: previous.chats.map(chat => chat.id === chatId ? { ...chat, unread: false } : chat) }));
    try { setState(await mutateChats({ action: 'read', chatId })); } catch { /* The next refresh retries. */ }
  }, []);

  const setPaused = useCallback(async (paused: boolean) => {
    try { setState(await mutateChats({ action: 'pause_check_ins', paused })); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'That setting could not be saved.'); }
  }, []);

  const checkInNow = useCallback(async (): Promise<string | null> => {
    try {
      const result = await mutateChats({ action: 'check_in_now' });
      setState({ chats: result.chats, checkInsPaused: result.checkInsPaused }); setError('');
      return result.openedChatId ?? null;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'PolyMate could not check in. Try again.'); return null; }
  }, []);

  return { ...state, error, refresh, markRead, setPaused, checkInNow };
}

export function ChatList({ chats, activeChatId, disabled, onOpen, onNew }: {
  chats: readonly ChatSummary[];
  activeChatId: string;
  disabled: boolean;
  onOpen: (chat: ChatSummary) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const unread = unreadCheckIns(chats, activeChatId).length;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" className="relative text-muted-foreground" aria-label={unread ? `Chats, ${unread} new from PolyMate` : 'Open chats'}>
        <MessagesSquare aria-hidden="true" />
        <span>Chats</span>
        {unread > 0 && <><Badge className="ml-0.5 px-1.5">{unread}</Badge><span className="absolute -right-1 -top-1 size-2.5 animate-pulse rounded-full bg-primary ring-2 ring-background" /></>}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="max-h-[min(36rem,calc(100dvh-5rem))] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto p-0">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-popover px-4 py-3">
        <p className="text-sm font-semibold">Chats</p>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => { setOpen(false); onNew(); }}><Plus aria-hidden="true" /> New chat</Button>
      </div>
      <Separator />
      {!chats.length ? <p className="p-4 text-sm text-muted-foreground">No chats yet. PolyMate will also start one when it has a question for you.</p>
        : <ul className="p-2">{chats.map(chat => <li key={chat.id}>
          <button type="button" disabled={disabled} onClick={() => { setOpen(false); onOpen(chat); }} aria-current={chat.id === activeChatId ? 'true' : undefined}
            className={cn('w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent disabled:opacity-50', chat.id === activeChatId && 'bg-accent')}>
            <span className="flex items-center justify-between gap-2">
              <span className={cn('flex min-w-0 items-center gap-1.5 text-sm', chat.unread ? 'font-semibold' : 'font-medium')}>
                {chat.origin === 'check_in' && <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-label="Started by PolyMate" />}
                <span className="truncate">{chat.title}</span>
              </span>
              {chat.unread ? <Badge className="shrink-0 px-1.5">New</Badge> : <span className="shrink-0 text-[11px] text-muted-foreground">{when(chat.updatedAt)}</span>}
            </span>
            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{chat.preview}</span>
          </button>
        </li>)}</ul>}
    </PopoverContent>
  </Popover>;
}

/** Announces chats PolyMate started. Inline inside the chat view, a floating notice elsewhere. */
export function CheckInNotice({ chats, floating, disabled, onOpen }: {
  chats: readonly ChatSummary[];
  floating: boolean;
  disabled: boolean;
  onOpen: (chat: ChatSummary) => void;
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const visible = chats.filter(chat => !dismissed.has(chat.id));
  const chat = visible[0];
  if (!chat) return null;
  return <div role="status" className={cn('rounded-xl border bg-card p-3.5 text-sm shadow-sm', floating && 'fixed bottom-4 right-4 z-40 w-[min(24rem,calc(100vw-2rem))] shadow-lg')}>
    <div className="flex items-start justify-between gap-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Sparkles className="size-3.5" aria-hidden="true" /> PolyMate started a chat{visible.length > 1 ? ` (and ${visible.length - 1} more)` : ''}</p>
      <button type="button" onClick={() => setDismissed(previous => new Set([...previous, chat.id]))} className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Hide this notice"><X className="size-3.5" aria-hidden="true" /></button>
    </div>
    <p className="mt-1.5 leading-6">{chat.preview}</p>
    <Button type="button" size="sm" className="mt-3" disabled={disabled} onClick={() => onOpen(chat)}>Open chat</Button>
  </div>;
}

export function CheckInSettings({ paused, error, disabled, onPause, onCheckInNow }: {
  paused: boolean;
  error: string;
  disabled: boolean;
  onPause: (paused: boolean) => void;
  onCheckInNow: () => void;
}) {
  return <section className="rounded-xl border bg-card p-6 shadow-sm">
    <h2 className="text-lg font-medium">Check-ins from PolyMate</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">PolyMate starts a chat when it has a question, for example after a study session or before a deadline. At most three a day, never between 22:00 and 08:00.</p>
    <p className="mt-4 text-sm">{paused ? 'Check-ins are paused. PolyMate will not start chats.' : 'Check-ins are on.'}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={disabled} aria-pressed={paused} onClick={() => onPause(!paused)}>{paused ? 'Resume check-ins' : 'Pause check-ins'}</Button>
      <Button type="button" size="sm" disabled={disabled} onClick={onCheckInNow}>Check in with me now</Button>
    </div>
    {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
  </section>;
}
