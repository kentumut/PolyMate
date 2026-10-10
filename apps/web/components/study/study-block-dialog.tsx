'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  completionTarget, deletionTarget, existingStudyBlockFields, initialStudyBlockFields, movedEnd, suggestedEnd, validateStudyBlock,
  type StudyBlockDialogEvent, type StudyBlockErrors, type StudyBlockFields, type StudyBlockInput, type StudyBlockOperationResult,
} from './study-block-form';

export type StudyBlockDialogProps = {
  open: boolean;
  selectedEvent: StudyBlockDialogEvent | null;
  initialStartAt?: string;
  initialEndAt?: string;
  onClose: () => void;
  onCreate: (input: StudyBlockInput) => Promise<StudyBlockOperationResult>;
  onUpdate?: (eventId: string, input: StudyBlockInput, expectedEtag: string) => Promise<StudyBlockOperationResult>;
  onComplete?: (eventId: string, expectedEtag: string) => Promise<StudyBlockOperationResult>;
  onDelete?: (eventId: string, expectedEtag: string) => Promise<StudyBlockOperationResult>;
  onReconcile?: () => Promise<StudyBlockOperationResult>;
  /** Adapter supplies updates when a pending/uncertain operation is reconciled. */
  operationResult?: StudyBlockOperationResult;
  fixtureMode?: boolean;
  creationFields?: ReactNode;
  extraContent?: ReactNode;
  writeBlocked?: boolean;
  externalSubmitting?: boolean;
  reportedCompletion?: boolean;
  onRequestReschedule?: (focusStart: () => void) => void;
};

export function StudyBlockDialog(props: StudyBlockDialogProps) {
  // Reset on reopen/event selection, but preserve drafts on same-event refreshes.
  return props.open ? <StudyBlockDialogForm key={props.selectedEvent ? `event:${props.selectedEvent.id}` : 'create'} {...props} /> : null;
}

