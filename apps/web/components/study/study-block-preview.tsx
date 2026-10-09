'use client';

import { useEffect, useRef, useState } from 'react';
import { StudyBlockDialog } from './study-block-dialog';
import { type StudyBlockDialogEvent, type StudyBlockInput, type StudyBlockOperationResult } from './study-block-form';

type Scenario = 'success' | 'failure' | 'unknown' | 'throws' | 'pending';
type FixtureRequest = { action: 'create'; input: StudyBlockInput } | {
  action: 'update'; eventId: string; expectedEtag: string; input: StudyBlockInput;
} | { action: 'complete' | 'delete'; eventId: string; expectedEtag: string };

const initialEvent: StudyBlockDialogEvent = {
  id: 'fixture-study-block', title: 'Attempt algorithms questions 1–2',
  startAt: '2026-10-09T07:00:00.000Z', endAt: '2026-10-09T08:15:00.000Z',
  timezone: 'Europe/Zurich', source: 'polymate', editable: true, completion: 'open', etag: '"fixture-v1"',
};

export function StudyBlockPreview() {
  const [open, setOpen] = useState(false);
  const [scenario, setScenario] = useState<Scenario>('success');
  const [prefill, setPrefill] = useState(true);
  const [mode, setMode] = useState<'create' | 'edit' | 'personal'>('create');
  const [fixtureEvent, setFixtureEvent] = useState<StudyBlockDialogEvent | null>(initialEvent);
  const [openedEvent, setOpenedEvent] = useState<StudyBlockDialogEvent | null>(null);
  const [lastRequest, setLastRequest] = useState<FixtureRequest | null>(null);
  const [calls, setCalls] = useState(0);
  const [operationResult, setOperationResult] = useState<StudyBlockOperationResult>();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  async function runFixture(request: FixtureRequest): Promise<StudyBlockOperationResult> {
    const operationId = crypto.randomUUID();
    setLastRequest(request);
    setCalls(count => count + 1);
    await new Promise<void>(resolve => { timers.current.push(setTimeout(resolve, 1200)); });
    if (scenario === 'throws') throw new Error('Simulated ambiguous transport failure.');
    if (scenario === 'failure') return {
      operationId, status: 'failed', error: { message: request.action === 'delete' ? 'Simulated deletion failure: reconnect and try again. The saved fixture is unchanged.' : request.action === 'complete' ? 'Simulated connection failure: reconnect before marking this block done.' : 'Simulated conflict: choose another slot and try again.' },
    };
    if (scenario === 'unknown') return { operationId, status: 'unknown' };
    if (request.action !== 'create' && (!fixtureEvent || request.eventId !== fixtureEvent.id || request.expectedEtag !== fixtureEvent.etag)) {
      return { operationId, status: 'failed', error: { message: 'The fixture event changed. Close and reopen to review its latest values.' } };
    }
    const confirm = () => {
      if (request.action === 'update') {
        setFixtureEvent(previous => previous ? ({ ...previous, ...request.input, etag: `"fixture-${operationId}"` }) : null);
      } else if (request.action === 'complete') {
        setFixtureEvent(previous => previous ? ({ ...previous, completion: 'done', etag: `"fixture-${operationId}"` }) : null);
      } else if (request.action === 'delete') {
        setFixtureEvent(null);
      }
    };
    if (scenario === 'pending') {
      timers.current.push(setTimeout(() => { confirm(); setOperationResult({ operationId, status: 'synced' }); }, 2500));
      return { operationId, status: 'pending' };
    }
    confirm();
    return { operationId, status: 'synced' };
  }

  return <main className="mx-auto max-w-2xl px-6 py-12">
    <p className="text-xs font-semibold uppercase tracking-widest text-[#658071]">Development fixture</p>
    <h1 className="mt-3 text-3xl font-semibold">Study-block dialog preview</h1>
    <p className="mt-4 text-sm leading-6 text-[#617269]">Test creation, edit/move, Mark done, and confirmed deletion with fake callbacks. No Google events are loaded or saved. This page is available only with pnpm dev.</p>
    <section className="mt-6 space-y-5 rounded-2xl border border-[#dce3db] bg-white p-6" aria-label="Fixture controls">
      <div>
        <label htmlFor="fixture-mode" className="text-sm font-medium">Dialog mode</label>
        <select id="fixture-mode" value={mode} onChange={event => setMode(event.target.value as typeof mode)} className="mt-2 block w-full rounded-lg border border-[#c8d3c8] bg-white p-3 text-sm">
          <option value="create">Create a new block</option>
          <option value="edit">Edit/move the saved fixture block (initially 75 minutes)</option>
          <option value="personal">View a read-only personal event</option>
        </select>
      </div>
      <div>
        <label htmlFor="fixture-outcome" className="text-sm font-medium">Submission outcome</label>
        <select id="fixture-outcome" value={scenario} onChange={event => setScenario(event.target.value as Scenario)} className="mt-2 block w-full rounded-lg border border-[#c8d3c8] bg-white p-3 text-sm">
          <option value="success">Success after 1.2 seconds</option>
          <option value="failure">Failed — simulated conflict</option>
          <option value="unknown">Uncertain — unconfirmed write</option>
          <option value="throws">Thrown error — ambiguous transport failure</option>
          <option value="pending">Pending, then confirmed after another 2.5 seconds</option>
        </select>
      </div>
      {mode === 'create' && <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={prefill} onChange={event => setPrefill(event.target.checked)} />
        Prefill 9 October 2026 at 09:00 Zurich time
      </label>}
      <button type="button" onClick={() => { setOpenedEvent(fixtureEvent ? { ...fixtureEvent } : null); setOperationResult(undefined); setOpen(true); }} disabled={mode === 'edit' && !fixtureEvent} className="rounded-lg bg-[#173b32] px-4 py-3 text-sm font-medium text-white disabled:opacity-50">Open study-block dialog</button>
      <button type="button" onClick={() => { setFixtureEvent({ ...initialEvent }); setOperationResult(undefined); }} className="ml-3 rounded-lg border border-[#c8d3c8] px-4 py-3 text-sm font-medium">Reset saved fixture</button>
      {!fixtureEvent && <p className="text-sm text-[#617269]">The fixture block was deleted. Reset the saved fixture to test it again.</p>}
    </section>
    <section className="mt-6" aria-label="Callback inspection">
      <h2 className="text-lg font-semibold">Callback calls: {calls}</h2>
      <p className="mt-2 text-sm text-[#617269]">Invalid submissions should not increase this count. Valid submissions send the following data:</p>
      <pre className="mt-3 overflow-x-auto rounded-xl border border-[#dce3db] bg-white p-4 text-xs">{lastRequest ? JSON.stringify(lastRequest, null, 2) : 'No callback invoked yet.'}</pre>
      <h2 className="mt-5 text-lg font-semibold">Saved fixture block</h2>
      <p className="mt-2 text-sm text-[#617269]">Only confirmed mutations change or remove this in-memory record. Close and reopen edit mode to see saved changes.</p>
      <pre className="mt-3 overflow-x-auto rounded-xl border border-[#dce3db] bg-white p-4 text-xs">{fixtureEvent ? JSON.stringify(fixtureEvent, null, 2) : 'No saved fixture block — confirmed deletion.'}</pre>
    </section>
    <StudyBlockDialog open={open} selectedEvent={mode === 'create' ? null : mode === 'edit' ? fixtureEvent ?? openedEvent : {
      ...initialEvent, id: 'fixture-personal-event', title: 'Lunch with friends', source: 'google-personal', editable: false,
    }} initialStartAt={prefill ? '2026-10-09T07:00:00.000Z' : undefined}
      onClose={() => setOpen(false)} onCreate={input => runFixture({ action: 'create', input })}
      onUpdate={(eventId, input, expectedEtag) => runFixture({ action: 'update', eventId, input, expectedEtag })}
      onComplete={(eventId, expectedEtag) => runFixture({ action: 'complete', eventId, expectedEtag })}
      onDelete={(eventId, expectedEtag) => runFixture({ action: 'delete', eventId, expectedEtag })}
      operationResult={operationResult} fixtureMode />
  </main>;
}
