'use client';

import { useEffect, useState } from 'react';
import type { Assignment, AssignmentStatus } from '@polymate/contracts/assignments';
import { createAssignmentClient, createSampleAssignmentClient } from './assignment-client';
import { useStudyWorkspace } from './study-workspace-context';
import { PlanningPanel } from './planning-panel';
import { CalendarImportPanel } from './calendar-import-panel';
import { Button } from '@/components/ui/button';

const deadlineFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' });
const statusLabels: Record<AssignmentStatus, string> = { open: 'Open', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };

export function AssignmentsPanel({ sample = false, onCalendarChange = () => {} }: { sample?: boolean; onCalendarChange?: () => void }) {
  const workspace = useStudyWorkspace();
  const [client] = useState(() => workspace?.assignmentSource.client ?? (sample ? createSampleAssignmentClient() : createAssignmentClient()));
  const [importOpen, setImportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState<{ key: number; assignments: Assignment[]; error: string }>();
  const loading = loaded?.key !== reloadKey;

  useEffect(() => {
    let current = true;
    client.listAssignments().then(assignments => {
      if (current) setLoaded({ key: reloadKey, assignments, error: '' });
    }).catch(() => {
      if (current) setLoaded(previous => ({ key: reloadKey, assignments: previous?.assignments ?? [], error: 'Assignments could not be loaded. Please retry.' }));
    });
    return () => { current = false; };
  }, [client, reloadKey, workspace?.revision]);

  return <section className="space-y-4 rounded-xl border bg-card p-6 text-card-foreground" aria-label="Assignments">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Assignments</h2><p className="mt-1 text-sm text-muted-foreground">Track course deadlines and total study effort. Calendar blocks are scheduled separately.</p></div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" aria-expanded={importOpen} onClick={() => setImportOpen(value => !value)}>{importOpen ? 'Hide import' : 'Import deadlines'}</Button>
      </div>
    </div>
    <div hidden={!importOpen}><CalendarImportPanel fixture={sample} onSaved={() => { setReloadKey(key => key + 1); void workspace?.refresh(); }} /></div>
    {sample && <p className="text-xs text-muted-foreground">Demo assignments stay in this browser and reset on reload.</p>}
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading assignments…</p>}
    {loaded?.error && <div role="alert" className="text-sm text-destructive">{loaded.error} <button type="button" onClick={() => setReloadKey(key => key + 1)} className="underline">Reload assignments</button></div>}
    {!loading && !loaded?.error && !loaded?.assignments.length && <p className="text-sm text-muted-foreground">No assignments yet. Describe one to PolyMate above; Chat will ask for any missing details.</p>}
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
  </section>;
}
