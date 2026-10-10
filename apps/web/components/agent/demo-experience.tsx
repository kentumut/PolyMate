'use client';

import type { CalendarEvent } from '@polymate/contracts/calendar';
import type { DateRange } from '@polymate/contracts/time';
import { useEffect, useRef, useState } from 'react';
import { WeekView } from '@/components/calendar/week-view';

type DemoStep = 0 | 1 | 2 | 3 | 4;
type DemoMessage = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  kind?: 'assignment' | 'plan' | 'scheduled' | 'moved';
};

const RANGE: DateRange = {
  from: '2026-10-11T22:00:00.000Z',
  to: '2026-10-18T22:00:00.000Z',
};

const BASE_EVENTS: CalendarEvent[] = [
  event('lecture-ml', 'Machine Learning lecture', '2026-10-12T08:00:00.000Z', '2026-10-12T10:00:00.000Z'),
  event('team-project', 'Design project', '2026-10-12T12:00:00.000Z', '2026-10-12T14:00:00.000Z'),
  event('gym', 'Gym', '2026-10-13T15:00:00.000Z', '2026-10-13T16:00:00.000Z'),
  event('lecture-data', 'Data Visualisation', '2026-10-14T08:00:00.000Z', '2026-10-14T10:00:00.000Z'),
  event('student-job', 'Student job', '2026-10-15T11:00:00.000Z', '2026-10-15T15:00:00.000Z'),
  event('dinner', 'Dinner with Lea', '2026-10-16T16:30:00.000Z', '2026-10-16T18:00:00.000Z'),
  {
    id: 'deadline-ml', title: 'Deadline · ML problem set 4', startAt: '2026-10-16T22:00:00.000Z', endAt: '2026-10-17T22:00:00.000Z',
    timezone: 'Europe/Zurich', allDay: true, source: 'google-personal', editable: false, completion: 'open', etag: 'demo-deadline',
  },
];

const STUDY_EVENTS: CalendarEvent[] = [
  studyEvent('study-1', 'ML problem set · concepts', '2026-10-13T16:30:00.000Z', '2026-10-13T17:20:00.000Z'),
  studyEvent('study-2', 'ML problem set · exercises', '2026-10-14T13:00:00.000Z', '2026-10-14T13:50:00.000Z'),
  studyEvent('study-3', 'ML problem set · final review', '2026-10-15T15:30:00.000Z', '2026-10-15T16:20:00.000Z'),
];

function event(id: string, title: string, startAt: string, endAt: string): CalendarEvent {
  return { id, title, startAt, endAt, timezone: 'Europe/Zurich', allDay: false, source: 'google-personal', editable: false, completion: 'open', etag: `demo-${id}` };
}

function studyEvent(id: string, title: string, startAt: string, endAt: string): CalendarEvent {
  return { id, title, startAt, endAt, timezone: 'Europe/Zurich', allDay: false, source: 'polymate', editable: true, completion: 'open', etag: `demo-${id}` };
}

const ACTIONS = [
  { user: 'What deadlines do I have this week?', assistant: 'You have one upcoming Moodle deadline: Machine Learning problem set 4, due Saturday at 00:00. Moodle describes it as a four-part exercise sheet.', kind: 'assignment' as const },
  { user: 'Plan it around my calendar. I need about 2½ hours.', assistant: 'I found three focused 50-minute sessions that avoid your lectures, project meeting, job, and personal plans. Nothing has been added yet.', kind: 'plan' as const },
  { user: 'Add this plan to my calendar.', assistant: 'Google Calendar confirmed all three study blocks. Your calendar is updated.', kind: 'scheduled' as const },
  { user: 'Move Thursday’s review to Friday at 16:00.', assistant: 'Done — Google Calendar confirmed the review moved to Friday, 16:00–16:50.', kind: 'moved' as const },
];

const BUTTON_LABELS = [
  'Find my deadlines',
  'Build a study plan',
  'Approve & add to calendar',
  'Move a study block',
];

