'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEFAULT_STUDY_PREFERENCES, parseStudyPreferences, type PlanningState, type StudyPreferences } from '@polymate/contracts/planning';
import { useStudyWorkspace } from './study-workspace-context';

const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const inputClass = 'w-full rounded-lg border border-[#c8d3c8] bg-white px-3 py-2 text-sm';

export function PlanningPanel({ onCalendarChange }: { onCalendarChange: () => void }) {
  const workspace = useStudyWorkspace();
  const [preferences, setPreferences] = useState<StudyPreferences>(DEFAULT_STUDY_PREFERENCES);
  const [state, setState] = useState<PlanningState>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const plan = state?.plan;
  const confirmed = state?.results.filter(result => result.status === 'synced').length ?? 0;
  const applied = Boolean(plan?.blocks.length && confirmed === plan.blocks.length);
  const planningChanged = workspace?.planningChanged;
  // Share the preview with the calendar overlay; the server state stays authoritative.
  useEffect(() => { if (state) planningChanged?.(state); }, [state, planningChanged]);

  async function load() {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/assignments/plan', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Study planning could not be loaded.');
      const next = body as PlanningState;
      setState(next); setUncertain(false);
      if (next.preferences) setPreferences(next.preferences);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Study planning could not be loaded.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let current = true;
    fetch('/api/assignments/plan', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? 'Study planning could not be loaded.');
        if (current) { setState(body); if (body.preferences) setPreferences(body.preferences); }
      }).catch(reason => { if (current) setError(reason instanceof Error ? reason.message : 'Study planning could not be loaded.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);

  async function submit(action: 'generate' | 'apply', allowPartial = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    let sent = false;
    try {
      const input = action === 'generate' ? { action, preferences: parseStudyPreferences(preferences) } : { action, planId: plan?.id, allowPartial };
      const csrfResponse = await fetch('/api/assignments/csrf', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
      const csrf = await csrfResponse.json();
      if (!csrfResponse.ok || typeof csrf.csrfToken !== 'string') throw new Error('Session unavailable. Retry to refresh it.');
      sent = true;
      const response = await fetch('/api/assignments/plan', {
        method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(120000),
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf.csrfToken }, body: JSON.stringify(input),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Planning could not be completed.');
      const next = body as PlanningState;
      setState(next); setUncertain(false);
      const synced = next.results.filter(result => result.status === 'synced').length;
      setNotice(action === 'generate' ? 'Preview ready. Review the times before adding them.'
        : `${synced} of ${next.plan?.blocks.length ?? 0} proposed blocks confirmed by Google Calendar.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Planning could not be completed.');
      if (sent && action === 'apply') setUncertain(true);
    } finally {
      // Refresh even if the response was lost: Google may have accepted some blocks.
      if (sent && action === 'apply') { onCalendarChange(); void workspace?.refresh(); }
      inFlight.current = false; setBusy(false);
    }
  }

  function generate(event: FormEvent) { event.preventDefault(); void submit('generate'); }

  return <section aria-label="Study planning" className="space-y-4 border-t border-[#dce3db] pt-5">
    <div><h3 className="font-semibold">Plan the next seven days</h3>
      <p className="mt-1 text-xs leading-5 text-[#617269]">Plan saved assignments around your Google commitments. Existing study blocks stay in place. Review and approve every new plan.</p></div>
    {loading ? <p role="status" className="text-sm">Loading saved preferences and preview…</p> : <form onSubmit={generate} className="space-y-4">
      <fieldset disabled={busy} className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Study availability · Europe/Zurich</legend>
        <div className="flex flex-wrap gap-3">{days.map((day, index) => <label key={day} className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={preferences.weekdays.includes(index + 1)} onChange={event => setPreferences(previous => ({ ...previous,
            weekdays: event.target.checked ? [...previous.weekdays, index + 1].sort() : previous.weekdays.filter(value => value !== index + 1),
          }))} />{day}</label>)}</div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs">From<input type="time" required className={inputClass} value={preferences.startTime} onChange={event => setPreferences(previous => ({ ...previous, startTime: event.target.value }))} /></label>
          <label className="text-xs">Until<input type="time" required className={inputClass} value={preferences.endTime} onChange={event => setPreferences(previous => ({ ...previous, endTime: event.target.value }))} /></label>
          <label className="text-xs">Minutes per day<input type="number" min={10} max={1440} required className={inputClass} value={preferences.dailyMinutes} onChange={event => setPreferences(previous => ({ ...previous, dailyMinutes: Number(event.target.value) }))} /></label>
          <label className="text-xs">Minutes over seven days<input type="number" min={10} max={10080} required className={inputClass} value={preferences.weeklyMinutes} onChange={event => setPreferences(previous => ({ ...previous, weeklyMinutes: Number(event.target.value) }))} /></label>
        </div>
      </fieldset>
      <p className="text-xs text-[#617269]">{state?.preferences ? 'Preferences are saved when you generate a plan.' : 'These are proposed defaults. Adjust them and generate a plan to confirm.'} Blocks last up to 50 minutes with 10-minute breaks. A new preview uses the preferences above.</p>
      <button disabled={busy || uncertain} className="rounded-lg bg-[#173b32] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Working…' : 'Generate Plan'}</button>
    </form>}
    {error && <div role="alert" className="text-sm text-[#9b302b]">{error} <button type="button" disabled={busy} className="underline" onClick={() => void load()}>Reload saved preview</button></div>}
    {notice && <p role="status" className="text-sm text-[#617269]">{notice}</p>}
    {state?.warning && <p role="alert" className="text-sm text-[#8a5a26]">{state.warning}</p>}
    {plan && <div className="space-y-3 rounded-xl border border-[#dce3db] bg-[#f6f7f3] p-4">
      <h4 className="text-sm font-semibold">{applied ? 'Applied plan' : 'Proposed plan'}</h4>
      <p className="text-xs text-[#617269]">Apply by {formatter.format(new Date(plan.expiresAt))}. Existing linked work: {plan.preservedMinutes} min. Missed sessions need a progress update before replanning.</p>
      {!plan.blocks.length && <p className="text-sm">No new blocks proposed. Add assignments or review availability and remaining work.</p>}
      <ul className="space-y-2">{plan.blocks.map(block => {
        const result = state?.results.find(item => item.operationId === block.operationId);
        return <li key={block.operationId} className="rounded-lg border border-[#dce3db] bg-white p-3 text-sm">
          <p className="font-medium">{block.title}</p><p className="mt-1 text-xs">{formatter.format(new Date(block.startAt))} · {(Date.parse(block.endAt) - Date.parse(block.startAt)) / 60000} min</p>
          <p className="mt-1 text-xs text-[#617269]">{result?.status === 'synced' ? 'Google confirmed' : result?.status === 'unknown' ? 'Uncertain — retry to check' : result?.status === 'failed' ? `Failed: ${result.error?.message ?? 'Review and generate a new plan.'}` : 'Proposed — not confirmed in Google'}</p>
        </li>;
      })}</ul>
      {plan.unscheduled.length > 0 && <div className="rounded-lg border border-[#e7d7b9] bg-[#fffaf0] p-3 text-sm">
        <h4 className="font-medium">Work that does not fit</h4><ul className="mt-2 space-y-2">{plan.unscheduled.map(item => <li key={item.assignmentId}>{item.title}: {item.remainingMinutes} min — {item.reason}</li>)}</ul>
      </div>}
      {uncertain && <p role="status" className="text-sm">The apply request was not fully confirmed. Retry this same preview to check the existing operations before generating another plan.</p>}
      {plan.blocks.length > 0 && <button type="button" disabled={busy || applied} onClick={() => void submit('apply', plan.unscheduled.length > 0)} className="rounded-lg bg-[#173b32] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        {applied ? 'Google blocks confirmed' : uncertain || state?.results.length ? 'Retry this plan / check Google' : plan.unscheduled.length ? 'Add only the blocks that fit' : 'Apply Plan to Google Calendar'}
      </button>}
    </div>}
  </section>;
}
