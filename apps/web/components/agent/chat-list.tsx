'use client';

import type { ChatList as ChatListState, ChatSummary } from '@polymate/contracts/chats';
import { MessagesSquare, PanelLeftClose, PanelLeftOpen, Plus, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { fetchChats, mutateChats } from './chat-client';
import { useCollapsedPanel } from './collapsible-panel';

const CHAT_POLL_MS = 60_000;
const chatTime = (value: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Zurich', weekday: 'short', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));

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

function ChatHistoryContent({ chats, activeChatId, demo, disabled, onOpenChat, onNewChat, onCollapse }: {
  chats: readonly ChatSummary[];
  activeChatId: string;
  demo: boolean;
  disabled: boolean;
  onOpenChat: (chat: ChatSummary) => void;
  onNewChat: () => void;
  onCollapse?: () => void;
}) {
  const activeChatIsSaved = chats.some(chat => chat.id === activeChatId);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex items-center justify-between gap-3 px-3 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold">Chats</p>
        <p className="mt-0.5 text-xs text-muted-foreground">Your conversations with PolyMate</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button type="button" size="icon" variant="outline" className="size-8" disabled={disabled} onClick={onNewChat} aria-label="Start a new chat"><Plus aria-hidden="true" /></Button>
        {onCollapse && <Button type="button" size="icon" variant="ghost" className="size-8 text-muted-foreground" onClick={onCollapse} aria-label="Collapse chat history" title="Collapse chat history"><PanelLeftClose aria-hidden="true" /></Button>}
      </div>
    </div>
    <Separator />
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {!activeChatIsSaved && <div aria-current="true" className="mb-1 rounded-lg bg-accent px-3 py-2.5">
        <p className="truncate text-sm font-medium">{demo ? 'Guided demo' : 'New conversation'}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{demo ? 'Explore planning, memory, and calendar actions.' : 'Messages in this chat will appear here.'}</p>
      </div>}
      {!chats.length && activeChatIsSaved && <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No previous conversations yet.</p>}
      <ul className="space-y-1">
        {chats.map(chat => <li key={chat.id}>
          <button type="button" disabled={disabled} onClick={() => onOpenChat(chat)} aria-current={chat.id === activeChatId ? 'true' : undefined} className={cn('w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent disabled:opacity-50', chat.id === activeChatId && 'bg-accent')}>
            <span className="flex items-center justify-between gap-2">
              <span className={cn('flex min-w-0 items-center gap-1.5 text-sm', chat.unread ? 'font-semibold' : 'font-medium')}>
                {chat.origin === 'check_in' && <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-label="Started by PolyMate" />}
                <span className="truncate">{chat.title}</span>
              </span>
              {chat.unread ? <Badge className="shrink-0 px-1.5">New</Badge> : <span className="shrink-0 text-[11px] text-muted-foreground">{chatTime(chat.updatedAt)}</span>}
            </span>
            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">{chat.preview}</span>
          </button>
        </li>)}
      </ul>
    </div>
  </div>;
}

/** Conversation navigation lives beside Chat; on small screens it collapses into a compact popover. */
export function ChatHistoryRail({ chats, activeChatId, demo = false, disabled, onOpenChat, onNewChat }: {
  chats: readonly ChatSummary[];
  activeChatId: string;
  demo?: boolean;
  disabled: boolean;
  onOpenChat: (chat: ChatSummary) => void;
  onNewChat: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useCollapsedPanel('chats');
  const unread = chats.some(chat => chat.unread);
  const openChat = (chat: ChatSummary) => { setMobileOpen(false); onOpenChat(chat); };
  const startChat = () => { setMobileOpen(false); onNewChat(); };

  return <>
    <div className="flex h-12 shrink-0 items-center justify-between border-b bg-muted/20 px-2 md:hidden">
      <Popover open={mobileOpen} onOpenChange={setMobileOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="ghost" size="sm" aria-label="Open chat history"><MessagesSquare aria-hidden="true" /> Chats</Button>
        </PopoverTrigger>
        <PopoverContent align="start" side="bottom" className="flex max-h-[min(34rem,calc(100dvh-8rem))] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden p-0">
          <ChatHistoryContent chats={chats} activeChatId={activeChatId} demo={demo} disabled={disabled} onOpenChat={openChat} onNewChat={startChat} />
        </PopoverContent>
      </Popover>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={startChat}><Plus aria-hidden="true" /> New chat</Button>
    </div>
    {collapsed
      ? <aside className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r bg-muted/20 py-3 md:flex" aria-label="Chat history">
        <Button type="button" size="icon" variant="ghost" className="relative size-8 text-muted-foreground" onClick={toggleCollapsed} aria-label={unread ? 'Expand chat history, new messages' : 'Expand chat history'} aria-expanded={false} title="Expand chat history">
          <PanelLeftOpen aria-hidden="true" />
          {unread && <span className="absolute top-1 right-1 size-2 rounded-full bg-primary" aria-hidden="true" />}
        </Button>
        <Button type="button" size="icon" variant="outline" className="size-8" disabled={disabled} onClick={onNewChat} aria-label="Start a new chat" title="New chat"><Plus aria-hidden="true" /></Button>
      </aside>
      : <aside className="hidden w-64 shrink-0 border-r bg-muted/20 md:flex md:min-h-0 md:flex-col xl:w-72" aria-label="Chat history">
        <ChatHistoryContent chats={chats} activeChatId={activeChatId} demo={demo} disabled={disabled} onOpenChat={onOpenChat} onNewChat={onNewChat} onCollapse={toggleCollapsed} />
      </aside>}
  </>;
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
