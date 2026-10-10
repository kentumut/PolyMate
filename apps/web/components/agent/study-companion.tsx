'use client';

import type { AssignmentTimeline, MoodleSnapshot } from '@polymate/contracts/moodle';
import { useRef, useState, type FormEvent } from 'react';
import { CalendarStudyWorkflow } from '@/components/study/calendar-study-workflow';
import { AssignmentsPanel } from '@/components/study/assignments-panel';
import { GoogleConnection } from '@/components/connections/google-connection';
import { MoodleConnection } from '@/components/connections/moodle-connection';
import { MoodleCalendarPreview } from '@/components/connections/moodle-calendar-preview';

type AgentCard = { kind: 'assignments' | 'timeline' | 'schedule' | 'connections'; data: unknown };
type PendingPlan = { timeline: AssignmentTimeline; expiresAt: string };
type ChatMessage = { id: number; role: 'user' | 'assistant'; text: string; cards: AgentCard[] };
type ChatResponse = { reply: string; cards?: AgentCard[]; pendingPlan?: PendingPlan | null; reloadCalendar?: boolean; error?: { message?: string } };

const dateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
};

function safeSource(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}

function AssignmentCards({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null;
  const snapshot = data as MoodleSnapshot;
  if (snapshot.source === 'calendar-subscription') return <section className="mt-3 rounded-xl border border-[#dce3db] bg-white p-4"><h3 className="text-sm font-semibold">Moodle calendar events</h3><MoodleCalendarPreview snapshot={snapshot} /></section>;
  const assignments = Array.isArray(snapshot.assignments) ? snapshot.assignments : [];
  const announcements = Array.isArray(snapshot.announcements) ? snapshot.announcements : [];
  return <section className="mt-3 space-y-3 rounded-xl border border-[#dce3db] bg-[#fbfcf9] p-4" aria-label="Moodle source results">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">Moodle assignments</h3>
      {typeof snapshot.fetchedAt === 'string' && <p className="text-xs text-[#748278]">Retrieved {dateTime(snapshot.fetchedAt)}</p>}</div>
    {assignments.length ? <ul className="space-y-2">{assignments.map(item => <li key={item.id} className="rounded-lg bg-white p-3 text-sm">
      <p className="font-medium">{item.courseName}: {item.title}</p>
      <p className="mt-1 text-xs text-[#617269]">Deadline: {item.dueAt ? dateTime(item.dueAt) : 'No verified deadline'}</p>
      {safeSource(item.sourceUrl) && <a className="mt-1 inline-block text-xs underline" href={safeSource(item.sourceUrl)!} target="_blank" rel="noreferrer">Open in Moodle</a>}
    </li>)}</ul> : <p className="text-sm text-[#617269]">No assignments were returned.</p>}
    {announcements.length > 0 && <div className="border-t border-[#e5eae4] pt-3"><h4 className="text-sm font-semibold">Course announcements</h4><ul className="mt-2 space-y-2">{announcements.map(item => <li key={item.id} className="rounded-lg bg-white p-3 text-sm">
      <p className="font-medium">{item.title}</p><p className="mt-1 text-xs text-[#617269]">Posted {dateTime(item.postedAt)}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{item.text}</p>
      {safeSource(item.sourceUrl) && <a className="mt-2 inline-block text-xs underline" href={safeSource(item.sourceUrl)!} target="_blank" rel="noreferrer">Open announcement</a>}
    </li>)}</ul></div>}
    {Array.isArray(snapshot.warnings) && snapshot.warnings.map((warning, index) => <p key={index} className="text-xs text-[#8a5a26]">{warning}</p>)}
  </section>;
}

function ScheduleCard({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null;
  const value = data as { timeline?: AssignmentTimeline; movedBlock?: { title: string; startAt: string; endAt: string }; result?: { complete?: boolean; results?: Array<{ operationId: string; status: string; error?: { message?: string } }> } };
  const results = Array.isArray(value.result?.results) ? value.result.results : [];
  const attempted = new Set(results.map(item => item.operationId));
  const unattempted = value.timeline?.blocks.filter(block => !attempted.has(block.operationId)) ?? [];
  return <section className="mt-3 rounded-xl border border-[#dce3db] bg-[#fbfcf9] p-4" aria-label="Calendar write results">
    <h3 className="text-sm font-semibold">Calendar sync results</h3>
    {results.length ? <ul className="mt-2 space-y-2">{results.map((item, index) => <li key={`${item.operationId}-${index}`} className="flex gap-2 text-sm">
      <span aria-hidden="true">{item.status === 'synced' ? '✓' : item.status === 'unknown' ? '?' : '!'}</span>
      <span>{(() => {
        const block = value.timeline?.blocks.find(block => block.operationId === item.operationId) ?? value.movedBlock;
        return block ? <span className="block">{block.title} · {dateTime(block.startAt)}–{dateTime(block.endAt)}</span> : null;
      })()}<strong className="capitalize">{item.status}</strong>{item.error?.message ? ` — ${item.error.message}` : ''}</span>
    </li>)}</ul> : <p className="mt-2 text-sm text-[#617269]">No calendar writes were confirmed.</p>}
    {unattempted.length > 0 && <ul className="mt-3 space-y-1 text-sm text-[#8a5a26]">{unattempted.map(block => <li key={block.operationId}>{block.title} · {dateTime(block.startAt)} — not attempted</li>)}</ul>}
    {value.result?.complete && <p className="mt-3 text-sm font-medium text-[#173b32]">{value.movedBlock ? 'The move was confirmed by Google Calendar.' : 'All planned blocks were confirmed by Google Calendar.'}</p>}
  </section>;
}

function OtherCards({ cards }: { cards: AgentCard[] }) {
  return <>
    {cards.map((card, index) => {
      if (card.kind === 'assignments') return <AssignmentCards key={`assignments-${index}`} data={card.data} />;
      if (card.kind === 'schedule') return <ScheduleCard key={`schedule-${index}`} data={card.data} />;
      if (card.kind === 'connections' && card.data && typeof card.data === 'object') {
        const value = card.data as { moodleConnected?: boolean; googleCalendarConnected?: boolean; backgroundMoodleAvailable?: boolean; note?: string };
        return <div key={`connections-${index}`} className="mt-3 rounded-xl bg-[#edf0e7] p-4 text-sm">
          <p>Moodle calendar: {value.moodleConnected ? 'subscription connected' : 'not connected'}.</p>
          <p>Google Calendar: {value.googleCalendarConnected ? 'connected' : 'not connected'}.</p>
          {!value.backgroundMoodleAvailable && <p className="mt-2 text-xs text-[#617269]">Connect a Moodle calendar subscription to enable scheduled calendar checks.</p>}
          {value.note && <p className="mt-2 text-xs text-[#617269]">{value.note}</p>}
        </div>;
      }
      return null;
    })}
  </>;
}

function TimelinePreview({ plan, onSchedule, busy }: { plan: PendingPlan; onSchedule: (partial: boolean) => void; busy: boolean }) {
  const timeline = plan.timeline;
  const unscheduled = timeline.unscheduled.length > 0;
  return <section className="rounded-2xl border border-[#b9cbbd] bg-[#f5f8f2] p-5" aria-label="Current study timeline draft">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-widest text-[#658071]">Draft timeline</p>
      <p className="mt-1 text-sm text-[#617269]">Effort is an estimate. Times are shown in Europe/Zurich.</p></div>
      <p className="text-xs text-[#748278]">Expires {dateTime(plan.expiresAt)}</p></div>
    {timeline.blocks.length ? <ol className="mt-4 space-y-2">{timeline.blocks.map((block, index) => <li key={`${block.operationId}-${index}`} className="rounded-xl bg-white p-3">
      <p className="text-sm font-medium">{block.title}</p><p className="mt-1 text-xs text-[#617269]">{dateTime(block.startAt)}–{dateTime(block.endAt)} · {Math.round((Date.parse(block.endAt) - Date.parse(block.startAt)) / 60_000)} min</p>
      {safeSource(block.sourceUrl) && <a className="mt-1 inline-block text-xs underline" href={safeSource(block.sourceUrl)!} target="_blank" rel="noreferrer">Moodle source</a>}
    </li>)}</ol> : <p className="mt-4 rounded-xl bg-white p-3 text-sm">No study blocks fit those constraints.</p>}
    {unscheduled && <div className="mt-3 rounded-xl border border-[#e7d7b9] bg-[#fffaf0] p-3"><h3 className="text-sm font-semibold">Work not scheduled</h3>
      <ul className="mt-2 space-y-1 text-sm">{timeline.unscheduled.map((item, index) => <li key={`${item.assignmentId}-${index}`}>Entry {item.assignmentId}: {item.remainingMinutes} min remain — {item.reason}</li>)}</ul>
    </div>}
    {timeline.warnings.map((warning, index) => <p key={index} className="mt-2 text-xs text-[#8a5a26]">{warning}</p>)}
    <div className="mt-4 flex flex-wrap gap-2">
      {!unscheduled && timeline.blocks.length > 0 && <button type="button" disabled={busy} onClick={() => onSchedule(false)} className="rounded-xl bg-[#173b32] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Add to calendar</button>}
      {unscheduled && timeline.blocks.length > 0 && <button type="button" disabled={busy} onClick={() => onSchedule(true)} className="rounded-xl bg-[#173b32] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Add only the blocks that fit</button>}
      <button type="button" disabled={busy} onClick={() => document.getElementById('agent-message')?.focus()} className="rounded-xl border border-[#cbd7ce] px-4 py-2 text-sm disabled:opacity-50">Revise constraints</button>
    </div>
  </section>;
}

export function StudyCompanion({ sample, ownerName }: { sample: boolean; ownerName: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const nextId = useRef(0);

  async function sendMessage(event?: FormEvent, action?: { allowPartial: boolean }) {
    event?.preventDefault();
    if (busy || (!action && !input.trim())) return;
    const text = action ? (action.allowPartial ? 'Add only the blocks that fit to my calendar.' : 'Add this timeline to my calendar.') : input.trim();
    const id = ++nextId.current;
    setMessages(previous => [...previous, { id, role: 'user', text, cards: [] }].slice(-40) as ChatMessage[]);
    setInput(''); setBusy(true); setError('');
    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify(action ? { action: 'schedule_current_plan', allowPartial: action.allowPartial, timelineId: pendingPlan?.timeline.id } : { message: text }),
      });
      const body = await response.json() as ChatResponse;
      if (!response.ok) throw new Error(body.error?.message ?? 'PolyMate could not answer. Try again.');
      setMessages(previous => [...previous, { id: ++nextId.current, role: 'assistant', text: body.reply, cards: body.cards ?? [] }].slice(-40) as ChatMessage[]);
      setPendingPlan(body.pendingPlan ?? null);
      if (body.reloadCalendar) setReloadKey(value => value + 1);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'PolyMate could not answer. Try again.';
      setError(message);
      if (action) setMessages(previous => [...previous, { id: ++nextId.current, role: 'assistant', text: message, cards: [] }]);
    } finally { setBusy(false); }
  }

  return <div className="grid gap-5 xl:grid-cols-[minmax(340px,0.88fr)_minmax(0,1.12fr)]">
    <section className="min-w-0 space-y-5">
      <MoodleConnection />
      <section className="rounded-2xl border border-[#dce3db] bg-white p-5 text-center"><h2 className="text-sm font-semibold">Google Calendar</h2><GoogleConnection /></section>
      <AssignmentsPanel sample={sample} />
      <section className="flex min-h-[500px] flex-col rounded-2xl border border-[#dce3db] bg-white p-5 md:p-6" aria-labelledby="study-chat-title">
        <header className="border-b border-[#e5eae4] pb-4"><p className="text-[11px] font-semibold uppercase tracking-widest text-[#658071]">Your study companion</p>
          <h2 id="study-chat-title" className="mt-1 text-xl font-medium">Plan with PolyMate</h2>
          <p className="mt-2 text-sm text-[#617269]">Signed in as {ownerName}. Moodle content stays grounded in your connected account.</p></header>
        <div className="flex-1 space-y-4 overflow-y-auto py-4" aria-live="polite" aria-relevant="additions text">
          {!messages.length && <div className="rounded-xl bg-[#f5f8f2] p-4 text-sm leading-6 text-[#43584c]">
            <p>Choose which Moodle calendar entries need work. Share an effort estimate and when you are free to build a study plan.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {['Show my Moodle calendar dates', 'Help me plan my week', 'What connections do I need?'].map(prompt => <button key={prompt} type="button" disabled={busy} onClick={() => { setInput(prompt); document.getElementById('agent-message')?.focus(); }} className="rounded-full border border-[#cbd7ce] bg-white px-3 py-1.5 text-xs disabled:opacity-50">{prompt}</button>)}
            </div>
          </div>}
          {messages.map(message => <article key={message.id} className={`max-w-[96%] rounded-2xl px-4 py-3 ${message.role === 'user' ? 'ml-auto bg-[#173b32] text-white' : 'bg-[#f1f4ee] text-[#21362d]'}`}>
            <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p>
            {message.role === 'assistant' && <OtherCards cards={message.cards} />}
          </article>)}
          {busy && <p className="text-sm text-[#617269]" role="status">PolyMate is checking your study space…</p>}
        </div>
        {pendingPlan && <div className="mb-4"><TimelinePreview plan={pendingPlan} onSchedule={allowPartial => void sendMessage(undefined, { allowPartial })} busy={busy} /></div>}
        {error && <p className="mb-3 text-sm text-[#9e3e38]" role="alert">{error}</p>}
        <form onSubmit={event => void sendMessage(event)} className="flex items-end gap-2 border-t border-[#e5eae4] pt-4">
          <label htmlFor="agent-message" className="sr-only">Message PolyMate</label>
          <textarea id="agent-message" value={input} onChange={event => setInput(event.target.value)} maxLength={4000} rows={2} disabled={busy} placeholder="Ask about course dates, effort, or when you are free…" className="min-h-12 flex-1 resize-y rounded-xl border border-[#cbd7ce] px-3 py-2 text-sm outline-none focus:border-[#658071] disabled:opacity-60" />
          <button disabled={busy || !input.trim()} className="rounded-xl bg-[#173b32] px-4 py-3 text-sm font-medium text-white disabled:opacity-50">Send</button>
        </form>
        <p className="mt-2 text-xs text-[#748278]">Calendar dates help guide planning. Calendar changes happen only after you approve the draft.</p>
      </section>
    </section>
    <section className="min-w-0 rounded-2xl border border-[#dce3db] bg-white p-4 md:p-5" aria-label="Weekly calendar">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-medium">Your week</h2><span className="text-xs text-[#748278]">Europe/Zurich</span></div>
      <CalendarStudyWorkflow sample={sample} externalReloadKey={reloadKey} />
      {sample && <p className="mt-3 text-xs text-[#8a5a26]">Development sample mode is on; Google writes appear only in a connected Google calendar.</p>}
    </section>
  </div>;
}
