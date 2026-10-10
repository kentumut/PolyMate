'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { MoodleSnapshot } from '@polymate/contracts/moodle';
import { MoodleCalendarPreview } from './moodle-calendar-preview';

async function readResponse(response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? 'Moodle could not be reached. Try again.');
  return result;
}

export function MoodleConnection() {
  const [subscriptionUrl, setSubscriptionUrl] = useState('');
  const [snapshot, setSnapshot] = useState<MoodleSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const status = await readResponse(await fetch('/api/integrations/moodle/connection', { cache: 'no-store', signal: controller.signal }));
        if (status.connected && status.mode === 'calendar-subscription') {
          setConnected(true);
          const result = await readResponse(await fetch('/api/integrations/moodle/calendar', { cache: 'no-store', signal: controller.signal }));
          setSnapshot(result.snapshot);
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load Moodle calendar.');
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load();
    return () => controller.abort();
  }, []);
  async function connect(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    try {
      const result = await readResponse(await fetch('/api/integrations/moodle/connection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscriptionUrl }),
      }));
      setSubscriptionUrl(''); setConnected(true); setSnapshot(result.snapshot); setMessage('Moodle calendar connected.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Moodle connection failed.'); }
    finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await readResponse(await fetch('/api/integrations/moodle/calendar', { method: 'POST' }));
      setSnapshot(result.snapshot); setMessage('Calendar refreshed from Moodle.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not refresh Moodle calendar.'); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError(''); setMessage('');
    try {
      await readResponse(await fetch('/api/integrations/moodle/connection', { method: 'DELETE' }));
      setConnected(false); setSnapshot(null); setMessage('Moodle calendar disconnected.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not disconnect Moodle.'); }
    finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-[#dce3db] bg-white p-6">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-medium">Moodle calendar subscription</h2>
      {connected && <span className="rounded-full bg-[#edf0e7] px-3 py-1 text-xs">Connected</span>}</div>
    <p className="mt-2 text-sm leading-6 text-[#617269]">Bring your course dates into PolyMate, then choose which entries need study time.</p>
    <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm leading-6 text-[#617269]">
      <li>Open your calendar in Moodle and choose <strong>Export calendar</strong>.</li>
      <li>Select events related to your courses and <strong>Recent and next 60 days</strong>.</li>
      <li>Choose <strong>Get calendar URL</strong> and paste the link below.</li>
    </ol>
    <form onSubmit={connect} className="mt-4 space-y-3">
      <label className="block text-sm">Private subscription URL
        <input type="password" autoComplete="off" spellCheck={false} required maxLength={4096} value={subscriptionUrl} onChange={event => setSubscriptionUrl(event.target.value)} placeholder="https://…/calendar/export_execute.php?…" className="mt-2 w-full rounded-lg border border-[#dce3db] p-2" />
      </label>
      <p className="text-xs leading-5 text-[#748278]">This link grants access to your calendar. PolyMate stores it encrypted on the server. Keep it private.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={busy} className="rounded-lg bg-[#173b32] px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Working…' : connected ? 'Replace subscription' : 'Connect calendar'}</button>
        {connected && <><button type="button" disabled={busy} onClick={refresh} className="text-sm underline disabled:opacity-50">Refresh</button>
          <button type="button" disabled={busy} onClick={disconnect} className="text-sm underline disabled:opacity-50">Disconnect</button></>}
      </div>
    </form>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-[#9e3e38]">{error}{snapshot ? ' The preview below is from the last successful refresh.' : ''}</p>}
    {snapshot ? <MoodleCalendarPreview snapshot={snapshot} /> : <p className="mt-4 text-xs leading-5 text-[#8a5a26]">The feed provides events and dates. Announcements, submission status, personal extensions, and full assignment instructions require opening Moodle.</p>}
  </section>;
}