export function DemoExperience() {
  const [step, setStep] = useState<DemoStep>(0);
  const [messages, setMessages] = useState<DemoMessage[]>([
    { id: 1, role: 'assistant', text: 'Hi Alex — I can turn your Moodle deadlines into a study plan that works around your week. Try the guided demo below.' },
  ]);
  const [events, setEvents] = useState<CalendarEvent[]>(BASE_EVENTS);
  const [range, setRange] = useState<DateRange>(RANGE);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('Mock Google Calendar · no account or API required');
  const nextId = useRef(1);
  const transcript = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  function runNext() {
    if (busy || step >= 4) return;
    const action = ACTIONS[step];
    setMessages(previous => [...previous, { id: ++nextId.current, role: 'user', text: action.user }]);
    setBusy(true);
    window.setTimeout(() => {
      if (step === 2) {
        setEvents(previous => [...previous.filter(item => !item.id.startsWith('study-')), ...STUDY_EVENTS]);
        setNotice('3 study blocks added · mock calendar updated');
        setSelectedId('study-1');
      }
      if (step === 3) {
        setEvents(previous => previous.map(item => item.id === 'study-3'
          ? { ...item, startAt: '2026-10-16T14:00:00.000Z', endAt: '2026-10-16T14:50:00.000Z', etag: 'demo-study-3-moved' }
          : item));
        setNotice('Study block moved · mock calendar updated');
        setSelectedId('study-3');
      }
      setMessages(previous => [...previous, { id: ++nextId.current, role: 'assistant', text: action.assistant, kind: action.kind }]);
      setStep(value => (value + 1) as DemoStep);
      setBusy(false);
    }, 650);
  }

  function reset() {
    setStep(0);
    setMessages([{ id: ++nextId.current, role: 'assistant', text: 'Hi Alex — I can turn your Moodle deadlines into a study plan that works around your week. Try the guided demo below.' }]);
    setEvents(BASE_EVENTS);
    setRange(RANGE);
    setBusy(false);
    setSelectedId(null);
    setNotice('Mock Google Calendar · no account or API required');
  }

  return <main className="min-h-dvh bg-[#f3f5f0] text-[#173b32]">
    <header className="border-b border-[#dce3db] bg-[#f8faf6] px-4 py-3 sm:px-7">
      <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
        <a href="/calendar" className="flex items-center gap-3 font-semibold tracking-tight" aria-label="Open PolyMate">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#173b32] text-lg text-white" aria-hidden="true">p.</span>
          <span>PolyMate</span>
        </a>
        <div className="flex items-center gap-3">
          <span className="hidden rounded-full border border-[#d4dfd6] bg-white px-3 py-1.5 text-xs text-[#617269] sm:inline">Interactive product tour</span>
          <button type="button" onClick={reset} className="rounded-lg px-3 py-2 text-sm font-medium text-[#50685d] hover:bg-[#e8eee7]">Restart demo</button>
        </div>
      </div>
    </header>

    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-7 lg:px-8 lg:py-8">
      <section className="mb-6 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#648071]">
            <span className="h-2 w-2 rounded-full bg-[#e7a83e]" /> Live demo · mock data
          </div>
          <h1 className="max-w-3xl text-3xl font-medium tracking-[-0.035em] sm:text-4xl">From deadline to a protected study plan.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#617269]">Follow one realistic conversation. PolyMate reads course dates, works around existing events, previews every change, and writes only after approval.</p>
        </div>
        <ol className="flex min-w-0 gap-2" aria-label={`Demo progress, step ${Math.min(step + 1, 4)} of 4`}>
          {['Find', 'Plan', 'Approve', 'Adapt'].map((label, index) => <li key={label} className="min-w-0 flex-1 lg:w-24">
            <div className={`h-1.5 rounded-full transition-colors duration-500 ${index < step ? 'bg-[#2f6b55]' : index === step && step < 4 ? 'bg-[#e7a83e]' : 'bg-[#d9e1d8]'}`} />
            <p className={`mt-2 text-[10px] font-semibold uppercase tracking-wider ${index <= step ? 'text-[#3f5d50]' : 'text-[#94a098]'}`}>{index + 1}. {label}</p>
          </li>)}
        </ol>
      </section>

      <div className="grid min-h-[720px] overflow-hidden rounded-[24px] border border-[#d6dfd6] bg-white shadow-[0_20px_60px_rgba(38,62,51,0.08)] xl:grid-cols-[minmax(360px,0.78fr)_minmax(700px,1.5fr)]">
        <section className="flex min-h-[620px] flex-col border-b border-[#dce3db] bg-[#fbfcf9] xl:border-r xl:border-b-0" aria-labelledby="demo-chat-title">
          <header className="flex items-center gap-3 border-b border-[#e5eae4] px-5 py-4 sm:px-6">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#e6eee5] font-semibold">p.</span>
            <div className="min-w-0 flex-1"><h2 id="demo-chat-title" className="font-semibold">PolyMate assistant</h2><p className="text-xs text-[#748278]">Grounded in your course dates and calendar</p></div>
            <span className="flex items-center gap-1.5 text-xs text-[#507263]"><span className="h-2 w-2 rounded-full bg-[#52a779]" /> Ready</span>
          </header>

          <div ref={transcript} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite">
            {messages.map(message => <article key={message.id} className={message.role === 'user' ? 'ml-auto max-w-[88%]' : 'max-w-[95%]'}>
              <div className={`rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'rounded-br-md bg-[#173b32] text-white' : 'rounded-bl-md border border-[#e2e8e0] bg-white text-[#294238] shadow-sm'}`}>
                <p>{message.text}</p>
                {message.kind === 'assignment' && <AssignmentResult />}
                {message.kind === 'plan' && <PlanResult />}
                {message.kind === 'scheduled' && <ResultNote icon="✓" label="3 of 3 blocks confirmed" detail="Written to Google Calendar" />}
                {message.kind === 'moved' && <ResultNote icon="↗" label="Review session moved" detail="Friday · 16:00–16:50" />}
              </div>
              <p className={`mt-1.5 text-[10px] text-[#8a968f] ${message.role === 'user' ? 'text-right' : ''}`}>{message.role === 'user' ? 'You' : 'PolyMate'} · just now</p>
            </article>)}
            {busy && <div className="max-w-[75%] rounded-2xl rounded-bl-md border border-[#e2e8e0] bg-white px-4 py-3 shadow-sm" role="status">
              <div className="flex items-center gap-3 text-xs text-[#617269]"><span className="flex gap-1" aria-hidden="true"><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#638171]" /><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#638171] [animation-delay:150ms]" /><i className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#638171] [animation-delay:300ms]" /></span>{step === 0 ? 'Reading Moodle dates…' : step === 1 ? 'Checking calendar conflicts…' : 'Updating your calendar…'}</div>
            </div>}
          </div>

          <footer className="border-t border-[#e5eae4] bg-white p-4 sm:p-5">
            {step < 4 ? <button type="button" onClick={runNext} disabled={busy} className="group flex w-full items-center justify-between gap-3 rounded-xl bg-[#173b32] px-4 py-3.5 text-left text-sm font-medium text-white transition hover:bg-[#224e41] disabled:cursor-wait disabled:opacity-60">
              <span><span className="mr-2 text-white/55">Try:</span>{BUTTON_LABELS[step]}</span><span className="transition-transform group-hover:translate-x-0.5" aria-hidden="true">→</span>
            </button> : <div className="flex items-center justify-between gap-3 rounded-xl border border-[#cfe0d2] bg-[#edf6ee] px-4 py-3 text-sm text-[#2f6049]"><span><strong>Demo complete.</strong> The plan changed with the conversation.</span><button type="button" onClick={reset} className="shrink-0 underline">Replay</button></div>}
            <p className="mt-3 text-center text-[11px] text-[#8a968f]">Mock actions stay in this browser and reset on refresh.</p>
          </footer>
        </section>

        <section className="min-w-0 bg-white p-4 sm:p-6 lg:p-7" aria-labelledby="demo-calendar-title">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#748278]">Calendar changes live</p><h2 id="demo-calendar-title" className="mt-1 text-xl font-medium">Alex’s study week</h2></div>
            <div className="flex items-center gap-2 rounded-full bg-[#eef3ec] px-3 py-1.5 text-xs text-[#507263]"><span className="h-2 w-2 rounded-full bg-[#52a779]" /> Moodle + Google connected</div>
          </div>
          <WeekView range={range} events={events} notice={notice} selectedId={selectedId} now={new Date('2026-10-13T12:10:00.000Z')} onSelect={setSelectedId} onRangeChange={setRange} />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Metric value="1" label="deadline found" />
            <Metric value={step >= 3 ? '3' : '0'} label="study blocks added" active={step >= 3} />
            <Metric value={step >= 4 ? '1' : '0'} label="plan adapted" active={step >= 4} />
          </div>
        </section>
      </div>
    </div>
  </main>;
}

