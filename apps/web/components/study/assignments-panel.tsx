'use client';

import { useEffect, useRef, useState } from 'react';
import type { Assignment, AssignmentInput, AssignmentStatus } from '@polymate/contracts/assignments';
import { AssignmentDialog } from './assignment-dialog';
import { AssignmentSaveError, createAssignmentClient, createSampleAssignmentClient, type AssignmentFixtureOutcome } from './assignment-client';

const deadlineFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' });
const statusLabels: Record<AssignmentStatus, string> = { open: 'Open', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };

function mergeAssignments(fetched: Assignment[], confirmed: Iterable<Assignment>) {
  const byId = new Map(fetched.map(item => [item.id, item]));
  for (const item of confirmed) if (!byId.has(item.id) || byId.get(item.id)!.version < item.version) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
}

export function AssignmentsPanel({ sample = false }: { sample?: boolean }) {
  const [source] = useState(() => {
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
    let current = true;
    client.listAssignments().then(assignments => {
      if (current) setLoaded({ key: reloadKey, assignments: mergeAssignments(assignments, confirmed.current.values()), error: '' });
    }).catch(() => {
      if (current) setLoaded(previous => ({ key: reloadKey, assignments: previous?.assignments ?? [], error: 'Assignments could not be loaded. Please retry.' }));
    });
    return () => { current = false; };
  }, [client, reloadKey]);

  async function create(input: AssignmentInput) {
    setBusy(true); setNotice('');
    try {
      const assignment = await client.createAssignment(input);
      confirmed.current.set(assignment.id, assignment);
      setLoaded(previous => ({ key: reloadKey, assignments: mergeAssignments(previous?.assignments ?? [], confirmed.current.values()), error: '' }));
      setReloadKey(key => key + 1);
      setNotice(sample ? 'Sample assignment saved.' : 'Assignment saved.');
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

  return <section className="space-y-4 rounded-2xl border border-[#dce3db] bg-white p-6" aria-label="Assignments">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Assignments</h2>
      <button type="button" onClick={() => { setNotice(''); setOpen(true); }} disabled={busy || Boolean(pending)} className="rounded-lg bg-[#173b32] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Add assignment</button>
    </div>
    <p className="text-xs text-[#617269]">Deadlines in Europe/Zurich. Assignments are saved independently of Google Calendar.</p>
    {sample && <div className="space-y-2 rounded-lg bg-[#e8ede5] p-3 text-xs">
      <p>Sample assignments — in memory only; reset after reload.</p>
      <label htmlFor="assignment-fixture-outcome" className="block font-medium">Sample save outcome</label>
      <select id="assignment-fixture-outcome" value={outcome} disabled={busy || Boolean(pending)}
        onChange={event => {
          const next = event.target.value as AssignmentFixtureOutcome; setOutcome(next);
          source.setOutcome?.(next);
        }} className="w-full rounded-lg border border-[#c8d3c8] bg-white p-2">
        <option value="success">Success</option><option value="failure">Failed save</option><option value="unknown">Uncertain reply — retry confirms</option><option value="slow">Slow save</option>
      </select>
    </div>}
    {loading && <p role="status" className="text-sm text-[#617269]">Loading assignments…</p>}
    {loaded?.error && <div role="alert" className="text-sm text-[#9b302b]">{loaded.error} <button type="button" onClick={() => setReloadKey(key => key + 1)} className="underline">Reload assignments</button></div>}
    {!open && notice && <p role="status" className="text-sm text-[#617269]">{notice}</p>}
    {pending?.status === 'unknown' && !open && <div className="rounded-lg border border-[#c8d3c8] p-3 text-sm">
      Confirm the outstanding save before adding another assignment.
      <button type="button" onClick={retry} disabled={busy} className="ml-2 underline disabled:opacity-50">{busy ? 'Saving…' : 'Retry save'}</button>
    </div>}
    {!loading && !loaded?.error && !loaded?.assignments.length && <p className="text-sm text-[#617269]">No assignments yet. Add a deadline and effort estimate to get started.</p>}
    <ul className="max-h-[32rem] space-y-3 overflow-y-auto" aria-label="Saved assignments">
      {(loaded?.assignments ?? []).map(assignment => <li key={assignment.id} className="rounded-xl border border-[#dce3db] bg-[#f6f7f3] p-3">
        <h3 className="break-words text-sm font-semibold">{assignment.title}</h3>
        <p className="mt-1 text-xs text-[#617269]">Due {deadlineFormatter.format(new Date(assignment.dueAt))}</p>
        <p className="mt-1 text-xs text-[#617269]">{assignment.estimatedMinutes} min estimated · {assignment.remainingMinutes} min remaining</p>
        <p className="mt-1 text-xs font-medium">{statusLabels[assignment.status]}</p>
      </li>)}
    </ul>
    <AssignmentDialog open={open} onClose={() => setOpen(false)} onCreateAssignment={create} fixtureMode={sample} />
  </section>;
}
