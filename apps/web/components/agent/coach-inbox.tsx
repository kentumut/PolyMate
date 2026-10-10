'use client';

import type { CoachMessage, CoachingState, StudentMemory } from '@polymate/contracts/coaching';
import { Bell, Brain, ChevronRight, LoaderCircle, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';

export type CoachReplyTarget = Pick<CoachMessage, 'id' | 'title' | 'body'>;

const sampleState: CoachingState = {
  currentWeekStart: '2026-10-05',
  messages: [
    { id: '11111111-1111-4111-8111-111111111111', kind: 'weekly_question', title: 'Protect your existing plans', body: 'What fixed plans or unavailable times should PolyMate work around this week?', requiresResponse: true, status: 'unread', weekStart: '2026-10-05', questionKey: 'commitments', createdAt: '2026-10-05T06:00:00.000Z', respondedAt: null },
    { id: '22222222-2222-4222-8222-222222222222', kind: 'digest', title: 'Your Monday overview', body: 'Two assignments are approaching. Open Chat when you are ready to review the plan.', requiresResponse: false, status: 'read', weekStart: '2026-10-05', questionKey: null, createdAt: '2026-10-05T06:00:00.000Z', respondedAt: null },
  ],
  memories: [{ id: '33333333-3333-4333-8333-333333333333', category: 'plan', content: 'Dinner with friends next Thursday from 19:00.', validUntil: '2026-10-16T00:00:00.000Z', createdAt: '2026-10-05T09:00:00.000Z' }],
};

const memoryLabel: Record<StudentMemory['category'], string> = {
  plan: 'Plan', preference: 'Preference', goal: 'Goal', constraint: 'Constraint', weekly_context: 'Weekly answer',
};

export function CoachInbox({ sample, refreshKey, onRespond, onOutstandingChange }: {
  sample: boolean;
  refreshKey: number;
  onRespond: (message: CoachReplyTarget) => void;
  onOutstandingChange?: (count: number) => void;
}) {
  const [state, setState] = useState<CoachingState | null>(sample ? sampleState : null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (sample) return;
    let current = true;
    fetch('/api/coaching', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        const body = await response.json() as CoachingState & { error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? 'Coaching could not be loaded.');
        return body;
      })
      .then(body => { if (current) { setState(body); setError(''); } })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : 'Coaching could not be loaded.'); });
    return () => { current = false; };
  }, [refreshKey, reloadKey, sample]);

  const messages = state?.messages ?? [];
  const outstanding = messages.filter(item => item.requiresResponse && item.status !== 'responded' && item.status !== 'dismissed');
  const updates = messages.filter(item => !outstanding.includes(item)).slice(0, 3);

  useEffect(() => { onOutstandingChange?.(outstanding.length); }, [onOutstandingChange, outstanding.length]);

  async function forget(memoryId: string) {
    if (sample) { setState(previous => previous ? { ...previous, memories: previous.memories.filter(item => item.id !== memoryId) } : previous); return; }
    setBusyId(memoryId);
    try {
      const response = await fetch('/api/coaching', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'forget', memoryId }) });
      const body = await response.json() as CoachingState & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'Memory could not be removed.');
      setState(body); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Memory could not be removed.'); }
    finally { setBusyId(''); }
  }

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant={outstanding.length ? 'outline' : 'ghost'} className={outstanding.length ? 'relative border-amber-300 bg-amber-50 text-amber-950 shadow-sm hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100' : 'text-muted-foreground'} aria-label={outstanding.length ? `Coach, ${outstanding.length} responses needed` : 'Open coach'}>
        <Bell aria-hidden="true" />
        <span>Coach</span>
        {outstanding.length > 0 && <><Badge variant="warning" className="ml-0.5 border-amber-400 bg-amber-100 px-1.5 text-amber-950 dark:bg-amber-900 dark:text-amber-100">{outstanding.length}</Badge><span className="absolute -right-1 -top-1 size-2.5 animate-pulse rounded-full bg-amber-500 ring-2 ring-background" /></>}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="max-h-[min(42rem,calc(100dvh-5rem))] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto p-0">
      <div className="sticky top-0 z-10 bg-popover px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-sm font-semibold">Weekly coach</p><p className="mt-1 text-xs text-muted-foreground">Context carries forward. You only answer what changed.</p></div>
          {outstanding.length > 0 && <Badge variant="warning">{outstanding.length} to answer</Badge>}
        </div>
      </div>
      <Separator />

      <div className="space-y-4 p-4">
        {error && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error} <button type="button" className="underline" onClick={() => setReloadKey(value => value + 1)}>Retry</button></div>}
        {!state && !error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" /> Loading coaching…</p>}

        {outstanding.length > 0 ? <section aria-label="Responses needed" className="space-y-3">
          {outstanding.map(item => <article key={item.id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Response needed</p>
            <h3 className="mt-1.5 text-sm font-semibold">{item.title}</h3>
            <p className="mt-1.5 text-sm leading-5 text-muted-foreground">{item.body}</p>
            <Button type="button" size="sm" className="mt-3" onClick={() => { setOpen(false); onRespond(item); }}>Respond <ChevronRight aria-hidden="true" /></Button>
          </article>)}
        </section> : state && <div className="rounded-lg bg-muted p-3 text-sm"><p className="font-medium">You’re caught up</p><p className="mt-1 text-muted-foreground">No coaching questions need your response.</p></div>}

        {updates.length > 0 && <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">Recent updates <span className="text-muted-foreground">{updates.length}</span></summary>
          <div className="mt-3 space-y-3">{updates.map(item => <article key={item.id} className="border-l-2 pl-3"><h3 className="text-sm font-medium">{item.title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.body}</p></article>)}</div>
        </details>}

        <Separator />
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden"><span className="flex items-center gap-2"><Brain className="size-4" /> Student memory</span><span className="text-muted-foreground">{state?.memories.length ?? 0}</span></summary>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Plans, constraints, preferences, and goals you asked PolyMate to remember.</p>
          {!state?.memories.length ? <p className="mt-3 text-sm text-muted-foreground">Nothing saved yet.</p> : <ul className="mt-3 space-y-2">{state.memories.map(item => <li key={item.id} className="flex items-start justify-between gap-3 rounded-lg bg-muted p-3">
            <div><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{memoryLabel[item.category]}</p><p className="mt-1 text-sm leading-5">{item.content}</p>{item.validUntil && <p className="mt-1 text-xs text-muted-foreground">Until {new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', dateStyle: 'medium' }).format(new Date(item.validUntil))}</p>}</div>
            <Button type="button" size="icon" variant="ghost" disabled={busyId === item.id} onClick={() => void forget(item.id)} className="size-8" aria-label={`Forget ${item.content}`}><Trash2 aria-hidden="true" /></Button>
          </li>)}</ul>}
        </details>
      </div>
    </PopoverContent>
  </Popover>;
}
