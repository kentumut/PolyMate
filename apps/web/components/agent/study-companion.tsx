'use client';

import { MessageContent } from './message-content';
import { currentPlanApproval } from '@polymate/core/agent/contracts';

import type { AssignmentTimeline, MoodleSnapshot } from '@polymate/contracts/moodle';
import type { CalendarEvent } from '@polymate/contracts/calendar';
import type { OnboardingProfile, OnboardingState } from '@polymate/contracts/onboarding';
import { ArrowUp, Check, RotateCcw, Sparkles, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CalendarStudyWorkflow } from '@/components/study/calendar-study-workflow';
import { GoogleConnection } from '@/components/connections/google-connection';
import { MoodleConnection } from '@/components/connections/moodle-connection';
import { DayTimelineGrid } from '@/components/calendar/day-timeline-grid';
import { MoodleDeadlineList } from '@/components/connections/moodle-calendar-preview';
import { ThemeToggle, WorkspaceSidebar, type WorkspaceView } from './workspace-sidebar';
import { readSemesterPlan, SemesterPlanner } from '@/components/study/semester-planner';
import { ProgressCardView } from './progress-cards';
import { useStudyWorkspace } from '@/components/study/study-workspace-context';
import type { ProgressReceipt } from '@polymate/contracts/study-progress';
import { CoachInbox, type CoachReplyTarget } from './coach-inbox';
import { CoursesPanel } from '@/components/study/courses-panel';
import { AssignmentsPanel } from '@/components/study/assignments-panel';
import type { ProposedBlock, UnscheduledWork } from '@/components/calendar/plan-overlay';
import { CoachPreferences } from './coach-preferences';
import { SetupChecklist } from './setup-checklist';
import { Button } from '@/components/ui/button';
import {
  DEMO_COURSES,
  DEMO_ASSIGNMENT_CAPTURE_PROMPT,
  DEMO_ONBOARDING_OPTIONS,
  DEMO_PROMPTS,
  demoAssignment,
  demoCapturedAssignment,
  demoCoachingState,
  demoCommitmentMemory,
  demoInitialMemories,
  demoMoodleSnapshot,
  demoMovedBlock,
  demoScheduleCard,
  demoTimeline,
  demoTradeoffExplanation,
  demoWeekRange,
  type DemoCommitment,
  type DemoPlanStyle,
  type DemoProfile,
  type DemoStage,
} from '@/lib/demo-fixtures';
import { ChatHistoryRail, CheckInNotice, CheckInSettings, useChats } from './chat-list';
import { fetchChat, unreadCheckIns } from './chat-client';

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
  polymate_create_assignment: 'Saving your assignment…',
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
  polymate_semester_plan: 'Reviewing your semester plan…',
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
  if (snapshot.source === 'calendar-subscription') return <section className="mt-3 rounded-xl border border-[#dce3db] bg-white px-4 py-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold">Moodle deadlines</h3>{typeof snapshot.fetchedAt === 'string' && <p className="text-xs text-[#748278]">Updated {dateTime(snapshot.fetchedAt)}</p>}</div><MoodleDeadlineList snapshot={snapshot} /></section>;
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

const WRITE_STATUS: Record<string, string> = { synced: 'Saved', pending: 'Still saving', unknown: 'Not confirmed yet', failed: 'Not saved' };

