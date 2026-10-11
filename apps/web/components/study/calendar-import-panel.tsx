'use client';

import { useId, useRef, useState } from 'react';
import type { ImportPreview, ImportSource } from '@polymate/core/calendar/import';
import type { AssignmentFields } from './assignment-form';
import { createImportFixtureAdapter, ImportConfirmationError, importAssignmentFields, prepareImportSelections, previewImport, validateImportFile,
  type ImportConfirmation, type ImportOutcome, type ImportResult } from './calendar-import-client';
import { PersistentImportPanel } from './persistent-import-panel';

const time = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const control = 'min-h-11 w-full rounded-lg border border-[#c8d0dc] bg-white p-2 text-sm';
const button = 'min-h-11 rounded-lg border border-[#08407e] px-3 py-2 text-sm disabled:opacity-50';

export function CalendarImportPanel({ fixture = false, onSaved }: { fixture?: boolean; onSaved?: () => void }) {
  return fixture ? <FixtureImportPanel /> : <PersistentImportPanel onSaved={onSaved} />;
}

function FixtureImportPanel() {
  const id = useId();
  const [source, setSource] = useState<ImportSource>('moodle');
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<ImportPreview>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [fields, setFields] = useState<Record<string, AssignmentFields>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult>();
  const [pending, setPending] = useState<ImportConfirmation>();
  const [outcome, setOutcome] = useState<ImportOutcome>('success');
  const [adapter] = useState(createImportFixtureAdapter);
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const request = useRef<AbortController | null>(null);
  const locked = busy || Boolean(pending) || Boolean(result);

  function reset() {
    request.current?.abort(); setFile(undefined); setPreview(undefined); setSelected(new Set()); setFields({}); setErrors({}); setMessage(''); setResult(undefined);
    if (fileInput.current) fileInput.current.value = '';
  }
  async function parse() {
    if (!file || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('Reading calendar file…');
    const controller = new AbortController(); request.current = controller;
    try {
      const next = await previewImport(file, source, AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]), { fixture: true });
      setPreview(next); setFields(Object.fromEntries(next.events.map(event => [event.key, importAssignmentFields(event)])));
      setMessage(next.events.length ? 'Preview ready. Select the events that are assignments and review their deadlines.' : 'No supported events were found. Try another export.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The calendar could not be previewed.'); }
    finally { inFlight.current = false; setBusy(false); feedback.current?.focus(); }
  }
  async function confirm() {
    if (!preview || inFlight.current || result) return;
    const prepared = prepareImportSelections(preview.events, selected, fields);
    setErrors(prepared.errors);
    if (!pending && (Object.keys(prepared.errors).length || !prepared.selections.length)) { setMessage('Select at least one assignment and correct the highlighted details.'); feedback.current?.focus(); return; }
    const payload = pending ?? { requestId: crypto.randomUUID(), source: preview.source, selections: prepared.selections };
    inFlight.current = true; setBusy(true); setMessage('Confirming fixture selection…');
    try {
      setResult(await adapter.confirm(payload, outcome)); setPending(undefined); setMessage('Fixture confirmation complete. Nothing was saved to your assignments or Google Calendar.');
    } catch (error) {
      if (error instanceof ImportConfirmationError && error.kind === 'unknown') setPending(payload);
      setMessage(error instanceof Error ? error.message : 'Confirmation failed; your edits are preserved.');
    } finally { inFlight.current = false; setBusy(false); feedback.current?.focus(); }
  }
  return <section className="space-y-4 rounded-xl border border-[#c8d0dc] p-4" aria-label="Import calendar review" aria-busy={busy}>
    <h3 className="font-semibold">Import calendar — review prototype</h3>
    <p className="text-sm text-[#656e7c]">Upload a Moodle or myStudies ICS export. Parsing is real; confirmation is a labelled fixture, in memory only. It does not create assignments or calendar events. Reload clears this review.</p>
    <p className="text-xs">Every event starts unselected. Lectures and personal commitments are not automatically assignments. File exports are snapshots; use a new export to review changes.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Source<select className={control} disabled={busy || Boolean(preview) || Boolean(pending)} value={source} onChange={event => setSource(event.target.value as ImportSource)}><option value="moodle">Moodle</option><option value="mystudies">myStudies</option></select></label>
      <label className="text-sm">Calendar export (.ics, up to 1 MB)<input ref={fileInput} type="file" accept=".ics,text/calendar" className={control} disabled={locked || Boolean(preview)} onChange={event => {
        const next = event.target.files?.[0]; setMessage(''); setFile(undefined);
        if (!next) return;
        try { validateImportFile(next); setFile(next); } catch (error) { setMessage(error instanceof Error ? error.message : 'Choose a valid file.'); }
      }} /></label>
    </div>
    {!preview && <button type="button" className={button} disabled={!file || busy} onClick={() => void parse()}>{busy ? 'Reading…' : 'Preview file'}</button>}
    {(file || preview) && <button type="button" className={`${button} ml-2`} disabled={busy || Boolean(pending)} onClick={reset}>{result ? 'Review another export' : 'Back / replace file'}</button>}
    <p ref={feedback} tabIndex={-1} role="status" className="break-words text-sm">{message}</p>
    {preview && <>
      <p className="break-words text-xs">Source: {preview.source === 'moodle' ? 'Moodle' : 'myStudies'} · {file?.name} · Previewed {time(preview.previewedAt)} · {selected.size} of {preview.events.length} selected. Recurring series: {time(preview.recurrenceWindow.from)}–{time(preview.recurrenceWindow.to)}.</p>
      {preview.warnings.length > 0 && <ul aria-label="Import warnings" className="list-inside list-disc space-y-1 text-xs text-[#8a5a26]">{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      <ul className="max-h-[36rem] space-y-3 overflow-y-auto" aria-label="Imported event preview">{preview.events.map((event, index) => {
        const rowId = `${id}-${index}`; const value = fields[event.key]; const chosen = selected.has(event.key);
        return <li key={event.key} className="space-y-2 rounded-lg border border-[#dbe1ea] p-3">
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={chosen} disabled={locked} onChange={change => setSelected(previous => {
            const next = new Set(previous); if (change.target.checked) next.add(event.key); else next.delete(event.key); return next;
          })} /><span className="break-words">Prepare as assignment: <strong>{event.title}</strong></span></label>
          <p className="text-xs">{time(event.startAt)}–{time(event.endAt)} {event.allDay && '· All-day: no deadline time specified'}</p>
          <details className="text-xs"><summary className="min-h-11 cursor-pointer py-3">Source details</summary><p className="break-all">UID: {event.uid}{event.recurrenceId && ` · Occurrence: ${event.recurrenceId}`}</p><p className="whitespace-pre-wrap break-words">{event.description || 'No description in this export.'}</p></details>
          {chosen && <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2" aria-describedby={errors[event.key] ? `${rowId}-error` : undefined}>
            <legend className="text-xs">Review assignment details — source dates are planning targets; confirm the actual deadline.</legend>
            {(['title', 'date', 'time', 'estimatedMinutes'] as const).map(field => <label key={field} className="text-xs">{{ title: 'Title', date: 'Deadline date (Zurich)', time: 'Deadline time (Zurich)', estimatedMinutes: 'Estimated effort (minutes)' }[field]}<input className={control} type={field === 'date' ? 'date' : field === 'time' ? 'time' : field === 'estimatedMinutes' ? 'number' : 'text'} min={field === 'estimatedMinutes' ? 1 : undefined} step={field === 'estimatedMinutes' ? 1 : undefined} maxLength={field === 'title' ? 200 : undefined} value={value[field]} aria-invalid={Boolean(errors[event.key])} onChange={change => { setFields(previous => ({ ...previous, [event.key]: { ...previous[event.key], [field]: change.target.value } })); setErrors(previous => { const next = { ...previous }; delete next[event.key]; return next; }); }} /></label>)}
            {errors[event.key] && <p id={`${rowId}-error`} role="alert" className="text-sm text-[#9b302b] sm:col-span-2">{errors[event.key]}</p>}
          </fieldset>}
        </li>;
      })}</ul>
      {!result && <>
        <label className="block text-sm">Fixture confirmation outcome<select className={control} value={outcome} disabled={busy || Boolean(pending)} onChange={event => setOutcome(event.target.value as ImportOutcome)}>
          <option value="success">Success</option><option value="failure">Failed save</option><option value="conflict">Source conflict</option><option value="unknown">Lost reply — same-request retry</option><option value="slow">Slow confirmation</option>
        </select></label>
        {pending && <p className="text-sm">Unconfirmed fixture request. Your original selection is frozen; retry it before replacing the file.</p>}
        <button type="button" className={`${button} bg-[#08407e] text-white`} disabled={busy || (!pending && !selected.size)} onClick={() => void confirm()}>{busy ? 'Confirming…' : pending ? 'Retry same fixture request' : 'Confirm selection — fixture only'}</button>
      </>}
      {result && <p role="status" className="text-sm">Fixture result: {result.created} new, {result.updated} changed, {result.unchanged} unchanged. This adapter deduplicates reviewed assignments within this tab only; persistent reimport is not connected.</p>}
    </>}
  </section>;
}
