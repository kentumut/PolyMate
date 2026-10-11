'use client';

import type { MouseEvent } from 'react';
import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { WorkspaceView } from './workspace-sidebar';

type Step = { id: 'moodle' | 'google' | 'courses'; view: WorkspaceView; title: string; body: string };

const steps: Step[] = [
  { id: 'moodle', view: 'settings', title: 'Connect your Moodle calendar', body: 'So PolyMate can see your deadlines.' },
  { id: 'google', view: 'settings', title: 'Connect Google Calendar', body: 'So plans avoid your existing commitments.' },
  { id: 'courses', view: 'courses', title: 'Add a course', body: 'So advice reflects your workload and exam priorities.' },
];

async function done(url: string, read: (body: Record<string, unknown>) => boolean | null): Promise<boolean | null> {
  try {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    return response.ok ? read(await response.json() as Record<string, unknown>) : null;
  } catch { return null; }
}

/**
 * Setup steps a new student has not finished, shown on the empty chat. A step whose status
 * cannot be read is left out rather than guessed, and the list disappears once nothing is open.
 */
export function SetupChecklist({ active, hrefFor, onNavigate }: {
  /** Re-reads the statuses each time the student returns to Chat. */
  active: boolean;
  hrefFor: (view: WorkspaceView) => string;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, view: WorkspaceView) => void;
}) {
  const [open, setOpen] = useState<Step['id'][]>([]);

  useEffect(() => {
    if (!active) return;
    let current = true;
    void Promise.all([
      done('/api/integrations/moodle/connection', body => body.connected === true),
      // An unconfigured Google integration is not something the student can finish.
      done('/api/integrations/google/status', body => body.enabled === true ? body.connected === true : null),
      done('/api/courses', body => Array.isArray(body.courses) ? body.courses.length > 0 : null),
    ]).then(results => { if (current) setOpen(steps.filter((_, index) => results[index] === false).map(step => step.id)); });
    return () => { current = false; };
  }, [active]);

  const remaining = steps.filter(step => open.includes(step.id));
  if (!remaining.length) return null;
  return <section className="mt-6 w-full rounded-xl border bg-card p-2 text-left shadow-sm" aria-labelledby="setup-checklist-title">
    <h2 id="setup-checklist-title" className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">Finish setting up · {remaining.length} left</h2>
    <ul>
      {remaining.map(step => <li key={step.id}>
        <a href={hrefFor(step.view)} onClick={event => onNavigate(event, step.view)} className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-accent">
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{step.title}</span><span className="block text-xs text-muted-foreground">{step.body}</span></span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </a>
      </li>)}
    </ul>
  </section>;
}