function StudyBlockDialogForm({ selectedEvent, initialStartAt, initialEndAt, onClose, onCreate, onUpdate, onComplete, onDelete, onReconcile, operationResult, fixtureMode = false,
  creationFields, extraContent, writeBlocked = false, externalSubmitting = false, reportedCompletion = false, onRequestReschedule }: StudyBlockDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingDelete = useRef(false);
  // Snapshot the loaded event: refreshes must not silently advance the draft's ETag.
  const [loadedEvent] = useState(() => selectedEvent ? { ...selectedEvent } : null);
  const [fields, setFields] = useState(() => loadedEvent ? existingStudyBlockFields(loadedEvent) : initialStudyBlockFields(initialStartAt, initialEndAt));
  const [errors, setErrors] = useState<StudyBlockErrors>({});
  const [endEdited, setEndEdited] = useState(false);
  const [result, setResult] = useState<StudyBlockOperationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [transportUncertain, setTransportUncertain] = useState(false);
  const [action, setAction] = useState<'create' | 'update' | 'complete' | 'delete'>(selectedEvent ? 'update' : 'create');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const editing = loadedEvent !== null;
  const protectedEvent = editing && (loadedEvent.source !== 'polymate' || !loadedEvent.editable || selectedEvent?.source !== 'polymate' || !selectedEvent.editable || !loadedEvent.etag);
  const readOnly = protectedEvent || (editing && !onUpdate && !onComplete && !onDelete);

  const currentResult = result && operationResult?.operationId === result.operationId ? operationResult : result;
  const status = transportUncertain ? 'unknown' : submitting ? 'pending' : currentResult?.status;
  const locked = readOnly || writeBlocked || status === 'pending' || status === 'unknown' || status === 'synced';
  const target = completionTarget(loadedEvent, selectedEvent);
  const deleteTarget = deletionTarget(loadedEvent, selectedEvent);
  const completed = reportedCompletion || loadedEvent?.completion === 'done' || selectedEvent?.completion === 'done' || (action === 'complete' && status === 'synced');
  const savedFields = loadedEvent ? existingStudyBlockFields(loadedEvent) : null;
  const dirty = savedFields && (Object.keys(fields) as (keyof StudyBlockFields)[]).some(field => fields[field] !== savedFields[field]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    if (confirmingDelete) deleteCancelRef.current?.focus();
    else if (wasConfirmingDelete.current) deleteTriggerRef.current?.focus();
    wasConfirmingDelete.current = confirmingDelete;
  }, [confirmingDelete]);

  useEffect(() => {
    if ((action === 'create' || action === 'update') && status === 'synced') onClose();
  }, [action, onClose, status]);

  useEffect(() => {
    onRequestReschedule?.(() => {
      const input = formRef.current?.elements.namedItem('date');
      if (input instanceof HTMLElement) input.focus();
    });
  }, [onRequestReschedule]);

  function change(field: keyof StudyBlockFields, value: string) {
    const next = { ...fields, [field]: value };
    if (field === 'endTime' || field === 'endDate') setEndEdited(true);
    if (!endEdited && (field === 'date' || field === 'startTime')) {
      const end = editing ? movedEnd(fields, next.date, next.startTime) : suggestedEnd(next.date, next.startTime);
      if (end) { next.endDate = end.date; next.endTime = end.time; }
      else if (field === 'date' && !next.endDate) next.endDate = value;
    }
    setFields(next);
    setErrors({});
    setResult(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || locked || confirmingDelete || (editing && !onUpdate)) return;
    const validated = validateStudyBlock(fields);
    if (!validated.input) {
      setErrors(validated.errors);
      const first = Object.keys(validated.errors)[0];
      const input = formRef.current?.elements.namedItem(first);
      if (input instanceof HTMLElement) input.focus();
      return;
    }
    await runMutation(editing ? 'update' : 'create', () => loadedEvent && onUpdate
      ? onUpdate(loadedEvent.id, validated.input, loadedEvent.etag)
      : onCreate(validated.input));
  }

  async function markDone() {
    if (inFlight.current || locked || confirmingDelete || completed || !target || !onComplete) return;
    await runMutation('complete', () => onComplete(target.eventId, target.expectedEtag));
  }

  function requestDelete() {
    if (inFlight.current || locked || !deleteTarget || !onDelete) return;
    setResult(null);
    setConfirmingDelete(true);
  }

  function cancelDelete() {
    if (inFlight.current || reconciling) return;
    if (status === 'unknown' || status === 'synced' || status === 'pending') { onClose(); return; }
    setResult(null);
    setConfirmingDelete(false);
  }

  async function checkOutcome() {
    if (inFlight.current || reconciling || !onReconcile) return;
    setReconciling(true);
    try {
      const next = await onReconcile();
      setResult(next);
      setTransportUncertain(false);
    } catch {
      setTransportUncertain(true);
    } finally { setReconciling(false); }
  }

  async function confirmDelete() {
    if (!confirmingDelete || inFlight.current || locked || !deleteTarget || !onDelete) return;
    await runMutation('delete', () => onDelete(deleteTarget.eventId, deleteTarget.expectedEtag));
  }

  async function runMutation(nextAction: typeof action, execute: () => Promise<StudyBlockOperationResult>) {
    inFlight.current = true;
    setAction(nextAction);
    setSubmitting(true);
    setResult(null);
    setErrors({});
    try {
      setResult(await execute());
    } catch {
      // The adapter must retain/reconcile the operation before a repeat write.
      setTransportUncertain(true);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const pendingLabel = action === 'delete' ? 'Deleting…' : action === 'complete' ? 'Marking done…' : action === 'update' ? 'Saving…' : 'Creating…';
  const successLabel = action === 'delete' ? 'Deleted' : action === 'complete' ? 'Marked done' : action === 'update' ? 'Updated' : 'Created';
  const message = status === 'pending' ? pendingLabel
    : status === 'synced' ? fixtureMode ? `Fixture block ${successLabel.toLowerCase()}. No persistent event was saved.` : `${successLabel} in your calendar.`
    : status === 'unknown' ? 'We could not confirm whether this change was saved. Refresh the calendar before trying again.'
    : status === 'failed' ? currentResult?.error?.message || `The block could not be ${successLabel.toLowerCase()}. Review your connection and try again.`
    : '';

  const inputClass = 'mt-2 w-full rounded-lg border border-[#c8d3c8] bg-white px-3 py-2.5 text-sm disabled:bg-[#edf0eb]';
  function input(field: keyof StudyBlockFields, label: string, type: string) {
    return <div>
      <label htmlFor={`${id}-${field}`} className="text-sm font-medium">{label}</label>
      <input id={`${id}-${field}`} name={field} type={type} value={fields[field]}
        onChange={event => change(field, event.target.value)} disabled={locked || (editing && !onUpdate)}
        required aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `${id}-${field}-error` : undefined}
        className={inputClass} />
      {errors[field] && <p id={`${id}-${field}-error`} className="mt-2 text-sm text-[#9b302b]">{errors[field]}</p>}
    </div>;
  }

  const feedback = <div role="status" aria-live="polite" aria-atomic="true">
    {message && <p className={`rounded-lg border p-3 text-sm ${status === 'failed' ? 'border-[#d9aaa5] text-[#9b302b]' : 'border-[#c8d3c8]'}`}>
      {status === 'unknown' && <strong>Uncertain: </strong>}{message}
    </p>}
    {status === 'failed' && currentResult?.error?.code === 'conflict' && <p className="mt-2 text-sm">Close this dialog, refresh the calendar, and reopen the block to review its latest saved values.</p>}
    {(status === 'pending' || status === 'unknown') && !submitting && onReconcile && <button type="button" onClick={checkOutcome} disabled={reconciling} className="mt-2 text-sm underline disabled:opacity-50">{reconciling ? 'Checking…' : 'Check change'}</button>}
  </div>;
  const savedTimeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' });

  return <dialog ref={dialogRef} aria-labelledby={`${id}-heading`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); if (!submitting && !reconciling && !externalSubmitting) { if (confirmingDelete) cancelDelete(); else onClose(); } }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-[#dce3db] bg-[#f6f7f3] p-6 text-[#173b32] shadow-xl backdrop:bg-black/35">
    <h2 id={`${id}-heading`} className="text-2xl font-semibold">{confirmingDelete ? 'Delete study block?' : readOnly ? 'Event details' : editing ? 'Edit study block' : 'Create a study block'}</h2>
    <p id={`${id}-description`} className="mt-2 text-sm leading-6 text-[#617269]">{confirmingDelete ? 'Review the saved block before deleting it.' : readOnly ? 'This event is read-only here.' : editing ? 'Change the title or move this study block.' : 'Choose your study time.'} All times are in Europe/Zurich.</p>
    {editing && <p className="mt-2 text-sm text-[#617269]">Completion: {completed ? 'Done' : 'Open'}</p>}
    {loadedEvent?.allDay && <p className="mt-2 text-sm text-[#617269]">All-day commitment. The end date is exclusive.</p>}
    {fixtureMode && <p className="mt-3 rounded-lg bg-[#e8ede5] p-3 text-sm">Development fixture — changes are not persisted.</p>}
    {confirmingDelete && loadedEvent ? <section className="mt-6 space-y-5" aria-label="Deletion confirmation">
      <p className="font-medium">Delete “{loadedEvent.title}” from {fixtureMode ? 'the fixture calendar' : 'your calendar'}?</p>
      <p className="text-sm text-[#617269]">{savedTimeFormatter.format(new Date(loadedEvent.startAt))} – {savedTimeFormatter.format(new Date(loadedEvent.endAt))} (Europe/Zurich)</p>
      {dirty && <p className="text-sm text-[#617269]">Unsaved edits will not be saved. Delete applies to the saved block shown above.</p>}
      {feedback}
      <div className="flex flex-wrap justify-end gap-3 border-t border-[#dce3db] pt-4">
        <button ref={deleteCancelRef} type="button" onClick={cancelDelete} disabled={submitting || reconciling || externalSubmitting} className="rounded-lg border border-[#c8d3c8] px-4 py-2.5 text-sm font-medium disabled:opacity-50">
          {status === 'synced' || status === 'unknown' || status === 'pending' ? 'Close' : 'Cancel'}
        </button>
        {status !== 'synced' && <button type="button" onClick={confirmDelete} disabled={locked} className="rounded-lg bg-[#9b302b] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {status === 'pending' ? 'Deleting…' : 'Delete'}
        </button>}
      </div>
    </section> : <form ref={formRef} onSubmit={submit} noValidate className="mt-6 space-y-5">
      {!editing && creationFields}
      {input('title', 'Title', 'text')}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {input('date', 'Start date', 'date')}
        {input('startTime', 'Start time', 'time')}
        {input('endDate', 'End date', 'date')}
        {input('endTime', 'End time', 'time')}
      </div>
      {!readOnly && <p className="text-xs text-[#617269]">{editing ? 'Moving the start preserves the current duration until you edit the end.' : 'We suggest 50 minutes. You can change the end date and time.'}</p>}
      {target && onComplete && !completed && <p id={`${id}-completion-note`} className="text-sm text-[#617269]">
        {dirty ? 'You have unsaved edits. Mark done applies to the saved block; these edits will not be saved.' : 'Mark done records that you completed this study session, not the entire assignment.'}
      </p>}
      {feedback}
      <div className="flex flex-wrap justify-end gap-3 border-t border-[#dce3db] pt-4">
        <button type="button" onClick={onClose} disabled={submitting || reconciling || externalSubmitting} className="rounded-lg border border-[#c8d3c8] px-4 py-2.5 text-sm font-medium disabled:opacity-50">
          {readOnly || status === 'synced' || status === 'unknown' || status === 'pending' ? 'Close' : 'Cancel'}
        </button>
        {deleteTarget && onDelete && status !== 'synced' && <button ref={deleteTriggerRef} type="button" onClick={requestDelete} disabled={locked} className="rounded-lg border border-[#9b302b] px-4 py-2.5 text-sm font-medium text-[#9b302b] disabled:opacity-50">Delete</button>}
        {target && onComplete && !completed && status !== 'synced' && <button type="button" onClick={markDone} disabled={locked}
          aria-describedby={`${id}-completion-note`} className="rounded-lg border border-[#173b32] px-4 py-2.5 text-sm font-medium disabled:opacity-50">
          {status === 'pending' && action === 'complete' ? 'Marking done…' : 'Mark done'}
        </button>}
        {!readOnly && (!editing || onUpdate) && status !== 'synced' && <button type="submit" disabled={locked} className="rounded-lg bg-[#173b32] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {status === 'pending' && action !== 'complete' ? pendingLabel : editing ? 'Save' : 'Create'}
        </button>}
      </div>
    </form>}
    {!confirmingDelete && extraContent && <div className="mt-6 border-t border-[#dce3db] pt-5">{extraContent}</div>}
  </dialog>;
}
