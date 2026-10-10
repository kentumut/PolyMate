'use client';

import { MessageContent } from './message-content';
import { currentPlanApproval } from '@polymate/core/agent/contracts';

import type { AssignmentTimeline, MoodleSnapshot } from '@polymate/contracts/moodle';
import type { CalendarEvent } from '@polymate/contracts/calendar';
import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarStudyWorkflow } from '@/components/study/calendar-study-workflow';
import { AssignmentsPanel } from '@/components/study/assignments-panel';
import { GoogleConnection } from '@/components/connections/google-connection';
import { MoodleConnection } from '@/components/connections/moodle-connection';
import { MoodleCalendarPreview } from '@/components/connections/moodle-calendar-preview';
import { WorkspaceSidebar, type WorkspaceView } from './workspace-sidebar';
import { SemesterPlanner } from '@/components/study/semester-planner';
import { ProgressCardView } from './progress-cards';
import { useStudyWorkspace } from '@/components/study/study-workspace-context';
import type { ProgressReceipt } from '@polymate/contracts/study-progress';
import { CoachInbox, type CoachReplyTarget } from './coach-inbox';
import { CoursesPanel } from '@/components/study/courses-panel';
import { Button } from '@/components/ui/button';

type AgentCard = { kind: 'assignments' | 'timeline' | 'schedule' | 'connections' | 'progress'; data: unknown };
type PendingPlan = { timeline: AssignmentTimeline; expiresAt: string };
type ChatMessage = { id: number; role: 'user' | 'assistant'; text: string; cards: AgentCard[] };
type ChatResponse = { reply: string; cards?: AgentCard[]; pendingPlan?: PendingPlan | null; reloadCalendar?: boolean; reloadProgress?: boolean; error?: { message?: string } };

type StreamEvent = { type: 'status'; tool: string } | { type: 'delta'; text: string } | ({ type: 'done' } & ChatResponse) | { type: 'error'; error?: { message?: string } };

const WORKING = 'PolyMate is checking your study space…';
const TOOL_STATUS: Record<string, string> = {
  moodle_get_calendar_events: 'Reading your Moodle calendar…',
  moodle_plan_assignment_timeline: 'Drafting your timeline…',
  moodle_schedule_assignment_timeline: 'Adding blocks to your calendar…',
  polymate_check_connections: 'Checking your connections…',
  polymate_get_calendar: 'Looking at your calendar…',
  polymate_create_study_block: 'Updating your calendar…',
  polymate_edit_study_block: 'Updating your calendar…',
  polymate_move_study_block: 'Updating your calendar…',
  polymate_delete_study_blocks: 'Updating your calendar…',
  polymate_get_study_progress: 'Reading your study progress…',
  polymate_link_study_session: 'Preparing a confirmation card…',
  polymate_report_study_progress: 'Preparing a confirmation card…',
  vvz_search_courses: 'Searching the course catalogue…',
  vvz_get_course_details: 'Reading course details…',
  msc_cs_check_graduation: 'Checking graduation requirements…',
};

