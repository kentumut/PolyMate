'use client';

import type { OnboardingProfile, OnboardingState } from '@polymate/contracts/onboarding';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DEMO_ONBOARDING_OPTIONS } from '@/lib/demo-fixtures';

const groups = [
  { key: 'goal', legend: 'Optimize for' },
  { key: 'sessionMinutes', legend: 'Focus rhythm' },
  { key: 'coachCadence', legend: 'Coaching' },
] as const;

/** Lets a student change the choices made during setup. Saving uses the same request as setup. */
export function CoachPreferences({ development, onSaved }: { development: boolean; onSaved: () => void }) {
  const [saved, setSaved] = useState<OnboardingProfile | null>(null);
  const [draft, setDraft] = useState<OnboardingProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let current = true;
    const load = async (): Promise<OnboardingProfile | null> => {
      // Local development keeps setup in the browser, as the setup screen does.
      if (development) { try { return JSON.parse(window.localStorage.getItem('polymate-onboarding') ?? 'null') as OnboardingProfile | null; } catch { return null; } }
      const response = await fetch('/api/onboarding', { credentials: 'same-origin', cache: 'no-store' });
      const body = await response.json() as OnboardingState & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'Your preferences could not be loaded.');
      return body.profile;
    };
    load().then(profile => { if (current) { setSaved(profile); setDraft(profile); setLoaded(true); } })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : 'Your preferences could not be loaded.'); });
    return () => { current = false; };
  }, [development]);

  async function save() {
    if (!draft || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (development) { try { window.localStorage.setItem('polymate-onboarding', JSON.stringify(draft)); } catch { /* The local preview may use ephemeral storage. */ } }
      else {
        const response = await fetch('/api/onboarding', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
        const body = await response.json() as OnboardingState & { error?: { message?: string } };
        if (!response.ok || !body.completed) throw new Error(body.error?.message ?? 'Your preferences could not be saved.');
      }
      setSaved(draft); setNotice('Preferences saved. PolyMate will use them from the next plan.');
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Your preferences could not be saved.'); }
    finally { setBusy(false); }
  }

  // Nothing to edit until setup has been completed.
  if (loaded && !draft) return null;
  const changed = Boolean(draft && saved && groups.some(group => draft[group.key] !== saved[group.key]));
  return <section className="rounded-xl border bg-card p-6 shadow-sm">
    <h2 className="text-lg font-medium">Study preferences</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">The choices from your setup. PolyMate uses them when it recommends work, builds plans, and checks in.</p>
    {!draft && !error && <p role="status" className="mt-4 text-sm text-muted-foreground">Loading your preferences…</p>}
    {draft && groups.map(group => <fieldset key={group.key} disabled={busy} className="mt-4">
      <legend className="text-xs font-medium text-muted-foreground">{group.legend}</legend>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {DEMO_ONBOARDING_OPTIONS[group.key].map(option => {
          const selected = draft[group.key] === option.value;
          return <button key={option.value} type="button" role="radio" aria-checked={selected} title={option.description} onClick={() => { setDraft({ ...draft, [group.key]: option.value }); setNotice(''); }}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'}`}>{option.label}</button>;
        })}
      </div>
    </fieldset>)}
    {draft?.coachCadence !== saved?.coachCadence && <p className="mt-3 text-xs text-muted-foreground">{draft?.coachCadence === 'weekly' ? 'Saving this pauses check-in chats.' : 'Saving this turns check-in chats on.'}</p>}
    {draft && <Button type="button" size="sm" className="mt-4" disabled={!changed || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save preferences'}</Button>}
    {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
    {notice && <p className="mt-3 text-sm text-muted-foreground" role="status">{notice}</p>}
  </section>;
}
