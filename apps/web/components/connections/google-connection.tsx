'use client';

import { useEffect, useState } from 'react';

type ConnectionStatus = { connected: boolean; enabled: boolean; csrfToken: string; issue?: 'needs_reconnect' };
type CalendarHome = 'polymate' | 'google';
const HOME_LABEL: Record<CalendarHome, string> = { polymate: 'PolyMate calendar', google: 'Google Calendar' };

export function GoogleConnection({ demo = false, onCalendarChange }: { demo?: boolean; onCalendarChange?: () => void }) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  // Confirmations must not read as errors.
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);
  const [home, setHome] = useState<CalendarHome | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<{ to: CalendarHome; upcomingBlocks: number; csrfToken: string } | null>(null);

  useEffect(() => {
    if (demo) return;
    const result = new URL(window.location.href).searchParams.get('google');
    const controller = new AbortController();
    fetch('/api/integrations/google/status', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Connection status is unavailable.');
        return response.json() as Promise<ConnectionStatus>;
      })
      .then(data => {
        setStatus(data);
        if (result === 'connected') setMessage({ text: 'Google Calendar connected and verified.', problem: false });
        if (result === 'error') setMessage({ text: 'Google Calendar access could not be verified. Allow the requested Calendar permission, then try again.', problem: true });
        if (result === 'denied') setMessage({ text: 'Google connection was cancelled.', problem: false });
        if (!result && data.issue === 'needs_reconnect') setMessage({ text: 'Your Google authorization has expired or was revoked. Reconnect to restore Google Calendar in PolyMate.', problem: true });
      })
      .catch(error => { if (!controller.signal.aborted) setMessage({ text: error.message, problem: true }); });
    fetch('/api/calendar/home', { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<{ home: CalendarHome }> : null)
      .then(data => { if (data) setHome(data.home); })
      .catch(() => {});
    return () => controller.abort();
  }, [demo]);

  if (demo) return <div className="mt-5 rounded-xl border bg-muted/40 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium">Google Calendar connected</p>
      <span className="rounded-full border bg-background px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Demo connection</span>
    </div>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">The walkthrough includes existing commitments as read-only busy time. Calendar changes remain inside the mentor demo.</p>
  </div>;

  /** Without confirm, the server only counts the upcoming blocks that would move. */
  async function requestHome(to: CalendarHome, confirm: boolean, csrfToken?: string) {
    setBusy(true);
    setMessage(null);
    try {
      const token = csrfToken ?? (await (await fetch('/api/calendar/csrf', { cache: 'no-store' })).json() as { csrfToken: string }).csrfToken;
      const response = await fetch('/api/calendar/home', {
        method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ home: to, confirm }),
      });
      const body = await response.json() as { home?: CalendarHome; upcomingBlocks?: number; moved?: number; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'The calendar could not be changed.');
      if (!confirm) {
        setPendingSwitch({ to, upcomingBlocks: body.upcomingBlocks ?? 0, csrfToken: token });
        return;
      }
      setPendingSwitch(null);
      setHome(body.home ?? to);
      setMessage({ text: `Study blocks are now saved to your ${HOME_LABEL[to]}${body.moved ? `; ${body.moved} upcoming block${body.moved === 1 ? '' : 's'} moved` : ''}.`, problem: false });
      onCalendarChange?.();
    } catch (error) {
      setPendingSwitch(null);
      setMessage({ text: error instanceof Error ? error.message : 'The calendar could not be changed.', problem: true });
    } finally {
      setBusy(false);
    }
  }

  async function changeConnection(action: 'start' | 'disconnect') {
    if (!status) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/integrations/google/${action}`, {
        method: 'POST', headers: { 'x-csrf-token': status.csrfToken }, cache: 'no-store',
      });
      const body = await response.json() as { url?: string; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'Google connection request failed.');
      if (action === 'start') {
        if (!body.url) throw new Error('Google authorization link is missing.');
        window.location.assign(body.url);
      } else {
        setStatus({ ...status, connected: false });
        setMessage({ text: 'Google Calendar disconnected.', problem: false });
      }
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Google connection request failed.', problem: true });
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-5 space-y-3">
    <p className="text-sm font-medium text-[#173b32]" role="status">
      {!status ? 'Checking Google connection…' : status.connected ? 'Google Calendar connected' : 'Google Calendar not connected'}
    </p>
    {status?.enabled && <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => changeConnection('start')}
        className="rounded-xl bg-[#173b32] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {status.connected || status.issue === 'needs_reconnect' ? 'Reconnect Google' : 'Connect Google'}
      </button>
      {status.connected && <button type="button" disabled={busy} onClick={() => changeConnection('disconnect')}
        className="rounded-xl border border-[#dce3db] px-4 py-2 text-sm font-medium disabled:opacity-50">
        Disconnect
      </button>}
    </div>}
    {status?.enabled && home && <fieldset className="space-y-2 rounded-xl border border-[#dce3db] p-3" disabled={busy}>
      <legend className="px-1 text-xs font-medium text-[#173b32]">Save study blocks to</legend>
      {(['google', 'polymate'] as const).map(option => <label key={option} className="flex items-start gap-2 text-sm">
        <input type="radio" name="calendar-home" className="mt-1" checked={home === option}
          disabled={option === 'google' && !status.connected && home !== 'google'}
          onChange={() => void requestHome(option, false)} />
        <span>{HOME_LABEL[option]}<span className="block text-xs text-[#617269]">{option === 'polymate'
          ? 'Blocks stay inside PolyMate. Connected Google events show as busy time.'
          : 'Blocks are added to your Google Calendar and also shown in PolyMate.'}</span></span>
      </label>)}
      {!status.connected && home !== 'google' && <p className="text-xs text-[#617269]">Connect Google to save study blocks there.</p>}
      {pendingSwitch && <div className="rounded-lg bg-[#edf0eb] p-3 text-xs leading-5 text-[#21362d]" role="status">
        <p>{pendingSwitch.upcomingBlocks
          ? `${pendingSwitch.upcomingBlocks} upcoming study block${pendingSwitch.upcomingBlocks === 1 ? '' : 's'} will move to your ${HOME_LABEL[pendingSwitch.to]}. Past blocks stay where they are.`
          : `New study blocks will be saved to your ${HOME_LABEL[pendingSwitch.to]}.`}</p>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => void requestHome(pendingSwitch.to, true, pendingSwitch.csrfToken)}
            className="rounded-lg bg-[#173b32] px-3 py-1.5 font-medium text-white">Switch</button>
          <button type="button" onClick={() => setPendingSwitch(null)} className="rounded-lg border border-[#dce3db] px-3 py-1.5 font-medium">Cancel</button>
        </div>
      </div>}
    </fieldset>}
    {status && !status.enabled && <p className="text-xs text-[#617269]">Google connection is not configured yet.</p>}
    {message && <p className={message.problem ? 'text-xs text-[#9e3e38]' : 'text-xs text-[#617269]'} role={message.problem ? 'alert' : 'status'}>{message.text}</p>}
  </div>;
}
