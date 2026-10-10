'use client';

import { useId, useRef, useState } from 'react';
import type { CalendarEvent, OperationResult } from '@polymate/contracts/calendar';
import type { ProgressAction, ProgressReceipt, ProgressRequest } from '@polymate/contracts/study-progress';
import { useStudyWorkspace } from './study-workspace-context';
import { ProgressSaveError } from './progress-client';
import { validateProgressFields, type ProgressFieldErrors } from './progress-form';
import { progressDraftIsStale, type ProgressDraftContext } from './progress-draft';

const labels: Record<ProgressAction, string> = { done: 'Done', partly_done: 'Partly done', missed: 'Missed it', stuck: 'Stuck' };

export function StudyProgressPanel({ event, disabled, onBusy, onCalendarResult, onMoveSession, onCheckCalendar }: {
  event: CalendarEvent; disabled: boolean; onCalendarResult: (result: OperationResult) => void;
  onBusy: (busy: boolean) => void;
  onMoveSession: () => void; onCheckCalendar: () => Promise<OperationResult>;
}) {
  const workspace = useStudyWorkspace();
  const [assignmentId, setAssignmentId] = useState('');
  const [action, setAction] = useState<ProgressAction | null>(null);
  const [expected, setExpected] = useState<ProgressDraftContext>();
  const [minutes, setMinutes] = useState('');
  const [finished, setFinished] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [receipt, setReceipt] = useState<ProgressReceipt>();
  const [errors, setErrors] = useState<ProgressFieldErrors>({});
  const id = useId();
  const minutesInput = useRef<HTMLInputElement>(null);
  const noteInput = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  if (!workspace || event.source !== 'polymate' || !event.editable) return null;
  const linked = workspace.data?.links.find(link => link.eventId === event.id && !link.deleted);
  const assignment = workspace.data?.assignments.find(item => item.id === linked?.assignmentId);
  const currentReport = workspace.data?.reports.filter(report => report.eventId === event.id && report.sessionRevision === linked?.sessionRevision).at(-1);
  const history = workspace.data?.reports.filter(report => report.eventId === event.id) ?? [];

  async function linkAssignment() {
    if (inFlight.current || disabled) return;
    const selected = workspace!.data?.assignments.find(item => item.id === assignmentId);
    if (!selected) { setMessage('Choose an assignment.'); return; }
    inFlight.current = true; setBusy(true); onBusy(true);
    try {
      await workspace!.progressClient.link({ eventId: event.id, assignmentId, expectedAssignmentVersion: selected.version, expectedEtag: event.etag });
      setMessage('Assignment linked.'); await workspace!.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The link could not be confirmed. Refresh and retry.'); }
    finally { inFlight.current = false; setBusy(false); onBusy(false); }
  }
  function choose(next: ProgressAction) {
    if (!linked || !assignment || unknown || disabled || busy || action === next) return;
    setAction(next); setExpected({ assignment: assignment.version, session: linked.sessionRevision, etag: event.etag });
    setMinutes(''); setFinished(false); setNote(''); setMessage(''); setReceipt(undefined);
    setErrors({});
  }
  async function record() {
    if (!linked || !assignment || !action || !expected || busy || inFlight.current || (disabled && !unknown)) return;
    if (!unknown) {
      const validation = validateProgressFields({ action, minutes, finished, note });
      setErrors(validation);
      if (validation.minutes || validation.note) { setMessage('Check the highlighted report details.'); (validation.minutes ? minutesInput.current : noteInput.current)?.focus(); return; }
      if (progressDraftIsStale(expected, { assignment: assignment.version, session: linked.sessionRevision, etag: event.etag })) {
        setMessage('The assignment or session changed while you were editing. Your notes are preserved. Review the current values and explicitly refresh this draft before saving.'); return;
      }
    }
    inFlight.current = true; setBusy(true); onBusy(true);
    try {
      const value: Omit<ProgressRequest, 'clientRequestId'> = {
        eventId: event.id, assignmentId: assignment.id, action, expectedAssignmentVersion: expected.assignment,
        expectedSessionRevision: expected.session, expectedEtag: expected.etag,
        ...(action !== 'missed' && !finished && minutes.trim() ? { remainingMinutes: Number(minutes) } : {}), ...(action === 'done' ? { assignmentFinished: finished } : {}), ...(note.trim() ? { note } : {}),
      };
      const saved = unknown ? await workspace!.progressClient.retry() : await workspace!.progressClient.record(value);
      setReceipt(saved); setUnknown(false); setAction(null); setMessage('Progress saved.');
      if (saved.calendarOperation) onCalendarResult(saved.calendarOperation);
      workspace!.assignmentSaved(saved.assignment); await workspace!.refresh();
    } catch (error) {
      setUnknown(error instanceof ProgressSaveError && error.kind === 'unknown');
      setMessage(error instanceof Error ? error.message : 'Progress could not be confirmed.');
    } finally { inFlight.current = false; setBusy(false); onBusy(false); }
  }
  async function checkCalendar() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); onBusy(true);
    try { const result = await onCheckCalendar(); setReceipt(previous => previous ? { ...previous, calendarOperation: result } : previous); await workspace!.refresh(); }
    catch { setMessage('Calendar completion could not be checked. Retry without repeating the report.'); }
    finally { inFlight.current = false; setBusy(false); onBusy(false); }
  }

  return <section className="space-y-3" aria-label="Study progress" aria-busy={busy}>
    <h3 className="text-lg font-semibold">How did this session go?</h3>
    {workspace.error && <p className="text-sm text-[#9b302b]">{workspace.error} <button type="button" onClick={workspace.refresh} className="underline">Reload progress</button></p>}
    {!linked ? <div className="space-y-3">
      <p className="text-sm text-[#617269]">Link this block to an assignment to keep track of remaining work.</p>
      <label className="block text-sm">Assignment<select value={assignmentId} onChange={e => setAssignmentId(e.target.value)} disabled={busy || disabled} className="mt-2 w-full rounded-lg border border-[#c8d3c8] bg-white p-2">
        <option value="">Choose an assignment</option>{workspace.data?.assignments.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
      <button type="button" onClick={linkAssignment} disabled={busy || disabled || !assignmentId} className="min-h-11 rounded-lg border border-[#173b32] px-3 py-2 text-sm disabled:opacity-50">Link assignment</button>
    </div> : assignment ? <>
      <p className="text-sm"><strong>{assignment.title}</strong> · {assignment.remainingMinutes} minutes remaining</p>
      <p className="text-xs text-[#617269]">This session: {currentReport ? labels[currentReport.action] : linked.completion === 'done' ? 'Done in Google' : 'Not reported yet'}. Session Done does not finish the whole assignment. Moodle submission remains separate.</p>
      <div className="flex flex-wrap gap-2">{(Object.keys(labels) as ProgressAction[]).map(kind => <button key={kind} type="button" onClick={() => choose(kind)} disabled={busy || disabled || unknown || ((linked.completion === 'done' || event.completion === 'done' || currentReport?.action === 'done') && kind !== 'done')}
        aria-pressed={action === kind} className="min-h-11 rounded-lg border border-[#c8d3c8] px-3 py-2 text-sm disabled:opacity-50">{labels[kind]}</button>)}</div>
      {action && <div className="space-y-3 rounded-xl bg-[#edf0e7] p-3">
        {action === 'done' && <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" checked={finished} disabled={busy || unknown} onChange={e => { setFinished(e.target.checked); if (e.target.checked) setMinutes(''); setErrors({}); }} />I confirm the entire assignment is finished, not just this session (0 minutes remaining).</label>}
        {action !== 'missed' && !finished && <label className="block text-sm">{action === 'partly_done' ? 'How many minutes remain for the assignment?' : 'Remaining effort — minutes (optional)'}
          <input ref={minutesInput} type="number" min="1" step="1" value={minutes} disabled={busy || unknown} aria-invalid={Boolean(errors.minutes)} aria-describedby={errors.minutes ? `${id}-minutes-error` : undefined} onChange={e => { setMinutes(e.target.value); setErrors(previous => ({ ...previous, minutes: undefined })); }} className="mt-2 min-h-11 w-full rounded-lg border border-[#c8d3c8] p-2" /></label>}
        {errors.minutes && <p id={`${id}-minutes-error`} role="alert" className="text-sm text-[#9b302b]">{errors.minutes}</p>}
        <label className="block text-sm">{action === 'stuck' ? 'Which question or topic was difficult?' : 'What would you like to remember? (optional)'}
          <textarea ref={noteInput} value={note} maxLength={2000} disabled={busy || unknown} aria-invalid={Boolean(errors.note)} aria-describedby={errors.note ? `${id}-note-error` : undefined} onChange={e => { setNote(e.target.value); setErrors(previous => ({ ...previous, note: undefined })); }} className="mt-2 min-h-11 w-full rounded-lg border border-[#c8d3c8] p-2" /></label>
        {errors.note && <p id={`${id}-note-error`} role="alert" className="text-sm text-[#9b302b]">{errors.note}</p>}
        {action === 'done' && !finished && <p className="text-xs">Save completes this session only; the whole assignment stays open.</p>}
        {action === 'missed' && <p className="text-xs">Remaining work is preserved. You can choose a new time after saving this report.</p>}
        {!unknown && expected && progressDraftIsStale(expected, { assignment: assignment.version, session: linked.sessionRevision, etag: event.etag }) && <div className="text-sm"><p>This draft is stale. Check the current session and assignment before refreshing its references.</p><button type="button" disabled={busy || disabled} onClick={() => { setExpected({ assignment: assignment.version, session: linked.sessionRevision, etag: event.etag }); setMessage('Draft refreshed with current references. Review your preserved answers before saving.'); }} className="min-h-11 underline">I reviewed the changes — refresh this draft</button></div>}
        <button type="button" onClick={record} disabled={busy || (disabled && !unknown)} className="min-h-11 rounded-lg bg-[#173b32] px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : unknown ? 'Retry same report' : 'Save progress'}</button>
        {!unknown && <button type="button" disabled={busy} onClick={() => setAction(null)} className="ml-2 min-h-11 text-sm underline">Cancel report</button>}
      </div>}
      {(receipt?.report.action === 'missed' || currentReport?.action === 'missed') && <button type="button" onClick={onMoveSession} disabled={busy || disabled} className="min-h-11 rounded-lg border border-[#173b32] px-3 py-2 text-sm disabled:opacity-50">Move this session — choose a new time above, then Save</button>}
      {history.length > 0 && <details className="text-sm"><summary className="cursor-pointer">Session progress history</summary><ol className="mt-2 space-y-2">
        {history.map(report => <li key={report.id} className="rounded-lg bg-[#e8ede5] p-2">{labels[report.action]} · session {report.sessionRevision}
          <p className="text-xs text-[#617269]">{new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(report.reportedAt))}</p>
          {report.reportedRemainingMinutes !== null && <p>{report.reportedRemainingMinutes} minutes remaining (reported)</p>}
          {report.note && <p className="whitespace-pre-wrap break-words">{report.note}</p>}
        </li>)}
      </ol></details>}
    </> : null}
    {message && <p role="status" className="text-sm">{unknown ? 'Unconfirmed: ' : ''}{message}</p>}
    {receipt?.calendarOperation && receipt.calendarOperation.status !== 'synced' && <p role="status" className="text-sm">
      Progress is saved. Google completion is {receipt.calendarOperation.status === 'failed' ? 'not applied' : 'unconfirmed'}.
      {receipt.calendarOperation.error?.message}
      {['pending','unknown'].includes(receipt.calendarOperation.status) && <button type="button" onClick={checkCalendar} disabled={busy} className="ml-2 min-h-11 underline">Check calendar completion</button>}
    </p>}
  </section>;
}
