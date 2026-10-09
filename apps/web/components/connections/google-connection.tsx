'use client';

import { useEffect, useState } from 'react';

type ConnectionStatus = { connected: boolean; enabled: boolean; csrfToken: string };

export function GoogleConnection() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const result = new URL(window.location.href).searchParams.get('google');
    const controller = new AbortController();
    fetch('/api/integrations/google/status', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Connection status is unavailable.');
        return response.json() as Promise<ConnectionStatus>;
      })
      .then(data => {
        setStatus(data);
        if (result === 'error') setMessage('Google connection failed. Please try again.');
        if (result === 'denied') setMessage('Google connection was cancelled.');
      })
      .catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, []);

  async function changeConnection(action: 'start' | 'disconnect') {
    if (!status) return;
    setBusy(true);
    setMessage('');
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
        setMessage('Google Calendar disconnected.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Google connection request failed.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="mt-5 space-y-3">
    <p className="text-sm font-medium text-[#173b32]" role="status">
      {!status ? 'Checking Google connection…' : status.connected ? 'Google Calendar connected' : 'Google Calendar not connected'}
    </p>
    {status?.enabled && <div className="flex flex-wrap justify-center gap-2">
      <button type="button" disabled={busy} onClick={() => changeConnection('start')}
        className="rounded-xl bg-[#173b32] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {status.connected ? 'Reconnect Google' : 'Connect Google'}
      </button>
      {status.connected && <button type="button" disabled={busy} onClick={() => changeConnection('disconnect')}
        className="rounded-xl border border-[#dce3db] px-4 py-2 text-sm font-medium disabled:opacity-50">
        Disconnect
      </button>}
    </div>}
    {status && !status.enabled && <p className="text-xs text-[#617269]">Google connection is not configured yet.</p>}
    {message && <p className="text-xs text-[#9e3e38]" role="alert">{message}</p>}
  </div>;
}