function ScheduleCard({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') return null;
  const value = data as { timeline?: AssignmentTimeline; progressSync?: string; movedBlock?: { title: string; startAt: string; endAt: string }; createdBlock?: { title: string; startAt: string; endAt: string }; relocatedFrom?: { startAt: string; endAt: string }; deletedBlocks?: Array<{ operationId: string; title: string; startAt: string; endAt: string }>; result?: { complete?: boolean; results?: Array<{ operationId: string; status: string; error?: { message?: string } }> } };
  const results = Array.isArray(value.result?.results) ? value.result.results : [];
  const attempted = new Set(results.map(item => item.operationId));
  const unattempted = value.timeline?.blocks.filter(block => !attempted.has(block.operationId)) ?? [];
  return <section className="mt-3 rounded-xl border border-[#dce3db] bg-[#fbfcf9] p-4" aria-label="Calendar write results">
    <h3 className="text-sm font-semibold">Calendar changes</h3>
    {results.length ? <ul className="mt-2 space-y-2">{results.map((item, index) => <li key={`${item.operationId}-${index}`} className="flex gap-2 text-sm">
      <span aria-hidden="true">{item.status === 'synced' ? '✓' : item.status === 'unknown' ? '?' : '!'}</span>
      <span>{(() => {
        const block = (value.timeline?.blocks ?? value.deletedBlocks)?.find(block => block.operationId === item.operationId) ?? value.movedBlock ?? value.createdBlock;
        return block ? <span className="block">{block.title} · {dateTime(block.startAt)}–{dateTime(block.endAt)}</span> : null;
      })()}<strong>{WRITE_STATUS[item.status] ?? item.status}</strong>{item.error?.message ? ` — ${item.error.message}` : ''}</span>
    </li>)}</ul> : <p className="mt-2 text-sm text-[#617269]">No calendar writes were confirmed.</p>}
    {value.relocatedFrom && <p className="mt-3 text-sm text-[#617269]">{dateTime(value.relocatedFrom.startAt)} was already taken. {results.length > 0 && results.every(result => result.status === 'synced')
      ? 'This block was placed in the nearest free slot.'
      : results.length > 0 && results.every(result => result.status === 'failed') ? 'The attempt at the free slot failed; no placement is confirmed.'
        : 'Placement at the free slot is unconfirmed. Retry the same operation to check its outcome.'}</p>}
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
        const value = card.data as { moodleConnected?: boolean; googleCalendarConnected?: boolean; calendarHome?: 'polymate' | 'google'; standaloneCalendarAvailable?: boolean; backgroundMoodleAvailable?: boolean; note?: string };
        return <div key={`connections-${index}`} className="mt-3 rounded-xl bg-[#edf0e7] p-4 text-sm">
          <p>Study blocks are saved to: {value.calendarHome === 'google' ? 'Google Calendar (also shown in PolyMate)' : 'the PolyMate calendar'}.</p>
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

function TimelinePreview({ plan, onSchedule, onViewCalendar, busy }: { plan: PendingPlan; onSchedule: (partial: boolean) => void; onViewCalendar: () => void; busy: boolean }) {
  const timeline = plan.timeline;
  const unscheduled = timeline.unscheduled.length > 0;
  return <section className="rounded-2xl border border-[#b9cbbd] bg-[#f5f8f2] p-5" aria-label="Current study timeline draft">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-widest text-[#658071]">Draft timeline</p>
      <p className="mt-1 text-sm text-[#617269]">Effort is an estimate. Times are shown in Europe/Zurich.</p></div>
      <p className="text-xs text-[#748278]">Expires {dateTime(plan.expiresAt)}</p></div>
    {timeline.blocks.length ? <div className="mt-4">
      <p className="mb-2 text-xs text-[#617269]">{timeline.blocks.length} {timeline.blocks.length === 1 ? 'session' : 'sessions'} · {Math.round(timeline.blocks.reduce((sum, block) => sum + Date.parse(block.endAt) - Date.parse(block.startAt), 0) / 60_000 / 6) / 10} h total. Select a block to open its Moodle source.</p>
      <DayTimelineGrid blocks={timeline.blocks.map((block, index) => ({ id: `${block.operationId}-${index}`, title: block.title, startAt: block.startAt, endAt: block.endAt, allDay: false, href: safeSource(block.sourceUrl) }))} />
    </div> : <p className="mt-4 rounded-xl bg-white p-3 text-sm">No study blocks fit those constraints.</p>}
    {unscheduled && <div className="mt-3 rounded-xl border border-[#e7d7b9] bg-[#fffaf0] p-3"><h3 className="text-sm font-semibold">Work not scheduled</h3>
      <ul className="mt-2 space-y-1 text-sm">{timeline.unscheduled.map((item, index) => <li key={`${item.assignmentId}-${index}`}>{item.remainingMinutes} min could not be placed — {item.reason}</li>)}</ul>
    </div>}
    {timeline.warnings.map((warning, index) => <p key={index} className="mt-2 text-xs text-[#8a5a26]">{warning}</p>)}
    <div className="mt-4 flex flex-wrap gap-2">
      {!unscheduled && timeline.blocks.length > 0 && <button type="button" disabled={busy} onClick={() => onSchedule(false)} className="rounded-xl bg-[#173b32] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Add to calendar</button>}
      {unscheduled && timeline.blocks.length > 0 && <button type="button" disabled={busy} onClick={() => onSchedule(true)} className="rounded-xl bg-[#173b32] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Add only the blocks that fit</button>}
      {timeline.blocks.length > 0 && <button type="button" onClick={onViewCalendar} className="rounded-xl border border-[#cbd7ce] px-4 py-2 text-sm">View on calendar</button>}
      <button type="button" disabled={busy} onClick={() => document.getElementById('agent-message')?.focus()} className="rounded-xl border border-[#cbd7ce] px-4 py-2 text-sm disabled:opacity-50">Revise constraints</button>
    </div>
  </section>;
}

const demoStages: Array<{ id: DemoStage; label: string }> = [
  { id: 'onboarding', label: 'Setup' },
  { id: 'brief', label: 'Context' },
  { id: 'remember', label: 'Memory' },
  { id: 'plan', label: 'Draft' },
  { id: 'approve', label: 'Approve' },
  { id: 'move', label: 'Adapt' },
];

function StudentOnboarding({ demo, busy = false, error = '', onComplete }: { demo: boolean; busy?: boolean; error?: string; onComplete: (profile: OnboardingProfile) => void }) {
  const [goal, setGoal] = useState<DemoProfile['goal']>();
  const [sessionMinutes, setSessionMinutes] = useState<DemoProfile['sessionMinutes']>();
  const [coachCadence, setCoachCadence] = useState<DemoProfile['coachCadence']>();
  const ready = goal !== undefined && sessionMinutes !== undefined && coachCadence !== undefined;
  const optionClass = (selected: boolean) => `rounded-xl border p-3 text-left transition ${selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-accent'}`;
  return <section className="my-auto py-4" aria-labelledby="student-onboarding-title">
    <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-6">
      <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Sparkles className="size-4" aria-hidden="true" /> {demo ? 'Mentor demo · interactive walkthrough' : 'A quick setup · about one minute'}</p>
      <h1 id="student-onboarding-title" className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{demo ? 'Shape Alex’s study coach' : 'Set up your study coach'}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">Choose a goal, focus rhythm, and coaching style. PolyMate uses these choices when it recommends work, builds plans, and checks in.</p>

      <fieldset className="mt-6"><legend className="text-sm font-semibold">1. What should PolyMate optimize for?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">{DEMO_ONBOARDING_OPTIONS.goal.map(option => <button key={option.value} type="button" role="radio" aria-checked={goal === option.value} onClick={() => setGoal(option.value)} className={optionClass(goal === option.value)}><span className="block text-sm font-medium">{option.label}</span><span className={`mt-1 block text-xs leading-5 ${goal === option.value ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{option.description}</span></button>)}</div>
      </fieldset>
      <fieldset className="mt-5"><legend className="text-sm font-semibold">2. Which focus rhythm feels realistic?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">{DEMO_ONBOARDING_OPTIONS.sessionMinutes.map(option => <button key={option.value} type="button" role="radio" aria-checked={sessionMinutes === option.value} onClick={() => setSessionMinutes(option.value)} className={optionClass(sessionMinutes === option.value)}><span className="block text-sm font-medium">{option.label}</span><span className={`mt-1 hidden text-xs leading-5 sm:block ${sessionMinutes === option.value ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{option.description}</span></button>)}</div>
      </fieldset>
      <fieldset className="mt-5"><legend className="text-sm font-semibold">3. How visible should coaching be?</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">{DEMO_ONBOARDING_OPTIONS.coachCadence.map(option => <button key={option.value} type="button" role="radio" aria-checked={coachCadence === option.value} onClick={() => setCoachCadence(option.value)} className={optionClass(coachCadence === option.value)}><span className="block text-sm font-medium">{option.label}</span><span className={`mt-1 hidden text-xs leading-5 sm:block ${coachCadence === option.value ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>{option.description}</span></button>)}</div>
      </fieldset>
      {error && <p className="mt-5 text-sm text-destructive" role="alert">{error}</p>}
      <Button type="button" disabled={!ready || busy} onClick={() => { if (ready) onComplete({ goal, sessionMinutes, coachCadence }); }} className="mt-6 w-full">{busy ? 'Saving your preferences…' : demo ? 'Start the interactive demo' : 'Start planning'} {!busy && <ArrowUp className="rotate-90" aria-hidden="true" />}</Button>
    </div>
  </section>;
}

type DemoDecision = Readonly<{ label: string; description: string; prompt?: string; approve?: true }>;

function decisionsFor(stage: DemoStage): DemoDecision[] {
  if (stage === 'brief') return [
    { label: 'Prioritize deadlines', description: 'Lead with submission risk.', prompt: 'Prioritize my deadlines and tell me what matters most.' },
    { label: 'Connect to the exam', description: 'Use saved course priorities.', prompt: 'Which upcoming work best supports my exam preparation?' },
  ];
  if (stage === 'remember') return [
    { label: 'Protect volunteering', description: 'Wednesday, 17:00–20:00.', prompt: 'Remember that I volunteer next Wednesday from 17:00 to 20:00.' },
    { label: 'Protect rehearsal', description: 'Thursday, 17:00–19:00.', prompt: 'Remember that I have a project rehearsal next Thursday from 17:00 to 19:00.' },
  ];
  if (stage === 'plan') return [
    { label: 'Spread the work', description: 'Balance sessions across the week.', prompt: 'Spread 150 minutes for Algorithms problem set 4 across the week before Friday.' },
    { label: 'Front-load it', description: 'Finish most work by Tuesday.', prompt: 'Front-load 150 minutes for Algorithms problem set 4 before Friday.' },
  ];
  if (stage === 'approve') return [
    { label: 'Approve all blocks', description: 'Write this exact draft.', approve: true },
    { label: 'Explain the trade-off', description: 'Keep the calendar unchanged.', prompt: 'Explain why you chose these times before I approve anything.' },
  ];
  if (stage === 'move') return [
    { label: 'Move to Friday 15:00', description: 'Create a longer buffer.', prompt: 'Move the final review to Friday at 15:00.' },
    { label: 'Move to Friday 16:00', description: 'Keep it closer to the deadline.', prompt: 'Move the final review to Friday at 16:00.' },
  ];
  return [];
}

function DemoGuide({ stage, busy, coachOutstanding, tradeoffExplained, onRun, onApprove, onOpenCalendar, onOpenCourses, onDescribeAssignment, onOpenCoach }: { stage: DemoStage; busy: boolean; coachOutstanding: number; tradeoffExplained: boolean; onRun: (prompt: string) => void; onApprove: () => void; onOpenCalendar: () => void; onOpenCourses: () => void; onDescribeAssignment: () => void; onOpenCoach: () => void }) {
  const index = stage === 'complete' ? demoStages.length : demoStages.findIndex(item => item.id === stage);
  const decisions = decisionsFor(stage);
  return <section className="mb-3 rounded-xl border bg-muted/45 p-3" aria-label="Guided chat demo">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-xs font-medium"><Sparkles className="size-3.5" aria-hidden="true" /> Mentor demo <span className="font-normal text-muted-foreground">Interactive walkthrough</span></p>
      <ol className="flex items-center gap-1.5" aria-label={`Demo progress, ${Math.min(index + 1, demoStages.length)} of ${demoStages.length}`}>
        {demoStages.map((item, itemIndex) => <li key={item.id} title={item.label} className={`h-1.5 w-7 rounded-full ${itemIndex < index ? 'bg-primary' : itemIndex === index ? 'bg-amber-500' : 'bg-border'}`}><span className="sr-only">{item.label}</span></li>)}
      </ol>
    </div>
    <div className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="Demo setup and coaching skills">
      <button type="button" onClick={onOpenCourses} className="rounded-lg border bg-background px-3 py-2 text-left text-xs font-medium hover:bg-accent">Add a course</button>
      <button type="button" onClick={onDescribeAssignment} className="rounded-lg border bg-background px-3 py-2 text-left text-xs font-medium hover:bg-accent">Describe an assignment</button>
      <button type="button" onClick={onOpenCoach} className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-xs font-medium text-amber-950 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"><span>Coach check-ins</span><span className="rounded-full bg-amber-200 px-1.5 py-0.5 tabular-nums dark:bg-amber-800">{coachOutstanding}</span></button>
    </div>
    {decisions.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2">{decisions.map(decision => <button key={decision.label} type="button" disabled={busy} onClick={() => decision.approve ? onApprove() : onRun(decision.prompt!)} className="rounded-lg border bg-background p-2.5 text-left transition-colors hover:bg-accent disabled:opacity-50"><span className="block text-xs font-semibold sm:text-sm">{decision.label}</span><span className="mt-1 hidden text-xs text-muted-foreground sm:block">{decision.description}</span></button>)}</div>}
    {stage === 'approve' && <p className={`mt-2 text-xs ${tradeoffExplained ? 'font-medium text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`} role="status">{tradeoffExplained ? 'Trade-off explained in Chat. The draft is still waiting for your decision.' : 'Only the approval choice writes to the calendar. The explanation choice leaves the draft untouched.'}</p>}
    {stage === 'complete' && <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="flex items-center gap-2 text-sm font-medium"><Check className="size-4" /> Demo complete</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}><RotateCcw /> Restart</Button><Button type="button" size="sm" onClick={onOpenCalendar}>Open calendar</Button></div></div>}
  </section>;
}

export function StudyCompanion({ sample, ownerName, demo = false, demoNow, development = false }: { sample: boolean; ownerName: string; demo?: boolean; demoNow?: string; development?: boolean }) {
  const workspace = useStudyWorkspace();
  // The demo route always supplies its server timestamp. Keep the fallback stable so
  // non-demo server/client renders cannot disagree during hydration.
  const demoEpoch = demoNow ?? '2026-10-10T12:00:00.000Z';
  const searchParams = useSearchParams();
  const requestedView = searchParams.get('view');
  const view: WorkspaceView = requestedView === 'calendar' || requestedView === 'courses' || requestedView === 'planner' || requestedView === 'settings' || requestedView === 'chat' ? requestedView
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
  const [calendarFocus, setCalendarFocus] = useState<{ date: string }>();
  const [demoStage, setDemoStage] = useState<DemoStage>(demo ? 'onboarding' : 'brief');
  const [demoProfile, setDemoProfile] = useState<DemoProfile | null>(null);
  const [demoCommitment, setDemoCommitment] = useState<DemoCommitment>('volunteering');
  const [demoPlanStyle, setDemoPlanStyle] = useState<DemoPlanStyle>('spread');
  const [demoTradeoffExplained, setDemoTradeoffExplained] = useState(false);
  const [demoCoachAnswers, setDemoCoachAnswers] = useState(0);
  const [demoMemories, setDemoMemories] = useState(() => demo ? [] : demoInitialMemories(demoEpoch));
  const [onboardingStatus, setOnboardingStatus] = useState<'loading' | 'required' | 'complete' | 'error'>(demo || sample ? 'complete' : development ? 'required' : 'loading');
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [onboardingError, setOnboardingError] = useState('');
  const [onboardingReloadKey, setOnboardingReloadKey] = useState(0);
  // Each chat is stored under its own ID; a fresh ID is a new, still empty chat.
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  const chats = useChats(sample);
  const nextId = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const messagesEnd = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (demo || sample) return;
    if (development) {
      const timer = window.setTimeout(() => {
        let completed = false;
        try { completed = Boolean(window.localStorage.getItem('polymate-onboarding')); } catch { /* Storage can be disabled in an embedded browser. */ }
        setOnboardingStatus(completed ? 'complete' : 'required');
      }, 0);
      return () => window.clearTimeout(timer);
    }
    let current = true;
    fetch('/api/onboarding', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        const body = await response.json() as OnboardingState & { error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? 'Your setup could not be loaded.');
        return body;
      })
      .then(body => { if (current) setOnboardingStatus(body.completed ? 'complete' : 'required'); })
      .catch(reason => { if (current) { setOnboardingStatus('error'); setOnboardingError(reason instanceof Error ? reason.message : 'Your setup could not be loaded.'); } });
    return () => { current = false; };
  }, [demo, development, onboardingReloadKey, sample]);

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

  // Opens the conversation named in the address: on load, and when Back/Forward changes it.
  const urlChatId = searchParams.get('chat');
  useEffect(() => {
    if (sample || !urlChatId || urlChatId === chatId) return;
    let current = true;
    fetchChat(urlChatId).then(thread => {
      if (!current) return;
      setChatId(urlChatId); setCoachReply(null);
      setMessages(thread.messages.map(item => ({ id: ++nextId.current, role: item.role, text: item.content, cards: [] })));
    }).catch(() => {
      if (!current) return;
      // A stale or foreign link falls back to a fresh conversation.
      const params = new URLSearchParams(window.location.search);
      params.delete('chat');
      window.history.replaceState(null, '', `/calendar?${params.toString()}`);
    });
    return () => { current = false; };
  }, [chatId, sample, urlChatId]);

  const draftBlocks = useMemo<ProposedBlock[]>(() => (pendingPlan?.timeline.blocks ?? []).map(block => ({
    kind: 'proposed', id: `draft:${block.operationId}`, operationId: block.operationId, title: block.title,
    startAt: block.startAt, endAt: block.endAt, allDay: false, status: 'proposed',
  })), [pendingPlan]);

  function hrefFor(nextView: WorkspaceView) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', nextView);
    params.delete('google');
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

  /** Keeps the open conversation in the address so a reload or a shared link returns to it. */
  function chatHref(id: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', 'chat');
    params.delete('google');
    if (id) params.set('chat', id); else params.delete('chat');
    return `/calendar?${params.toString()}`;
  }

  function respondToCoach(message: CoachReplyTarget) {
    setCoachReply(message); setInput('');
    window.history.pushState(null, '', hrefFor('chat'));
    window.scrollTo({ top: 0 });
    window.setTimeout(() => document.getElementById('agent-message')?.focus(), 0);
  }

  async function openChat(id: string) {
    if (busy) return;
    setError('');
    try {
      const thread = await fetchChat(id);
      setChatId(id); setCoachReply(null); setInput('');
      setMessages(thread.messages.map(item => ({ id: ++nextId.current, role: item.role, text: item.content, cards: [] })));
      if (thread.chat.unread) void chats.markRead(id);
      window.history.pushState(null, '', chatHref(id));
      window.scrollTo({ top: 0 });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'This chat could not be opened.'); }
  }

  function newChat() {
    if (busy) return;
    setChatId(crypto.randomUUID()); setMessages([]); setCoachReply(null); setError('');
    window.history.pushState(null, '', chatHref(null));
    window.scrollTo({ top: 0 });
    window.setTimeout(() => document.getElementById('agent-message')?.focus(), 0);
  }

  async function checkInNow() {
    const id = await chats.checkInNow();
    if (id) await openChat(id);
  }

  function planUnscheduled(items: readonly UnscheduledWork[]) {
    openRecommendation(`Plan study time for my unscheduled work: ${items.map(item => `${item.title} (${item.minutes} min)`).join(', ')}.`);
  }

  function viewDraftOnCalendar() {
    const first = pendingPlan?.timeline.blocks.map(block => block.startAt).sort()[0];
    if (first) setCalendarFocus({ date: first });
    window.history.pushState(null, '', hrefFor('calendar'));
    window.scrollTo({ top: 0 });
  }

  function openRecommendation(prompt: string) {
    setInput(prompt);
    window.history.pushState(null, '', hrefFor('chat'));
    window.scrollTo({ top: 0 });
    window.setTimeout(() => document.getElementById('agent-message')?.focus(), 0);
  }

  function completeDemoOnboarding(profile: DemoProfile) {
    const goal = profile.goal === 'deadline' ? 'finish urgent work' : profile.goal === 'exam' ? 'build exam confidence' : 'keep the week sustainable';
    const cadence = profile.coachCadence === 'proactive' ? 'flag risks that need a response' : 'stay quiet between weekly summaries';
    setDemoProfile(profile);
    setDemoMemories(demoInitialMemories(demoEpoch, profile.sessionMinutes));
    setMessages([
      { id: ++nextId.current, role: 'user', text: `Optimize for ${goal}; use ${profile.sessionMinutes}-minute sessions; ${cadence}.`, cards: [] },
      { id: ++nextId.current, role: 'assistant', text: `Got it. I’ll optimize for **${goal}**, keep study blocks to **${profile.sessionMinutes} minutes**, and ${cadence}. I saved the focus rhythm as a persistent preference so future plans can reuse it.`, cards: [] },
    ]);
    setCoachRefreshKey(value => value + 1);
    setDemoStage('brief');
  }

  async function completeStudentOnboarding(profile: OnboardingProfile) {
    if (onboardingBusy) return;
    setOnboardingBusy(true); setOnboardingError('');
    try {
      if (development) { try { window.localStorage.setItem('polymate-onboarding', JSON.stringify(profile)); } catch { /* The local preview may use ephemeral storage. */ } }
      else {
        const response = await fetch('/api/onboarding', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
        const body = await response.json() as OnboardingState & { error?: { message?: string } };
        if (!response.ok || !body.completed) throw new Error(body.error?.message ?? 'Your preferences could not be saved.');
      }
      setOnboardingStatus('complete');
      setMessages([{ id: ++nextId.current, role: 'assistant', text: `You’re set. I’ll use **${profile.sessionMinutes}-minute focus sessions** and your coaching preference when we plan. What would you like to make progress on first?`, cards: [] }]);
      setCoachRefreshKey(value => value + 1);
      void chats.refresh();
    } catch (reason) { setOnboardingError(reason instanceof Error ? reason.message : 'Your preferences could not be saved.'); }
    finally { setOnboardingBusy(false); }
  }

  async function runDemoTurn(text: string, action?: { allowPartial: boolean } | { draftToken: string; confirmAssignmentFinished: boolean }) {
    const reply = (body: string, cards: AgentCard[] = []) => {
      setMessages(previous => [...previous, { id: ++nextId.current, role: 'assistant', text: body, cards }].slice(-40) as ChatMessage[]);
    };
    await new Promise(resolve => setTimeout(resolve, 450));

    if (demoStage === 'onboarding') {
      reply('Finish the three onboarding choices first so I can tailor the demo plan.');
      return;
    }

    const profile = demoProfile ?? { goal: 'deadline', sessionMinutes: 50, coachCadence: 'weekly' } as const;

    if (/\badd an assignment\b/i.test(text) && /computer vision exercise sheet 4/i.test(text)) {
      if (!workspace) { reply('The demo assignment store is not available. Reload the demo and try again.'); return; }
      const input = demoCapturedAssignment(demoEpoch);
      const saved = await workspace.assignmentSource.client.createAssignment(input);
      workspace.assignmentSaved(saved);
      reply(`I understood the assignment without a form and saved it:\n\n- **${saved.title}**\n- Due **next Thursday at 18:00 (Europe/Zurich)**\n- **${saved.estimatedMinutes} minutes** estimated effort\n\nIn the live product, I ask only for details that are missing.`);
      return;
    }

    if (demoStage === 'brief') {
      const course = DEMO_COURSES[0];
      const examLens = /exam/i.test(text) || profile.goal === 'exam';
      const framing = examLens
        ? `Problem set 4 is the best near-term choice because its dynamic-programming work also advances the **${course.examPrep.must.join('** and **')}** topics marked as must-do exam preparation.`
        : profile.goal === 'balance'
          ? 'Problem set 4 is the clearest deadline, and it can fit without using Wednesday evening or Friday night.'
          : 'Problem set 4 is the clearest submission risk, due Friday at 18:00.';
      reply(`Your priority is **${course.name}: Problem set 4**. ${framing} ${course.examPrep.optional.join('')} remains optional.\n\nYour calendar is busiest Tuesday afternoon and Friday after 17:30. I also remember your ${profile.sessionMinutes}-minute focus preference.`, [{ kind: 'assignments', data: demoMoodleSnapshot(demoEpoch) }]);
      setDemoStage('remember');
      return;
    }

    if (demoStage === 'remember') {
      const commitment: DemoCommitment = /rehearsal|thursday/i.test(text) ? 'rehearsal' : 'volunteering';
      const memory = demoCommitmentMemory(demoEpoch, commitment);
      setDemoCommitment(commitment);
      setDemoMemories(previous => previous.some(item => item.id === memory.id) ? previous : [...previous, memory]);
      setCoachRefreshKey(value => value + 1);
      reply(`I saved that as a temporary plan for next week: **${memory.content}** I’ll keep that time unavailable when I build the study plan, and the context now appears in Coach → Student memory.`);
      setDemoStage('plan');
      return;
    }

    if (demoStage === 'plan') {
      const style: DemoPlanStyle = /front[- ]?load/i.test(text) ? 'frontload' : 'spread';
      const timeline = demoTimeline(demoEpoch, { sessionMinutes: profile.sessionMinutes, style, commitment: demoCommitment });
      setDemoPlanStyle(style);
      setDemoTradeoffExplained(false);
      setPendingPlan({ timeline, expiresAt: new Date(Date.parse(demoEpoch) + 30 * 60_000).toISOString() });
      const commitmentLabel = demoCommitment === 'volunteering' ? 'Wednesday volunteering' : 'Thursday rehearsal';
      reply(`I found **${timeline.blocks.length} × ${profile.sessionMinutes}-minute sessions** before the deadline and ${style === 'frontload' ? 'front-loaded the work into Monday and Tuesday' : 'spread the work across the available days'}. The draft avoids your Tuesday job, ${commitmentLabel}, and Friday climbing. **Nothing has been written to the calendar yet.**`);
      setDemoStage('approve');
      return;
    }

    if (demoStage === 'approve') {
      if (!action || 'draftToken' in action || !pendingPlan || !workspace) {
        const explainsTradeoff = /explain|why|trade-off/i.test(text);
        if (explainsTradeoff && pendingPlan) setDemoTradeoffExplained(true);
        reply(explainsTradeoff && pendingPlan
          ? demoTradeoffExplanation(pendingPlan.timeline, { sessionMinutes: profile.sessionMinutes, style: demoPlanStyle, commitment: demoCommitment })
          : 'The draft is still unchanged. Choose **Approve all blocks** only when you want to write this exact plan.');
        return;
      }
      const results = [];
      const assignment = demoAssignment(demoEpoch);
      for (const block of pendingPlan.timeline.blocks) {
        const result = await workspace.calendarClient.createStudyBlock(block, block.operationId);
        results.push(result);
        workspace.observe('create', result.event?.id ?? null, result);
        if (result.status === 'synced' && result.event) {
          await workspace.progressClient.link({
            eventId: result.event.id,
            assignmentId: assignment.id,
            expectedAssignmentVersion: assignment.version,
            expectedEtag: result.event.etag,
          });
        }
        if (result.status !== 'synced') break;
      }
      const complete = results.length === pendingPlan.timeline.blocks.length && results.every(item => item.status === 'synced');
      reply(complete ? `All ${pendingPlan.timeline.blocks.length} study blocks were confirmed. Open Calendar at any time to inspect or adjust them.` : 'The calendar returned a partial result. The card below shows exactly which writes were confirmed.', [{ kind: 'schedule', data: demoScheduleCard(pendingPlan.timeline, results) }]);
      setPendingPlan(null);
      setReloadKey(value => value + 1);
      await workspace.refresh();
      setDemoStage('move');
      return;
    }

    if (demoStage === 'move') {
      if (!/\b(move|reschedule|friday)\b/i.test(text) || !workspace) {
        reply(`I have not changed the plan. Try: “${DEMO_PROMPTS.move}”`);
        return;
      }
      const range = demoWeekRange(demoEpoch);
      const events = await workspace.calendarClient.listWeek(range);
      const event = events.find(item => item.source === 'polymate' && item.title.includes('Final review'));
      if (!event) {
        reply('I could not find the final review block. Add the draft first, then ask me to move it.');
        return;
      }
      const target = /15(?::00)?\b/.test(text) ? 'friday-15' : 'friday-16';
      const moved = demoMovedBlock(demoEpoch, target, profile.sessionMinutes);
      const result = await workspace.calendarClient.updateStudyBlock(event.id, moved, event.etag, crypto.randomUUID());
      workspace.observe('update', event.id, result);
      const hour = target === 'friday-15' ? '15:00' : '16:00';
      const endMinute = profile.sessionMinutes === 30 ? target === 'friday-15' ? '15:30' : '16:30' : target === 'friday-15' ? '15:50' : '16:50';
      reply(result.status === 'synced' ? `Done — the final review now runs Friday from ${hour}–${endMinute}, still before the 18:00 deadline and without colliding with climbing.` : 'The move was not confirmed. The result card keeps the outcome explicit.', [{ kind: 'schedule', data: { movedBlock: { title: event.title, ...moved }, result: { results: [result], complete: result.status === 'synced' } } }]);
      setReloadKey(value => value + 1);
      setDemoStage('complete');
      return;
    }

    reply('The guided scenario is complete. You can inspect the resulting blocks in Calendar, the course priorities in Courses, and the saved volunteering plan in Coach.');
  }

  async function sendMessage(event?: FormEvent, action?: { allowPartial: boolean } | { draftToken: string; confirmAssignmentFinished: boolean }, quickReply?: string) {
    event?.preventDefault();
    const studentText = (quickReply ?? input).trim();
    if (busy || (sample && !demo) || (!action && !studentText)) return;
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
    if (!action && quickReply === undefined) setInput('');
    // Only free-form turns can be stopped; scheduling and confirmations change the calendar and must finish.
    const controller = action || scheduleAction ? null : new AbortController();
    inFlight.current = controller;
    setBusy(true); setStoppable(Boolean(controller)); setError(''); setStatus(WORKING);
    // Free-form turns stream tool progress and reply text; actions keep the plain JSON response.
    const streamId = controller ? ++nextId.current : null;
    try {
      if (demo) {
        if (coachReply && !action) {
          await new Promise(resolve => setTimeout(resolve, 450));
          const range = demoWeekRange(demoEpoch);
          setDemoMemories(previous => [...previous.filter(item => item.id !== '99999999-9999-4999-8999-999999999999'), {
            id: '99999999-9999-4999-8999-999999999999', category: 'weekly_context', content: `Coach response: ${studentText}`,
            validUntil: range.to, createdAt: demoEpoch,
          }]);
          setMessages(previous => [...previous, { id: ++nextId.current, role: 'assistant', text: 'Thanks — I marked the coaching question answered and saved that response as context for this week. The guided demo can continue from the same step.', cards: [] }].slice(-40) as ChatMessage[]);
          setDemoCoachAnswers(value => value + 1);
          setCoachReply(null);
          setCoachRefreshKey(value => value + 1);
          return;
        }
        await runDemoTurn(text, action);
        return;
      }
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
        body: JSON.stringify({ ...(action ? 'draftToken' in action ? { action: 'confirm_progress', draftToken: action.draftToken, confirmAssignmentFinished: action.confirmAssignmentFinished } : { action: 'schedule_current_plan', allowPartial: action.allowPartial, timelineId: pendingPlan?.timeline.id } : scheduleAction ?? { message: text, semesterPlan: readSemesterPlan() }), conversationId: chatId }),
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
      void chats.refresh();
      if (searchParams.get('chat') !== chatId) window.history.replaceState(null, '', (() => {
        const params = new URLSearchParams(window.location.search);
        params.set('chat', chatId);
        return `/calendar?${params.toString()}`;
      })());
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
      // Give the unanswered message back so it can be resent without retyping.
      if (!action) setInput(current => current || studentText);
      if (action) setMessages(previous => [...previous, { id: ++nextId.current, role: 'assistant', text: message, cards: [] }]);
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      setBusy(false); setStoppable(false); setStreamingId(null);
    }
  }

  function stopMessage() {
    inFlight.current?.abort();
  }

  const activeChat = chats.chats.find(chat => chat.id === chatId);
  const quickReplies = activeChat && !messages.some(message => message.role === 'user') ? activeChat.quickReplies : [];
  const waitingCheckIns = unreadCheckIns(chats.chats, chatId);
  const firstName = ownerName.trim().split(/[\s@]/)[0] || 'there';
  const nextEventTime = nextEvent ? new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Zurich', weekday: 'long', hour: '2-digit', minute: '2-digit',
  }).format(new Date(nextEvent.startAt)) : null;
  const pageTitle = view === 'calendar' ? 'Calendar' : view === 'courses' ? 'Courses' : view === 'planner' ? 'Semester plan' : 'Settings';
  const pageDescription = view === 'calendar' ? 'Your scheduled study blocks and connected calendar events.'
    : view === 'courses' ? 'Course workload, assignments, and exam preparation priorities.'
      : view === 'planner' ? 'Choose courses that fit your major, minor, and graduation path.'
      : 'Connections and preferences for your study space.';
  const demoRange = demo ? demoWeekRange(demoEpoch) : null;
  const demoCoach = demo ? demoCoachingState(demoEpoch, demoMemories, demoProfile?.coachCadence === 'proactive', demoCoachAnswers) : undefined;
  const demoOnboarding = demo && demoStage === 'onboarding';
  const studentOnboarding = !demo && !sample && onboardingStatus !== 'complete';
  const onboardingActive = demoOnboarding;

  if (studentOnboarding) return <div className="flex min-h-dvh flex-col bg-muted/25">
    <header className="flex h-16 shrink-0 items-center border-b bg-background px-5 sm:px-8"><Link href="/" className="text-xl font-semibold tracking-tight">PolyMate</Link></header>
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8 sm:px-8">
      {onboardingStatus === 'required' && <StudentOnboarding demo={false} busy={onboardingBusy} error={onboardingError} onComplete={profile => void completeStudentOnboarding(profile)} />}
      {onboardingStatus === 'loading' && <div className="my-auto text-center"><p className="text-sm font-medium">Preparing your study space…</p><p className="mt-2 text-sm text-muted-foreground">Loading your saved preferences.</p></div>}
      {onboardingStatus === 'error' && <div className="my-auto mx-auto max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm"><h1 className="text-xl font-semibold">Your setup could not be loaded</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{onboardingError}</p><Button type="button" className="mt-5" onClick={() => { setOnboardingStatus('loading'); setOnboardingError(''); setOnboardingReloadKey(value => value + 1); }}>Try again</Button></div>}
    </main>
  </div>;

  return <div className="min-h-dvh bg-background md:flex md:items-start">
    <WorkspaceSidebar view={view} ownerName={ownerName} demo={demo} hrefFor={hrefFor} onNavigate={navigate} />
    <main className={view === 'chat' ? 'flex h-[calc(100dvh-57px)] min-w-0 flex-1 flex-col overflow-hidden md:h-dvh' : 'min-w-0 flex-1'}>
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 sm:px-6">
        <p className="truncate text-sm font-medium">{view === 'chat' ? <>Chat {demo && <span className="ml-2 rounded-full bg-muted px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Demo</span>}</> : <>PolyMate <span className="text-muted-foreground">/ {pageTitle}</span></>}</p>
        <div className="flex items-center gap-1">
          <CoachInbox key={demo ? `${demoProfile?.coachCadence ?? 'setup'}:${demoCoachAnswers}:${demoMemories.map(item => item.id).join(':')}` : 'coach'} sample={sample} sampleOverride={demoCoach} refreshKey={coachRefreshKey} onRespond={respondToCoach} onOutstandingChange={setCoachOutstanding} />
        </div>
      </header>
      {!demo && view !== 'chat' && <CheckInNotice chats={waitingCheckIns} floating disabled={busy} onOpen={chat => void openChat(chat.id)} />}

      <div className={view === 'chat' ? 'min-h-0 flex-1' : 'mx-auto w-full max-w-7xl px-4 py-8 sm:px-7 md:px-10 md:py-10 lg:px-12'}>
        {view !== 'chat' && <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">{pageTitle}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{pageDescription}</p>
        </header>}

        {/* Keep panels mounted so navigation preserves drafts, forms, and calendar state. */}
        <section aria-label="Calendar" className={view === 'calendar' ? 'block' : 'hidden'}>
          <div className="min-w-0"><CalendarStudyWorkflow sample={sample} demo={demo} externalReloadKey={reloadKey} initialDate={demoRange?.from} draftBlocks={draftBlocks} focus={calendarFocus} onPlanUnscheduled={sample && !demo ? undefined : planUnscheduled} /></div>
        </section>

        <section aria-label="Courses" className={view === 'courses' ? 'space-y-6' : 'hidden'}>
          <CoursesPanel sample={sample} demo={demo} onAddAssignment={() => openRecommendation(demo ? DEMO_ASSIGNMENT_CAPTURE_PROMPT : 'I want to add an assignment (use Europe/Zurich time): ')} />
          <AssignmentsPanel sample={sample} onCalendarChange={() => setReloadKey(value => value + 1)} />
        </section>

        <section aria-label="Semester planning" className={view === 'planner' ? '' : 'hidden'}>
          <SemesterPlanner sample={sample} />
        </section>

        <div className={view === 'chat' ? 'flex h-full min-h-0 flex-col md:flex-row' : 'hidden'}>
          <ChatHistoryRail chats={demo ? [] : chats.chats} activeChatId={chatId} demo={demo} disabled={busy || demo} onOpenChat={chat => void openChat(chat.id)} onNewChat={newChat} />
        <section aria-labelledby="study-chat-title" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <h2 id="study-chat-title" className="sr-only">Plan with PolyMate</h2>
          <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-relevant="additions text">
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 pb-8 pt-6 sm:px-6">
              {demoOnboarding && <StudentOnboarding demo onComplete={completeDemoOnboarding} />}
              {!onboardingActive && !messages.length && <div className="my-auto flex flex-col items-center py-5 text-center sm:py-10">
                <h1 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-4xl">{demo ? 'See PolyMate work across your study week' : `How are you feeling, ${firstName}?`}</h1>
                <p className="mt-3 max-w-xl text-sm leading-5 text-muted-foreground sm:mt-4 sm:leading-6">{demo ? <><span className="sm:hidden">Try the real Chat, memory, approval flow, and calendar.</span><span className="hidden sm:inline">This guided conversation uses the real Chat interface, cards, approval flow, and in-memory calendar contract. Every demonstrated capability also exists in the production agent.</span></> : nextEvent && nextEventTime ? <>Your next event is <span className="font-medium text-foreground">{nextEvent.title}</span> on {nextEventTime}.</> : 'Your calendar is clear for now. What would you like to make progress on?'}</p>
                {coachOutstanding > 0 && <button type="button" onClick={() => document.getElementById('coach-notifications-trigger')?.click()} className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950 shadow-sm hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900">Your coach needs {coachOutstanding} response{coachOutstanding === 1 ? '' : 's'} from you</button>}
                {!demo && !sample && <SetupChecklist active={view === 'chat'} hrefFor={hrefFor} onNavigate={navigate} />}
                <div className="mt-8 grid w-full gap-2 sm:grid-cols-3">
                  {!demo && ['Plan my week', 'What should I study next?', 'Show my upcoming deadlines'].map(prompt => <button key={prompt} type="button" disabled={busy || sample} onClick={() => void sendMessage(undefined, undefined, prompt)} className="rounded-xl border bg-card px-4 py-3 text-left text-sm shadow-sm transition-colors hover:bg-accent disabled:opacity-50">{prompt}</button>)}
                </div>
              </div>}

              {messages.length > 0 && <div className="space-y-7 py-4">
                {messages.map(message => <article key={message.id} aria-busy={message.id === streamingId} className={message.role === 'user' ? 'ml-auto max-w-[85%] rounded-2xl bg-secondary px-4 py-3' : 'max-w-full'}>
                  {message.role === 'assistant' ? <MessageContent text={message.text} /> : <p className="whitespace-pre-wrap text-sm leading-6">{message.text}</p>}
                  {message.role === 'assistant' && <OtherCards cards={message.cards} busy={busy} confirmed={confirmedProgress} onConfirm={(draftToken, confirmAssignmentFinished) => void sendMessage(undefined, { draftToken, confirmAssignmentFinished })} />}
                </article>)}
                {!demo && quickReplies.length > 0 && !busy && <div className="flex flex-wrap gap-2" aria-label="Suggested replies">
                  {quickReplies.map(reply => <button key={reply} type="button" onClick={() => void sendMessage(undefined, undefined, reply)} className="rounded-full border bg-card px-3.5 py-1.5 text-sm shadow-sm transition-colors hover:bg-accent">{reply}</button>)}
                </div>}
                {busy && streamingId === null && <p className="text-sm text-muted-foreground" role="status">{status}</p>}
                {pendingPlan && <TimelinePreview plan={pendingPlan} onSchedule={allowPartial => void sendMessage(undefined, { allowPartial })} onViewCalendar={viewDraftOnCalendar} busy={busy} />}
                <div ref={messagesEnd} />
              </div>}
            </div>
          </div>

          <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent px-4 pb-3 pt-3 sm:px-6 sm:pb-5">
            <div className="mx-auto max-w-3xl">
              {onboardingActive ? <p className="text-center text-xs text-muted-foreground">Choose one option in each group to continue.</p> : <>
              {error && <p className="mb-2 text-sm text-destructive" role="alert">{error}</p>}
              {demo && <DemoGuide stage={demoStage} busy={busy} coachOutstanding={coachOutstanding} tradeoffExplained={demoTradeoffExplained} onRun={prompt => void sendMessage(undefined, undefined, prompt)} onApprove={() => void sendMessage(undefined, { allowPartial: false })} onOpenCalendar={() => { window.history.pushState(null, '', hrefFor('calendar')); window.scrollTo({ top: 0 }); }} onOpenCourses={() => { window.history.pushState(null, '', hrefFor('courses')); window.scrollTo({ top: 0 }); }} onDescribeAssignment={() => openRecommendation(DEMO_ASSIGNMENT_CAPTURE_PROMPT)} onOpenCoach={() => document.getElementById('coach-notifications-trigger')?.click()} />}
              {!demo && view === 'chat' && waitingCheckIns.length > 0 && <div className="mb-2"><CheckInNotice chats={waitingCheckIns} floating={false} disabled={busy} onOpen={chat => void openChat(chat.id)} /></div>}
              {coachReply && <div className="mb-2 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"><div><p className="text-xs font-medium text-amber-800 dark:text-amber-300">Answering your coach</p><p className="mt-1">{coachReply.body}</p></div><button type="button" onClick={() => setCoachReply(null)} className="shrink-0 text-xs underline">Cancel</button></div>}
              <form onSubmit={event => void sendMessage(event)} className="relative rounded-2xl border bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
                <label htmlFor="agent-message" className="sr-only">Message PolyMate</label>
                <textarea id="agent-message" value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => {
                  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  void sendMessage();
                }} maxLength={4000} rows={2} disabled={sample && !demo} placeholder={coachReply ? 'Write your answer for this week…' : 'Ask PolyMate anything…'} className="max-h-40 min-h-12 w-full resize-none bg-transparent px-2 py-2 pr-12 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60" />
                {busy && !input.trim()
                  ? <Button type="button" size="icon" onClick={stopMessage} disabled={!stoppable} aria-label="Stop PolyMate" className="absolute bottom-2 right-2 rounded-full"><Square className="fill-current" aria-hidden="true" /></Button>
                  : <Button size="icon" disabled={busy || (sample && !demo) || !input.trim()} aria-label="Send message" className="absolute bottom-2 right-2 rounded-full"><ArrowUp aria-hidden="true" /></Button>}
              </form>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">{demo ? 'Guided fixture · no external accounts or writes.' : sample ? 'Chat is unavailable in sample mode.' : 'PolyMate can make mistakes. Review calendar changes before approving them.'}</p>
              </>}
            </div>
          </div>
        </section>
        </div>

        <section aria-label="Settings" className={view === 'settings' ? 'grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]' : 'hidden'}>
          <MoodleConnection />
          <div className="space-y-5">
            {!sample && <CoachPreferences development={development} onSaved={() => { setCoachRefreshKey(value => value + 1); void chats.refresh(); }} />}
            {!sample && <CheckInSettings paused={chats.checkInsPaused} error={chats.error} disabled={busy} onPause={paused => void chats.setPaused(paused)} onCheckInNow={() => void checkInNow()} />}
            <section className="rounded-xl border bg-card p-6 shadow-sm"><h2 className="text-lg font-medium">Google Calendar</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Connect your primary calendar so PolyMate can protect existing commitments while it plans, and choose whether study blocks are saved there. Personal events remain read-only.</p><GoogleConnection demo={demo} onCalendarChange={() => setReloadKey(value => value + 1)} /></section>
            <section className="rounded-xl border bg-card p-6 shadow-sm"><h2 className="text-sm font-medium">Your study space</h2><dl className="mt-4 space-y-4 text-sm"><div><dt className="text-xs text-muted-foreground">Signed in as</dt><dd className="mt-1 break-words">{ownerName}</dd></div><div><dt className="text-xs text-muted-foreground">Calendar timezone</dt><dd className="mt-1">Europe/Zurich</dd></div></dl>
              <div className="mt-4 flex flex-wrap gap-2 border-t pt-4"><ThemeToggle className="border" /></div></section>
          </div>
        </section>
      </div>
    </main>
  </div>;
}