/** Reads the chat NDJSON stream until `done`; the done event carries the authoritative reply and cards. */
async function readAgentStream(response: Response, onEvent: (event: StreamEvent) => void): Promise<ChatResponse> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PolyMate could not answer. Try again.');
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === 'done') return event;
      if (event.type === 'error') throw new Error(event.error?.message ?? 'PolyMate could not answer. Try again.');
      onEvent(event);
    }
  }
  throw new Error('PolyMate stopped before finishing. Try again.');
}

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
  const value = data as { timeline?: AssignmentTimeline; progressSync?: string; movedBlock?: { title: string; startAt: string; endAt: string }; deletedBlocks?: Array<{ operationId: string; title: string; startAt: string; endAt: string }>; result?: { complete?: boolean; results?: Array<{ operationId: string; status: string; error?: { message?: string } }> } };
  const results = Array.isArray(value.result?.results) ? value.result.results : [];
  const attempted = new Set(results.map(item => item.operationId));
  const unattempted = value.timeline?.blocks.filter(block => !attempted.has(block.operationId)) ?? [];
  return <section className="mt-3 rounded-xl border border-[#dce3db] bg-[#fbfcf9] p-4" aria-label="Calendar write results">
    <h3 className="text-sm font-semibold">Calendar sync results</h3>
    {results.length ? <ul className="mt-2 space-y-2">{results.map((item, index) => <li key={`${item.operationId}-${index}`} className="flex gap-2 text-sm">
      <span aria-hidden="true">{item.status === 'synced' ? '✓' : item.status === 'unknown' ? '?' : '!'}</span>
      <span>{(() => {
        const block = (value.timeline?.blocks ?? value.deletedBlocks)?.find(block => block.operationId === item.operationId) ?? value.movedBlock;
        return block ? <span className="block">{block.title} · {dateTime(block.startAt)}–{dateTime(block.endAt)}</span> : null;
      })()}<strong className="capitalize">{item.status}</strong>{item.error?.message ? ` — ${item.error.message}` : ''}</span>
    </li>)}</ul> : <p className="mt-2 text-sm text-[#617269]">No calendar writes were confirmed.</p>}
    {unattempted.length > 0 && <ul className="mt-3 space-y-1 text-sm text-[#8a5a26]">{unattempted.map(block => <li key={block.operationId}>{block.title} · {dateTime(block.startAt)} — not attempted</li>)}</ul>}
    {value.result?.complete && <p className="mt-3 text-sm font-medium text-[#173b32]">{value.movedBlock ? 'The move was saved to your calendar.' : value.deletedBlocks ? 'The selected blocks were deleted from your calendar.' : 'All planned blocks were saved to your calendar.'}</p>}
    {value.progressSync === 'pending' && <p className="mt-3 text-sm text-[#8a5a26]">Local progress history could not be refreshed yet. Refresh progress to retry synchronization; the confirmed Google move does not need to be repeated.</p>}
  </section>;
}