function AssignmentResult() {
  return <div className="mt-3 border-t border-[#e5eae4] pt-3">
    <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[#668071]"><span>✓</span> Moodle calendar checked</div>
    <div className="rounded-xl bg-[#f5f7f2] p-3"><div className="flex justify-between gap-3"><div><p className="font-semibold">Problem set 4</p><p className="mt-0.5 text-xs text-[#617269]">Machine Learning</p></div><span className="h-fit rounded-full bg-[#fff0d6] px-2 py-1 text-[10px] font-semibold text-[#8a5a26]">Due Sat</span></div></div>
  </div>;
}

function PlanResult() {
  return <div className="mt-3 border-t border-[#e5eae4] pt-3">
    <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-[#668071]"><span>✓</span> 6 events checked · no conflicts</div>
    <ol className="space-y-1.5 text-xs">
      <li className="flex justify-between rounded-lg bg-[#f5f7f2] px-3 py-2"><span>Concepts</span><strong>Tue · 18:30</strong></li>
      <li className="flex justify-between rounded-lg bg-[#f5f7f2] px-3 py-2"><span>Exercises</span><strong>Wed · 15:00</strong></li>
      <li className="flex justify-between rounded-lg bg-[#f5f7f2] px-3 py-2"><span>Final review</span><strong>Thu · 17:30</strong></li>
    </ol>
    <p className="mt-2 text-[11px] text-[#8a6a30]">Draft only · waiting for your approval</p>
  </div>;
}

function ResultNote({ icon, label, detail }: { icon: string; label: string; detail: string }) {
  return <div className="mt-3 flex items-center gap-3 rounded-xl bg-[#edf6ee] p-3 text-xs text-[#2f6049]"><span className="grid h-7 w-7 place-items-center rounded-full bg-[#cfe7d4] font-bold" aria-hidden="true">{icon}</span><span><strong className="block">{label}</strong><span>{detail}</span></span></div>;
}

function Metric({ value, label, active = false }: { value: string; label: string; active?: boolean }) {
  return <div className={`rounded-xl border px-4 py-3 transition-colors duration-500 ${active ? 'border-[#bcd5c1] bg-[#f0f7ef]' : 'border-[#e1e7e0] bg-[#fafbf8]'}`}><p className="text-xl font-semibold">{value}</p><p className="mt-0.5 text-xs text-[#748278]">{label}</p></div>;
}
