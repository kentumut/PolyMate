'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { HttpCalendarClient } from '@polymate/contracts/http-client';
import { FakeCalendarClient } from '@polymate/core/calendar/fake';
import { StudyProgressService } from '@polymate/core/progress';
import { MemoryStudyProgressStore } from '@polymate/core/progress/memory';
import type { StudyProgressState } from '@polymate/contracts/study-progress';
import type { Assignment } from '@polymate/contracts/assignments';
import type { CalendarClient, OperationResult } from '@polymate/contracts/calendar';
import type { PlanningState } from '@polymate/contracts/planning';
import { createAssignmentClient, createSampleAssignmentClient, type AssignmentClient, type AssignmentFixtureOutcome } from './assignment-client';
import { createProgressClient } from './progress-client';

type Workspace = {
  assignmentSource: { client: AssignmentClient; setOutcome?: (outcome: AssignmentFixtureOutcome) => void };
  calendarClient: CalendarClient;
  progressClient: ReturnType<typeof createProgressClient>;
  observe: (kind: 'create' | 'update' | 'complete' | 'delete', eventId: string | null, result: OperationResult) => void;
  data: StudyProgressState | null; error: string; revision: number;
  refresh: () => Promise<void>; assignmentSaved: (assignment: Assignment) => void;
  /** Latest planner preview and apply outcomes, shared so the calendar can overlay them. */
  planning: PlanningState | null; planningChanged: (state: PlanningState) => void;
};
const Context = createContext<Workspace | null>(null);
export const useStudyWorkspace = () => useContext(Context);

export function StudyWorkspaceProvider({ sample, children }: { sample: boolean; children: ReactNode }) {
  const [services] = useState(() => {
    if (sample) {
      const assignments = createSampleAssignmentClient();
      const calendar = new FakeCalendarClient(undefined, 250);
      const store = new MemoryStudyProgressStore('sample-owner', () => assignments.listAssignments(), assignments.applySampleProgress);
      const progress = new StudyProgressService('sample-owner', calendar, store);
      return { assignmentSource: { client: assignments, setOutcome: assignments.setOutcome }, calendarClient: calendar,
        progressClient: createProgressClient({ service: progress }), observe: store.observe.bind(store) };
    }
    return { assignmentSource: { client: createAssignmentClient(), setOutcome: undefined }, calendarClient: new HttpCalendarClient(),
      progressClient: createProgressClient(), observe: () => {} };
  });
  const [data, setData] = useState<StudyProgressState | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [planning, planningChanged] = useState<PlanningState | null>(null);
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++epoch.current;
    try { const next = await services.progressClient.state(); if (request === epoch.current) { setData(next); setError(''); setRevision(value => value + 1); } }
    catch { if (request === epoch.current) setError('Assignment links and progress are unavailable. Check the database migration and retry.'); }
  }, [services]);
  useEffect(() => {
    let current = true;
    const request = ++epoch.current;
    services.progressClient.state().then(next => {
      if (current && request === epoch.current) { setData(next); setError(''); setRevision(value => value + 1); }
    }).catch(() => { if (current) setError('Assignment links and progress are unavailable. Check the database migration and retry.'); });
    return () => { current = false; };
  }, [services]);
  const assignmentSaved = (assignment: Assignment) => {
    setData(previous => previous ? { ...previous, assignments: [...previous.assignments.filter(item => item.id !== assignment.id), assignment] } : previous);
    void refresh();
  };
  return <Context.Provider value={{ ...services, data, error, revision, refresh, assignmentSaved, planning, planningChanged }}>{children}</Context.Provider>;
}
