'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { DurableImportPreview, ImportCollection, ImportKind, ImportSaveRequest, ImportSaveResult, ImportSource, ImportState } from '@polymate/contracts/imports';
import { initialAssignmentFields, validateAssignmentFields, type AssignmentFields } from './assignment-form';
import { createPersistentImportClient, importAssignmentFields, ImportConfirmationError, validateImportFile } from './calendar-import-client';

const time = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const control = 'min-h-11 w-full rounded-lg border border-[#c8d3c8] bg-white p-2 text-sm';
const button = 'min-h-11 rounded-lg border border-[#173b32] px-3 py-2 text-sm disabled:opacity-50';

export function PersistentImportPanel({ onSaved }: { onSaved?: () => void }) {
  const id = useId(); const [client] = useState(createPersistentImportClient);
  const [collections, setCollections] = useState<ImportCollection[]>([]);
  const [collectionId, setCollectionId] = useState('');
  const [name, setName] = useState('My Moodle calendar'); const [source, setSource] = useState<ImportSource>('moodle');
  const [file, setFile] = useState<File>(); const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<DurableImportPreview>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [kinds, setKinds] = useState<Record<string, ImportKind>>({});
  const [fields, setFields] = useState<Record<string, AssignmentFields>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportSaveResult>(); const [pending, setPending] = useState<ImportSaveRequest>();
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const inFlight = useRef(false); const feedback = useRef<HTMLParagraphElement>(null);
  const locked = busy || loading || Boolean(pending) || Boolean(result);

  const showPreview = useCallback((next: DurableImportPreview) => {
    setPreview(next); setCollectionId(next.collection.id); setSource(next.source); setName(next.collection.name);
    setSelected(new Set()); setErrors({});
    setKinds(Object.fromEntries(next.rows.map(row => [row.event.key, row.previousKind ?? (next.source === 'mystudies' ? 'commitment' : 'assignment')])));
    setFields(Object.fromEntries(next.rows.map(row => {
      const value = row.suggestedInput ? initialAssignmentFields(row.suggestedInput) : importAssignmentFields(row.event);
      // A changed all-day source still needs an explicitly reviewed time, never guessed midnight.
      if (row.event.allDay && row.change !== 'unchanged') { const sourceFields = importAssignmentFields(row.event); value.date = sourceFields.date; value.time = ''; }
      return [row.event.key, value];
    })));
  }, []);
  const restore = useCallback((state: ImportState) => {
    setCollections(state.collections); setResult(state.result ?? undefined);
    if (state.preview) showPreview(state.preview);
    else setPreview(undefined);
  }, [showPreview]);
  useEffect(() => {
    let active = true;
    client.state().then(state => { if (active) restore(state); }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Imports could not be loaded.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client, restore]);

  function reset() {
    setPreview(undefined); setFile(undefined); setSelected(new Set()); setFields({}); setErrors({}); setMessage(''); setResult(undefined);
    if (fileInput.current) fileInput.current.value = '';
  }
  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const state = await client.state(pending ? undefined : collectionId || undefined, pending?.previewId);
      if (pending && state.result?.requestId !== pending.requestId) {
        setMessage('No saved receipt is available yet. Your original selection remains frozen; retry the same import to resolve it.');
      } else {
        restore(state); setPending(undefined); setMessage('Reloaded saved import state. A confirmed import remains saved after reload.'); onSaved?.();
      }
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Imports could not be loaded.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function parse() {
    if (!file || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('Reading and storing a reviewable preview…');
    try {
      const next = await client.preview(file, source, collectionId ? { collectionId } : { name });
      showPreview(next); setResult(undefined);
      setCollections(previous => [...previous.filter(item => item.id !== next.collection.id), next.collection]);
      setMessage(next.events.length ? 'Preview ready. Nothing has been added to assignments or planning commitments yet.' : 'No supported events found. Existing imports have not been removed.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Preview failed.'); }
    finally { inFlight.current = false; setBusy(false); feedback.current?.focus(); }
  }
  async function confirm() {
    if (!preview || inFlight.current || result) return;
    const selections: ImportSaveRequest['selections'] = []; const validation: Record<string, string> = {};
    for (const row of preview.rows) {
      if (!selected.has(row.event.key)) continue;
      if (kinds[row.event.key] === 'commitment') {
        if (Date.parse(row.event.endAt) <= Date.parse(row.event.startAt)) validation[row.event.key] = 'Commitments need an end time after their start. Re-export this event.';
        else selections.push({ key: row.event.key, kind: 'commitment' });
      } else {
        const checked = validateAssignmentFields(fields[row.event.key]);
        if (checked.errors) validation[row.event.key] = Object.values(checked.errors).join(' ');
        else selections.push({ key: row.event.key, kind: 'assignment', input: checked.input });
      }
    }
    setErrors(validation);
    if (!pending && (!selections.length || Object.keys(validation).length)) { setMessage('Select events and correct the highlighted details.'); feedback.current?.focus(); return; }
    // One server-generated preview UUID doubles as the stable confirmation UUID. Reload can recover its receipt.
    const request = pending ?? { previewId: preview.id, requestId: preview.id, selections };
    inFlight.current = true; setBusy(true); setMessage('Saving reviewed imports…');
    try {
      const saved = await client.confirm(request); setResult(saved); setPending(undefined);
      setMessage('Import saved. Assignments and read-only planning commitments persist after reload; no Google events were created or moved.'); onSaved?.();
    } catch (error) {
      if (error instanceof ImportConfirmationError && error.kind === 'unknown') setPending(request);
      setMessage(error instanceof Error ? error.message : 'Import could not be confirmed.');
    } finally { inFlight.current = false; setBusy(false); feedback.current?.focus(); }
  }
  return <section className="space-y-4 rounded-xl border border-[#c8d3c8] p-4" aria-label="Import calendar review" aria-busy={busy || loading}>
    <h3 className="font-semibold">Import calendar</h3>
    <p className="text-sm">Confirm selected assignments or read-only timetable commitments. Reimport into the same collection to update existing records without duplicates. Nothing is written to Google by this import.</p>
    <p className="text-xs">File exports are snapshots. Missing events are not deleted. Source dates are planning targets, not verified official deadlines. Updating an estimate does not reset remaining effort or reopen completed work.</p>
    {loading ? <p role="status">Loading saved imports…</p> : <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Import collection<select className={control} disabled={locked || Boolean(preview)} value={collectionId} onChange={event => { const value = event.target.value; setCollectionId(value); const collection = collections.find(item => item.id === value); if (collection) { setSource(collection.source); setName(collection.name); } }}><option value="">New collection</option>{collections.map(item => <option key={item.id} value={item.id}>{item.name} ({item.source})</option>)}</select></label>
      {!collectionId && <label className="text-sm">Collection name<input className={control} maxLength={100} value={name} disabled={locked || Boolean(preview)} onChange={event => setName(event.target.value)} /></label>}
      <label className="text-sm">Source<select className={control} disabled={locked || Boolean(preview) || Boolean(collectionId)} value={source} onChange={event => { const next = event.target.value as ImportSource; setSource(next); setName(next === 'moodle' ? 'My Moodle calendar' : 'MyStudies timetable'); }}><option value="moodle">Moodle</option><option value="mystudies">myStudies</option></select></label>
      <label className="text-sm">ICS file (up to 1 MB)<input ref={fileInput} className={control} type="file" accept=".ics,text/calendar" disabled={locked || Boolean(preview)} onChange={event => { const next = event.target.files?.[0]; setFile(undefined); setMessage(''); if (next) try { validateImportFile(next); setFile(next); } catch (error) { setMessage(error instanceof Error ? error.message : 'Invalid file.'); } }} /></label>
    </div>}
    <div className="flex flex-wrap gap-2">
      {!preview && <button type="button" className={button} disabled={!file || busy || loading || (!collectionId && !name.trim())} onClick={() => void parse()}>Preview file</button>}
      {(file || preview) && <button type="button" className={button} disabled={busy || Boolean(pending)} onClick={reset}>{result ? 'Review another export' : 'Back / replace file'}</button>}
      <button type="button" className={button} disabled={busy || loading} onClick={() => void reload()}>Reload saved import state</button>
    </div>
    <p ref={feedback} tabIndex={-1} role="status" className="break-words text-sm">{message}</p>
    {preview && <>
      <p className="text-xs">{preview.collection.name} · {preview.source} · Previewed {time(preview.previewedAt)} · Confirm by {time(preview.expiresAt)} · {selected.size} selected. Recurrence window: {time(preview.recurrenceWindow.from)}–{time(preview.recurrenceWindow.to)}.</p>
      <ul className="list-inside list-disc text-xs text-[#8a5a26]" aria-label="Import warnings">{preview.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
      <ul className="max-h-[36rem] space-y-3 overflow-y-auto" aria-label="Imported event preview">{preview.rows.map((row, index) => {
        const event = row.event; const rowId = `${id}-${index}`; const chosen = selected.has(event.key); const kind = kinds[event.key]; const value = fields[event.key];
        return <li key={event.key} className="space-y-2 rounded-lg border border-[#dce3db] p-3">
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={chosen} disabled={locked} onChange={change => setSelected(previous => { const next = new Set(previous); if (change.target.checked) next.add(event.key); else next.delete(event.key); return next; })} /><span className="break-words"><strong>{event.title}</strong> · {row.change}{row.previousKind && ` · saved ${row.previousKind}`}</span></label>
          <p className="text-xs">{time(event.startAt)}–{time(event.endAt)} {event.allDay && '· All-day; no deadline time specified'}</p>
          {row.assignment && <p className="text-xs">Saved assignment: {row.assignment.remainingMinutes} min remaining · {row.assignment.status}. Progress and linked sessions will be preserved.</p>}
          <details className="text-xs"><summary className="min-h-11 cursor-pointer py-3">Source details</summary><p className="break-all">UID: {event.uid} {event.recurrenceId && `· Occurrence: ${event.recurrenceId}`}</p><p className="whitespace-pre-wrap break-words">{event.description || 'No description.'}</p></details>
          {chosen && <>
            <label className="block text-sm">Save as<select className={control} disabled={locked || Boolean(row.previousKind)} value={kind} onChange={change => setKinds(previous => ({ ...previous, [event.key]: change.target.value as ImportKind }))}><option value="assignment">Assignment with deadline and effort</option><option value="commitment">Read-only commitment (blocks planning time)</option></select></label>
            {kind === 'commitment' ? <p className="text-xs">Uses the original event times. This blocks slots in the manual-assignment planner; it is not an editable Google event.</p> : <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2" aria-describedby={errors[event.key] ? `${rowId}-error` : undefined}>
              <legend className="text-xs">Review assignment details — Europe/Zurich</legend>
              {(['title','date','time','estimatedMinutes'] as const).map(field => <label key={field} className="text-xs">{{ title: 'Title', date: 'Deadline date', time: 'Deadline time', estimatedMinutes: 'Estimated effort (minutes)' }[field]}<input className={control} type={field === 'date' ? 'date' : field === 'time' ? 'time' : field === 'estimatedMinutes' ? 'number' : 'text'} min={field === 'estimatedMinutes' ? 1 : undefined} step={field === 'estimatedMinutes' ? 1 : undefined} maxLength={field === 'title' ? 200 : undefined} value={value[field]} aria-invalid={Boolean(errors[event.key])} onChange={change => { setFields(previous => ({ ...previous, [event.key]: { ...previous[event.key], [field]: change.target.value } })); setErrors(previous => { const next = { ...previous }; delete next[event.key]; return next; }); }} /></label>)}
            </fieldset>}
          </>}
          {errors[event.key] && <p id={`${rowId}-error`} role="alert" className="text-sm text-[#9b302b]">{errors[event.key]}</p>}
        </li>;
      })}</ul>
      {pending && <p className="text-sm">Response unconfirmed. Your original selection is frozen. Retry it or reload saved state to recover the receipt; do not start another import.</p>}
      {!result && <button type="button" className={`${button} bg-[#173b32] text-white`} disabled={busy || (!pending && !selected.size)} onClick={() => void confirm()}>{busy ? 'Saving…' : pending ? 'Retry same import' : 'Confirm selected imports'}</button>}
      {result && <p role="status" className="text-sm">Saved: {result.created} new, {result.updated} updated, {result.unchanged} unchanged. {result.assignments.length} assignments and {result.commitments} read-only commitments reviewed. Saved {time(result.savedAt)}.</p>}
    </>}
  </section>;
}
