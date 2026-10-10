'use client';

import { useEffect, useRef, useState } from 'react';
import type { Assignment, AssignmentInput, AssignmentStatus } from '@polymate/contracts/assignments';
import { AssignmentDialog } from './assignment-dialog';
import { AssignmentSaveError, createAssignmentClient, createSampleAssignmentClient, type AssignmentFixtureOutcome } from './assignment-client';
import { useStudyWorkspace } from './study-workspace-context';
import { PlanningPanel } from './planning-panel';

const deadlineFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' });
const statusLabels: Record<AssignmentStatus, string> = { open: 'Open', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };

function mergeAssignments(fetched: Assignment[], confirmed: Iterable<Assignment>) {
  const byId = new Map(fetched.map(item => [item.id, item]));
  for (const item of confirmed) if (!byId.has(item.id) || byId.get(item.id)!.version < item.version) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
}

export function AssignmentsPanel({ sample = false, onCalendarChange = () => {} }: { sample?: boolean; onCalendarChange?: () => void }) {
  const workspace = useStudyWorkspace();
  const [source] = useState(() => {
    if (workspace) return workspace.assignmentSource;
    if (sample) { const client = createSampleAssignmentClient(); return { client, setOutcome: client.setOutcome }; }
    return { client: createAssignmentClient(), setOutcome: undefined };
  });
  const client = source.client;
  const [open, setOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState<{ key: number; assignments: Assignment[]; error: string }>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [outcome, setOutcome] = useState<AssignmentFixtureOutcome>('success');
  const confirmed = useRef(new Map<string, Assignment>());
  const pending = client.getPendingSave();
  const loading = loaded?.key !== reloadKey;

  useEffect(() => {
    const openAssignmentDialog = () => { setNotice(''); setOpen(true); };
    window.addEventListener('polymate-add-assignment', openAssignmentDialog);
    return () => window.removeEventListener('polymate-add-assignment', openAssignmentDialog);
  }, []);

  useEffect(() => {
    let current = true;
    client.listAssignments().then(assignments => {
      if (current) setLoaded({ key: reloadKey, assignments: mergeAssignments(assignments, confirmed.current.values()), error: '' });
    }).catch(() => {
      if (current) setLoaded(previous => ({ key: reloadKey, assignments: previous?.assignments ?? [], error: 'Assignments could not be loaded. Please retry.' }));
    });
    return () => { current = false; };
  }, [client, reloadKey, workspace?.revision]);

  async function create(input: AssignmentInput) {
    setBusy(true); setNotice('');
    try {
      const assignment = await client.createAssignment(input);
      confirmed.current.set(assignment.id, assignment);
      setLoaded(previous => ({ key: reloadKey, assignments: mergeAssignments(previous?.assignments ?? [], confirmed.current.values()), error: '' }));
      setReloadKey(key => key + 1);
      setNotice(sample ? 'Sample assignment saved.' : 'Assignment saved.');
      workspace?.assignmentSaved(assignment);
      return assignment;
    } catch (error) {
      setNotice(error instanceof AssignmentSaveError ? error.message : 'The assignment save could not be confirmed.');
      throw error;
    } finally { setBusy(false); }
  }

  async function retry() {
    if (!pending || busy) return;
    try { await create(pending.input); } catch { /* The notice keeps recovery actionable. */ }
  }

  return <section className="space-y-4 rounded-xl border bg-card p-6 text-card-foreground" aria-label="Assignments">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Assignments</h2>
      <button type="button" onClick={() => { setNotice(''); setOpen(true); }} disabled={busy || Boolean(pending)} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Add assignment</button>
    </div>
    <p className="text-xs text-muted-foreground">Deadlines in Europe/Zurich. Assignments are saved independently of Google Calendar.</p>
    {sample && <div className="space-y-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
      <p>Sample assignments — in memory only; reset after reload.</p>
      <label htmlFor="assignment-fixture-outcome" className="block font-medium">Sample save outcome</label>
      <select id="assignment-fixture-outcome" value={outcome} disabled={busy || Boolean(pending)}
        onChange={event => {
          const next = event.target.value as AssignmentFixtureOutcome; setOutcome(next);
          source.setOutcome?.(next);
        }} className="w-full rounded-md border bg-background p-2 text-foreground">
        <option value="success">Success</option><option value="failure">Failed save</option><option value="unknown">Uncertain reply — retry confirms</option><option value="slow">Slow save</option>
      </select>
    </div>}
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading assignments…</p>}
    {loaded?.error && <div role="alert" className="text-sm text-destructive">{loaded.error} <button type="button" onClick={() => setReloadKey(key => key + 1)} className="underline">Reload assignments</button></div>}
    {!open && notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {pending?.status === 'unknown' && !open && <div className="rounded-lg border p-3 text-sm">
      Confirm the outstanding save before adding another assignment.
      <button type="button" onClick={retry} disabled={busy} className="ml-2 underline disabled:opacity-50">{busy ? 'Saving…' : 'Retry save'}</button>
    </div>}
    {!loading && !loaded?.error && !loaded?.assignments.length && <p className="text-sm text-muted-foreground">No assignments yet. Add a deadline and effort estimate to get started.</p>}
    <ul className="max-h-[32rem] space-y-3 overflow-y-auto" aria-label="Saved assignments">
      {(loaded?.assignments ?? []).map(assignment => {
        const reports = workspace?.data?.reports.filter(report => report.assignmentId === assignment.id) ?? [];
        const latest = reports.at(-1);
        const difficulty = reports.filter(report => report.action === 'stuck').at(-1);
        return <li key={assignment.id} className="rounded-lg border bg-muted/35 p-3">
        <h3 className="break-words text-sm font-semibold">{assignment.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">Due {deadlineFormatter.format(new Date(assignment.dueAt))}</p>
        <p className="mt-1 text-xs text-muted-foreground">{assignment.estimatedMinutes} min estimated · {assignment.remainingMinutes} min remaining</p>
        <p className="mt-1 text-xs font-medium">{statusLabels[assignment.status]}</p>
        {latest && <p className="mt-1 text-xs">Last session report: {latest.action.replace('_', ' ')}</p>}
        {difficulty && <p className="mt-1 break-words text-xs">Difficulty: {difficulty.note}</p>}
        {reports.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer">Progress history</summary><ol className="mt-2 space-y-2">
          {reports.map(report => <li key={report.id}><span>{deadlineFormatter.format(new Date(report.reportedAt))} · {report.action.replace('_', ' ')}</span>
            {report.reportedRemainingMinutes !== null && <span> · {report.reportedRemainingMinutes} min remaining</span>}
            {report.note && <p className="break-words">{report.note}</p>}</li>)}
        </ol></details>}
        {assignment.status === 'completed' && <p className="mt-1 text-xs text-muted-foreground">Studying finished; Moodle submission is separate.</p>}
      </li>;
      })}
    </ul>
    {!sample && <PlanningPanel onCalendarChange={onCalendarChange} />}
    <AssignmentDialog open={open} onClose={() => setOpen(false)} onCreateAssignment={create} fixtureMode={sample} />
  </section>;
}
