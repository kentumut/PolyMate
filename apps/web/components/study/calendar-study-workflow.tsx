'use client';

import type { CalendarEvent } from '@polymate/contracts/calendar';
import { HttpCalendarClient } from '@polymate/contracts/http-client';
import { weekRange, zonedParts, zonedTimeToInstant } from '@polymate/contracts/time';
import { FakeCalendarClient } from '@polymate/core/calendar/fake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarPanel } from '@/components/calendar/calendar-panel';
import { StudyBlockDialog } from './study-block-dialog';
import type { StudyBlockOperationResult } from './study-block-form';
import { createStudyCalendarClient } from './study-calendar-client';
import { useStudyWorkspace } from './study-workspace-context';
import { StudyProgressPanel } from './study-progress-panel';

export function CalendarStudyWorkflow({ sample = false }: { sample?: boolean }) {
  const workspace = useStudyWorkspace();
  const [readClient] = useState(() => workspace?.calendarClient ?? (sample ? new FakeCalendarClient(undefined, 250) : new HttpCalendarClient()));
  const [client] = useState(() => createStudyCalendarClient(sample ? { calendarClient: readClient } : {}));
  const [range, setRange] = useState(() => weekRange());
  const [reloadKey, setReloadKey] = useState(0);
  const [open, setOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [initialStartAt, setInitialStartAt] = useState<string>();
  const [result, setResult] = useState<StudyBlockOperationResult>();
  const [ready, setReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progressBusy, setProgressBusy] = useState(false);
  const [progressNotice, setProgressNotice] = useState('');
  const [assignmentSelection, setAssignmentSelection] = useState<{ id: string; version: number } | null>(null);
  const focusStart = useRef<(() => void) | null>(null);
  const receiveFocusStart = useCallback((focus: () => void) => { focusStart.current = focus; }, []);
  const running = useRef(false);
  const blocking = client.getBlockingOperation();
  const pendingReport = workspace?.progressClient.getPendingReport();
  const disabled = !ready || busy || progressBusy || checking || Boolean(blocking) || Boolean(pendingReport);

  useEffect(() => {
    let current = true;
    client.loadUnresolved().then(() => { if (current) setReady(true); })
      .catch(() => { if (current) setRecoveryError('Pending calendar changes could not be checked. Retry before changing your calendar.'); });
    return () => { current = false; };
  }, [client]);

  useEffect(() => {
    const refresh = () => setReloadKey(key => key + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  async function retryRecovery() {
    if (checking) return;
    setChecking(true);
    try {
      await client.loadUnresolved();
      setRecoveryError('');
      setReady(true);
    } catch {
      setRecoveryError('Pending calendar changes could not be checked. Retry before changing your calendar.');
    } finally { setChecking(false); }
  }

  function show(event: CalendarEvent | null) {
    if (disabled) return;
    setSelectedEvent(event);
    setResult(undefined);
    if (!event) {
      setAssignmentSelection(null);
      const now = Date.now();
      const start = now >= Date.parse(range.from) && now < Date.parse(range.to)
        ? new Date(Math.ceil(now / 900000) * 900000).toISOString()
        : zonedTimeToInstant({ ...zonedParts(range.from), hour: 9, minute: 0 }).toISOString();
      setInitialStartAt(start);
    }
    setOpen(true);
  }

  async function perform(execute: () => Promise<StudyBlockOperationResult>, kind: 'create' | 'update' | 'complete' | 'delete', targetId: string | null = null) {
    if (workspace?.progressClient.getPendingReport()) return { operationId: crypto.randomUUID(), status: 'failed' as const, error: { message: 'Confirm the outstanding progress report before changing the calendar.' } };
    const outstanding = client.getBlockingOperation();
    if (outstanding) return outstanding;
    if (running.current) throw new Error('A calendar change is already running.');
    running.current = true;
    setBusy(true);
    try {
      const next = await execute();
      workspace?.observe(kind, targetId, next as import('@polymate/contracts/calendar').OperationResult);
      setResult(next);
      if (next.status === 'synced') { setReloadKey(key => key + 1); void workspace?.refresh(); }
      return next;
    } finally { running.current = false; setBusy(false); }
  }

  async function reconcile() {
    const outstanding = client.getBlockingOperation();
    if (!outstanding) throw new Error('No pending calendar change.');
    setChecking(true);
    try {
      const next = await client.reconcile(outstanding.operationId);
      setResult(next);
      if (next.status === 'synced') setReloadKey(key => key + 1);
      void workspace?.refresh();
      return next;
    } finally { setChecking(false); }
  }

  async function retryReport() {
    if (!workspace || progressBusy) return;
    setProgressBusy(true);
    try {
      const receipt = await workspace.progressClient.retry();
      if (receipt.calendarOperation) client.trackOperation(receipt.calendarOperation);
      setProgressNotice('Progress report confirmed.'); setReloadKey(key => key + 1); await workspace.refresh();
    } catch (error) { setProgressNotice(error instanceof Error ? error.message : 'Report could not be confirmed.'); }
    finally { setProgressBusy(false); }
  }

  return <div className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-[#617269]">{sample ? 'Sample workflow — changes stay in memory.' : 'Manage your PolyMate study blocks. Personal events stay read-only.'}</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => setReloadKey(key => key + 1)} className="rounded-lg border border-[#c8d3c8] bg-white px-3 py-2 text-sm">Refresh calendar</button>
        <button type="button" disabled={disabled} onClick={() => show(null)} className="rounded-lg bg-[#173b32] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Add study block</button>
      </div>
    </div>
    {!ready && !recoveryError && <p role="status" className="text-sm text-[#617269]">Checking pending calendar changes…</p>}
    {recoveryError && <div role="alert" className="rounded-lg border border-[#d9aaa5] bg-white p-3 text-sm text-[#9b302b]">
      {recoveryError} <button type="button" disabled={checking} onClick={retryRecovery} className="ml-2 underline">Retry check</button>
    </div>}
    {blocking && <div role="status" className="rounded-lg border border-[#c8d3c8] bg-white p-3 text-sm">
      {blocking.status === 'unknown' ? 'A calendar change is uncertain.' : 'A calendar change is pending.'} Check its outcome before making another change.
      <button type="button" onClick={reconcile} disabled={busy || checking} className="ml-2 underline disabled:opacity-50">{checking ? 'Checking…' : 'Check change'}</button>
    </div>}
    {pendingReport && !open && <p role="status" className="rounded-lg border border-[#c8d3c8] bg-white p-3 text-sm">A progress report is unconfirmed. <button type="button" disabled={progressBusy} onClick={retryReport} className="underline">Retry the original report</button></p>}
    {progressNotice && !open && <p role="status" className="text-sm">{progressNotice}</p>}
    {!open && result && !blocking && <p role="status" className="text-sm text-[#617269]">{result.status === 'synced' ? sample ? 'Sample calendar change confirmed.' : 'Google Calendar change confirmed.' : result.error?.message}</p>}
    <CalendarPanel client={readClient} sample={sample} onSelect={event => show(event)} onRangeChange={setRange} reloadKey={reloadKey} />
    <StudyBlockDialog open={open} selectedEvent={selectedEvent} initialStartAt={initialStartAt}
      onClose={() => setOpen(false)} onCreate={input => perform(async () => {
        if (assignmentSelection && workspace) {
          const assignment = workspace.data?.assignments.find(item => item.id === assignmentSelection.id);
          if (!assignment || assignment.version !== assignmentSelection.version) return { operationId: crypto.randomUUID(), status: 'failed' as const, error: { message: 'Assignment changed. Review it again.' } };
        }
        const next = await client.onCreate({ ...input, ...(assignmentSelection ? { assignmentId: assignmentSelection.id, expectedAssignmentVersion: assignmentSelection.version } : {}) });
        if (sample && next.status === 'synced' && next.event && assignmentSelection && workspace) {
          await workspace.progressClient.link({ eventId: next.event.id, assignmentId: assignmentSelection.id,
            expectedAssignmentVersion: assignmentSelection.version, expectedEtag: next.event.etag });
        }
        return next;
      }, 'create')}
      onUpdate={(id, input, etag) => perform(() => client.onUpdate(id, input, etag), 'update', id)}
      onComplete={(id, etag) => perform(() => client.onComplete(id, etag), 'complete', id)}
      onDelete={(id, etag) => perform(() => client.onDelete(id, etag), 'delete', id)}
      onReconcile={reconcile} operationResult={result} fixtureMode={sample} writeBlocked={Boolean(blocking) || progressBusy || Boolean(pendingReport)} externalSubmitting={progressBusy}
      onRequestReschedule={receiveFocusStart}
      reportedCompletion={workspace?.data?.links.find(link => link.eventId === selectedEvent?.id)?.completion === 'done'}
      creationFields={workspace && <label className="block text-sm">Link to assignment (optional)
        <select value={assignmentSelection?.id ?? ''} disabled={busy || Boolean(blocking)}
          onChange={event => { const assignment = workspace.data?.assignments.find(item => item.id === event.target.value); setAssignmentSelection(assignment ? { id: assignment.id, version: assignment.version } : null); }}
          className="mt-2 w-full rounded-lg border border-[#c8d3c8] bg-white p-2">
          <option value="">No assignment</option>{workspace.data?.assignments.filter(item => !['completed','cancelled'].includes(item.status)).map(item => <option key={item.id} value={item.id}>{item.title} · {item.remainingMinutes} min remaining</option>)}
        </select>
        {workspace.error && <span className="mt-2 block text-xs text-[#9b302b]">{workspace.error}</span>}
      </label>}
      extraContent={selectedEvent && workspace && <StudyProgressPanel key={selectedEvent.id} event={selectedEvent}
        disabled={busy || Boolean(blocking) || result?.status === 'synced'} onBusy={setProgressBusy} onMoveSession={() => focusStart.current?.()}
        onCalendarResult={next => { client.trackOperation(next); setReloadKey(key => key + 1); }} onCheckCalendar={reconcile as () => Promise<import('@polymate/contracts/calendar').OperationResult>} />} />
  </div>;
}