function OtherCards({ cards, busy, confirmed, onConfirm }: { cards: AgentCard[]; busy: boolean; confirmed: ReadonlySet<string>; onConfirm: (token: string, wholeAssignment: boolean) => void }) {
  return <>
    {cards.map((card, index) => {
      if (card.kind === 'progress') return <ProgressCardView key={`progress-${index}`} data={card.data} busy={busy} confirmed={confirmed} onConfirm={onConfirm} />;
      if (card.kind === 'assignments') return <AssignmentCards key={`assignments-${index}`} data={card.data} />;
      if (card.kind === 'schedule') return <ScheduleCard key={`schedule-${index}`} data={card.data} />;
      if (card.kind === 'connections' && card.data && typeof card.data === 'object') {
        const value = card.data as { moodleConnected?: boolean; googleCalendarConnected?: boolean; standaloneCalendarAvailable?: boolean; backgroundMoodleAvailable?: boolean; note?: string };
        return <div key={`connections-${index}`} className="mt-3 rounded-xl bg-[#edf0e7] p-4 text-sm">
          <p>PolyMate calendar: available.</p>
          <p>Moodle calendar: {value.moodleConnected ? 'subscription connected' : 'not connected'}.</p>
          <p>Optional Google overlay: {value.googleCalendarConnected ? 'connected' : 'not connected'}.</p>
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
  const workspace = useStudyWorkspace();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get('view');
  const view: WorkspaceView = requestedView === 'calendar' || requestedView === 'courses' || requestedView === 'planner' || requestedView === 'settings' ? requestedView
    : searchParams.has('google') ? 'settings' : 'chat';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [stoppable, setStoppable] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmedProgress, setConfirmedProgress] = useState<ReadonlySet<string>>(new Set());
  const [status, setStatus] = useState(WORKING);
  const [streamingId, setStreamingId] = useState<number | null>(null);
  const [coachReply, setCoachReply] = useState<CoachReplyTarget | null>(null);
  const [coachRefreshKey, setCoachRefreshKey] = useState(0);
  const [coachOutstanding, setCoachOutstanding] = useState(0);
  const [nextEvent, setNextEvent] = useState<CalendarEvent | null>(null);
  const nextId = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const messagesEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let current = true;
    const now = new Date();
    const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    workspace?.calendarClient.listWeek({ from: now.toISOString(), to: to.toISOString() })
      .then(events => {
        if (!current) return;
        setNextEvent(events.filter(item => Date.parse(item.endAt) > now.getTime()).sort((a, b) => a.startAt.localeCompare(b.startAt))[0] ?? null);
      })
      .catch(() => { if (current) setNextEvent(null); });
    return () => { current = false; };
  }, [reloadKey, workspace?.calendarClient]);

  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [busy, messages, pendingPlan]);

  function hrefFor(nextView: WorkspaceView) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', nextView);
    return `/calendar?${params.toString()}`;
  }

  function navigate(event: MouseEvent<HTMLAnchorElement>, nextView: WorkspaceView) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (nextView !== view) {
      window.history.pushState(null, '', hrefFor(nextView));
      window.scrollTo({ top: 0 });
    }
  }

  function respondToCoach(message: CoachReplyTarget) {
    setCoachReply(message); setInput('');
    window.history.pushState(null, '', hrefFor('chat'));
    window.scrollTo({ top: 0 });
    window.setTimeout(() => document.getElementById('agent-message')?.focus(), 0);
  }

  function openRecommendation(prompt: string) {
    setInput(prompt);
    window.history.pushState(null, '', hrefFor('chat'));
    window.scrollTo({ top: 0 });
    window.setTimeout(() => document.getElementById('agent-message')?.focus(), 0);
  }

  async function sendMessage(event?: FormEvent, action?: { allowPartial: boolean } | { draftToken: string; confirmAssignmentFinished: boolean }) {
    event?.preventDefault();
    if (busy || sample || (!action && !input.trim())) return;
    const studentText = input.trim();
    const text = action ? ('draftToken' in action ? 'Confirm this progress change.' : action.allowPartial ? 'Add only the blocks that fit to my calendar.' : 'Add this timeline to my calendar.')
      : coachReply ? `Weekly planning question: ${coachReply.body}\n\nStudent response: ${studentText}` : studentText;
    // Bind explicit chat approval to the displayed draft, just like its button.
    // The model never needs to reproduce the sealed scheduling payload.
    const approval = currentPlanApproval(text);
    const scheduleAction = !action && pendingPlan && approval
      ? { action: 'schedule_current_plan', allowPartial: approval.allowPartial, timelineId: pendingPlan.timeline.id }
      : undefined;
    const id = ++nextId.current;
    setMessages(previous => [...previous, { id, role: 'user', text: coachReply && !action ? studentText : text, cards: [] }].slice(-40) as ChatMessage[]);
    if (!action) setInput('');
    // Only free-form turns can be stopped; scheduling and confirmations change the calendar and must finish.
    const controller = action || scheduleAction ? null : new AbortController();
    inFlight.current = controller;
    setBusy(true); setStoppable(Boolean(controller)); setError(''); setStatus(WORKING);
    // Free-form turns stream tool progress and reply text; actions keep the plain JSON response.
    const streamId = controller ? ++nextId.current : null;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (controller) headers.Accept = 'application/x-ndjson, application/json';
      if (action && 'draftToken' in action) {
        const csrf = await fetch('/api/agent/csrf', { credentials: 'same-origin', cache: 'no-store' });
        const csrfBody = await csrf.json().catch(() => ({})) as { csrfToken?: unknown };
        if (!csrf.ok || typeof csrfBody.csrfToken !== 'string') throw new Error('Chat session unavailable. Refresh and retry.');
        headers['x-csrf-token'] = csrfBody.csrfToken;
      }
      const response = await fetch('/api/agent/chat', {
        method: 'POST', headers, credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify(action ? 'draftToken' in action ? { action: 'confirm_progress', draftToken: action.draftToken, confirmAssignmentFinished: action.confirmAssignmentFinished } : { action: 'schedule_current_plan', allowPartial: action.allowPartial, timelineId: pendingPlan?.timeline.id } : scheduleAction ?? { message: text }),
        signal: controller?.signal,
      });
      let body: ChatResponse;
      if (response.ok && streamId !== null && response.headers.get('content-type')?.includes('application/x-ndjson')) {
        let streamed = '';
        body = await readAgentStream(response, event => {
          if (event.type === 'status') setStatus(TOOL_STATUS[event.tool] ?? WORKING);
          if (event.type !== 'delta') return;
          streamed += event.text;
          setStreamingId(streamId);
          setMessages(previous => previous.some(message => message.id === streamId)
            ? previous.map(message => message.id === streamId ? { ...message, text: streamed } : message)
            : [...previous, { id: streamId, role: 'assistant' as const, text: streamed, cards: [] }].slice(-40));
        });
      } else {
        body = await response.json() as ChatResponse;
        if (!response.ok) throw new Error(body.error?.message ?? 'PolyMate could not answer. Try again.');
      }
      // The final reply is authoritative (redacted, and corrected for calendar outcomes); it replaces streamed text.
      setMessages(previous => [...previous.filter(message => message.id !== streamId), { id: streamId ?? ++nextId.current, role: 'assistant', text: body.reply, cards: body.cards ?? [] }].slice(-40) as ChatMessage[]);
      setCoachRefreshKey(value => value + 1);
      setPendingPlan(body.pendingPlan ?? null);
      if (action && 'draftToken' in action) {
        const result = body.cards?.find(card => card.kind === 'progress')?.data as { receipt?: ProgressReceipt } | undefined;
        if (!result?.receipt?.calendarOperation || ['synced', 'failed'].includes(result.receipt.calendarOperation.status)) {
          setConfirmedProgress(previous => new Set([...previous, action.draftToken]));
        }
      }
      if (body.reloadCalendar) setReloadKey(value => value + 1);
      if (body.reloadProgress) await workspace?.refresh();
      if (coachReply && !action) {
        const coaching = await fetch('/api/coaching', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'respond', messageId: coachReply.id, response: studentText }) });
        if (!coaching.ok) {
          const problem = await coaching.json().catch(() => ({})) as { error?: { message?: string } };
          setError(problem.error?.message ?? 'Your chat response was sent, but the weekly question was not marked answered.');
        } else {
          setCoachReply(null);
        }
      }
    } catch (reason) {
      // Never leave an unconfirmed partial reply on screen.
      if (streamId !== null) setMessages(previous => previous.filter(message => message.id !== streamId));
      if (controller?.signal.aborted) {
        setMessages(previous => [...previous, { id: ++nextId.current, role: 'assistant', text: 'Stopped.', cards: [] }].slice(-40) as ChatMessage[]);
        return;
      }
      const message = reason instanceof Error ? reason.message : 'PolyMate could not answer. Try again.';
      setError(message);
      if (action) setMessages(previous => [...previous, { id: ++nextId.current, role: 'assistant', text: message, cards: [] }]);
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      setBusy(false); setStoppable(false); setStreamingId(null);
    }
  }

  function stopMessage() {
    inFlight.current?.abort();
  }

  const firstName = ownerName.trim().split(/[\s@]/)[0] || 'there';
  const nextEventTime = nextEvent ? new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich', weekday: 'long', hour: '2-digit', minute: '2-digit',
  }).format(new Date(nextEvent.startAt)) : null;
  const pageTitle = view === 'calendar' ? 'Calendar' : view === 'courses' ? 'Courses' : view === 'planner' ? 'Semester plan' : 'Settings';
  const pageDescription = view === 'calendar' ? 'Your week, deadlines, and study blocks in one place.'
    : view === 'courses' ? 'Workload, exam scope, and preparation priorities for each course.'
      : view === 'planner' ? 'Choose courses that fit your major, minor, and graduation path.'
      : 'Connections and preferences for your study space.';

  return <div className="min-h-dvh bg-background md:flex md:items-start">
    <WorkspaceSidebar view={view} ownerName={ownerName} hrefFor={hrefFor} onNavigate={navigate} />
    <main className={view === 'chat' ? 'flex h-[calc(100dvh-57px)] min-w-0 flex-1 flex-col overflow-hidden md:h-dvh' : 'min-w-0 flex-1'}>
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 sm:px-6">
        <p className="truncate text-sm font-medium">{view === 'chat' ? 'Chat' : <>PolyMate <span className="text-muted-foreground">/ {pageTitle}</span></>}</p>
        <CoachInbox sample={sample} refreshKey={coachRefreshKey} onRespond={respondToCoach} onOutstandingChange={setCoachOutstanding} />
      </header>

      <div className={view === 'chat' ? 'min-h-0 flex-1' : 'mx-auto w-full max-w-7xl px-4 py-8 sm:px-7 md:px-10 md:py-10 lg:px-12'}>
        {view !== 'chat' && <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">{pageTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{pageDescription}</p>
        </header>}

        {/* Keep panels mounted so navigation preserves drafts, forms, and calendar state. */}
        <section aria-label="Calendar" className={view === 'calendar' ? 'space-y-5' : 'hidden'}>
          <div className="min-w-0 rounded-xl border bg-card p-4 shadow-sm sm:p-6"><CalendarStudyWorkflow sample={sample} externalReloadKey={reloadKey} /></div>
          <details className="group rounded-xl border bg-card shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-5 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span>Assignments <span className="ml-2 hidden font-normal text-muted-foreground sm:inline">Deadlines and effort estimates</span></span>
              <span className="text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45" aria-hidden="true">+</span>
            </summary>
            <div className="border-t [&>section]:border-0 [&>section]:bg-transparent"><AssignmentsPanel sample={sample} onCalendarChange={() => setReloadKey(value => value + 1)} /></div>
          </details>
          {sample && <p className="text-xs text-muted-foreground">Development sample calendar. Changes stay in memory.</p>}
        </section>

        <section aria-label="Courses" className={view === 'courses' ? 'block' : 'hidden'}><CoursesPanel sample={sample} /></section>

        <section aria-label="Semester planning" className={view === 'planner' ? '' : 'hidden'}>
          <SemesterPlanner sample={sample} onRecommend={openRecommendation} />
        </section>

        <section aria-labelledby="study-chat-title" className={view === 'chat' ? 'flex h-full min-h-0 flex-col' : 'hidden'}>
          <h2 id="study-chat-title" className="sr-only">Plan with PolyMate</h2>
          <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-relevant="additions text">
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-8 pt-6 sm:px-6">
              {!messages.length && <div className="my-auto flex flex-col items-center py-10 text-center">
                <h1 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">How are you feeling, {firstName}?</h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">{nextEvent && nextEventTime ? <>Your next event is <span className="font-medium text-foreground">{nextEvent.title}</span> on {nextEventTime}.</> : 'Your calendar is clear for now. What would you like to make progress on?'}</p>
                {coachOutstanding > 0 && <button type="button" onClick={() => document.getElementById('coach-notifications-trigger')?.click()} className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 shadow-sm hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">Your coach needs {coachOutstanding} response{coachOutstanding === 1 ? '' : 's'} from you</button>}
                <div className="mt-8 grid w-full gap-2 sm:grid-cols-3">
                  {['Plan my week', 'What should I study next?', 'Show my upcoming deadlines'].map(prompt => <button key={prompt} type="button" disabled={busy || sample} onClick={() => { setInput(prompt); document.getElementById('agent-message')?.focus(); }} className="rounded-xl border bg-card px-4 py-3 text-left text-sm shadow-sm transition-colors hover:bg-accent disabled:opacity-50">{prompt}</button>)}
                </div>
              </div>}

              {messages.length > 0 && <div className="space-y-7 py-4">
                {messages.map(message => <article key={message.id} aria-busy={message.id === streamingId} className={message.role === 'user' ? 'ml-auto max-w-[85%] rounded-2xl bg-secondary px-4 py-3' : 'max-w-full'}>
                  {message.role === 'assistant' ? <MessageContent text={message.text} /> : <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p>}
                  {message.role === 'assistant' && <OtherCards cards={message.cards} busy={busy} confirmed={confirmedProgress} onConfirm={(draftToken, confirmAssignmentFinished) => void sendMessage(undefined, { draftToken, confirmAssignmentFinished })} />}
                </article>)}
                {busy && streamingId === null && <p className="text-sm text-muted-foreground" role="status">{status}</p>}
                {pendingPlan && <TimelinePreview plan={pendingPlan} onSchedule={allowPartial => void sendMessage(undefined, { allowPartial })} busy={busy} />}
                <div ref={messagesEnd} />
              </div>}
            </div>
          </div>

          <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent px-4 pb-3 pt-3 sm:px-6 sm:pb-5">
            <div className="mx-auto max-w-3xl">
              {error && <p className="mb-2 text-sm text-destructive" role="alert">{error}</p>}
              {coachReply && <div className="mb-2 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"><div><p className="text-xs font-medium text-amber-800 dark:text-amber-300">Answering your coach</p><p className="mt-1">{coachReply.body}</p></div><button type="button" onClick={() => setCoachReply(null)} className="shrink-0 text-xs underline">Cancel</button></div>}
              <form onSubmit={event => void sendMessage(event)} className="relative rounded-2xl border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
                <label htmlFor="agent-message" className="sr-only">Message PolyMate</label>
                <textarea id="agent-message" value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => {
                  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  void sendMessage();
                }} maxLength={4000} rows={2} disabled={sample} placeholder={coachReply ? 'Write your answer for this week…' : 'Ask PolyMate anything…'} className="max-h-40 min-h-12 w-full resize-none bg-transparent px-2 py-2 pr-12 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60" />
                {busy && !input.trim()
                  ? <Button type="button" size="icon" onClick={stopMessage} disabled={!stoppable} aria-label="Stop PolyMate" className="absolute bottom-2 right-2 rounded-full"><Square className="fill-current" aria-hidden="true" /></Button>
                  : <Button size="icon" disabled={busy || sample || !input.trim()} aria-label="Send message" className="absolute bottom-2 right-2 rounded-full"><ArrowUp aria-hidden="true" /></Button>}
              </form>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">{sample ? 'Chat is unavailable in sample mode.' : 'PolyMate can make mistakes. Review calendar changes before approving them.'}</p>
            </div>
          </div>
        </section>

        <section aria-label="Settings" className={view === 'settings' ? 'grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]' : 'hidden'}>
          <MoodleConnection />
          <div className="space-y-5">
            <section className="rounded-xl border bg-card p-6 shadow-sm"><h2 className="text-lg font-medium">Optional Google Calendar overlay</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Your PolyMate calendar works on its own. Connect Google only to show its events as read-only busy time.</p><GoogleConnection /></section>
            <section className="rounded-xl border bg-card p-6 shadow-sm"><h2 className="text-sm font-medium">Your study space</h2><dl className="mt-4 space-y-4 text-sm"><div><dt className="text-xs text-muted-foreground">Signed in as</dt><dd className="mt-1 break-words">{ownerName}</dd></div><div><dt className="text-xs text-muted-foreground">Calendar timezone</dt><dd className="mt-1">Europe/Zurich</dd></div></dl></section>
          </div>
        </section>
      </div>
    </main>
  </div>;
}
