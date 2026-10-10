'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Assignment, AssignmentInput } from '@polymate/contracts/assignments';
import { initialAssignmentFields, validateAssignmentFields, type AssignmentErrors, type AssignmentFields } from './assignment-form';
import { AssignmentSaveError } from './assignment-client';

export type AssignmentDialogProps = {
  open: boolean;
  initialInput?: AssignmentInput;
  onClose: () => void;
  onCreateAssignment: (input: AssignmentInput) => Promise<Assignment>;
  fixtureMode?: boolean;
};

export function AssignmentDialog(props: AssignmentDialogProps) {
  return props.open ? <AssignmentDialogForm {...props} /> : null;
}

function AssignmentDialogForm({ initialInput, onClose, onCreateAssignment, fixtureMode = false }: AssignmentDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const [fields, setFields] = useState(() => initialAssignmentFields(initialInput));
  const [errors, setErrors] = useState<AssignmentErrors>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'unknown'>(initialInput ? 'unknown' : 'idle');
  const [message, setMessage] = useState(initialInput ? 'Retry the outstanding save before starting a new assignment.' : '');
  const frozen = ['saving', 'saved', 'unknown'].includes(status);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);

  function change(field: keyof AssignmentFields, value: string) {
    setFields({ ...fields, [field]: value }); setErrors({}); setStatus('idle'); setMessage('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || status === 'saved') return;
    const result = validateAssignmentFields(fields);
    if (!result.input) {
      setErrors(result.errors);
      const invalid = formRef.current?.elements.namedItem(Object.keys(result.errors)[0]);
      if (invalid instanceof HTMLElement) invalid.focus();
      return;
    }
    inFlight.current = true; setStatus('saving'); setMessage('Saving assignment…');
    try {
      await onCreateAssignment(result.input);
      setStatus('saved'); setMessage(fixtureMode ? 'Sample assignment saved. No database record was created.' : 'Assignment saved.');
    } catch (error) {
      setStatus(error instanceof AssignmentSaveError && error.kind === 'failed' ? 'failed' : 'unknown');
      setMessage(error instanceof AssignmentSaveError ? error.message : 'We could not confirm the save. Retry the same request.');
    } finally { inFlight.current = false; }
  }

  const field = (name: keyof AssignmentFields, label: string, type: string) => <div>
    <label htmlFor={`${id}-${name}`} className="text-sm font-medium">{label}</label>
    <input id={`${id}-${name}`} name={name} type={type} value={fields[name]} required disabled={frozen}
      min={name === 'estimatedMinutes' ? 1 : undefined} step={name === 'estimatedMinutes' ? 1 : undefined}
      onChange={event => change(name, event.target.value)} aria-invalid={Boolean(errors[name])}
      aria-describedby={errors[name] ? `${id}-${name}-error` : undefined}
      className="mt-2 w-full rounded-md border bg-background px-3 py-2.5 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring disabled:bg-muted" />
    {errors[name] && <p id={`${id}-${name}-error`} className="mt-2 text-sm text-destructive">{errors[name]}</p>}
  </div>;

  return <dialog ref={dialogRef} aria-labelledby={`${id}-heading`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); if (!inFlight.current) onClose(); }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-xl backdrop:bg-black/35">
    <h2 id={`${id}-heading`} className="text-2xl font-semibold">Add assignment</h2>
    <p id={`${id}-description`} className="mt-2 text-sm leading-6 text-muted-foreground">Choose the deadline in Europe/Zurich and estimate the total study effort. Saving does not schedule calendar blocks.</p>
    {fixtureMode && <p className="mt-3 rounded-lg bg-muted p-3 text-sm text-muted-foreground">Sample data — changes reset after reload.</p>}
    <form ref={formRef} noValidate onSubmit={submit} className="mt-6 space-y-5">
      {field('title', 'Assignment title', 'text')}
      <div className="grid gap-4 sm:grid-cols-2">{field('date', 'Deadline date', 'date')}{field('time', 'Deadline time', 'time')}</div>
      {field('estimatedMinutes', 'Estimated effort — minutes', 'number')}
      <div role="status" aria-live="polite" aria-atomic="true">{message && <p className={`rounded-lg border p-3 text-sm ${status === 'failed' ? 'border-destructive/40 text-destructive' : 'border-border'}`}>
        {status === 'unknown' && <strong>Unconfirmed: </strong>}{message}
      </p>}</div>
      <div className="flex justify-end gap-3 border-t pt-4">
        <button type="button" disabled={status === 'saving'} onClick={() => { if (!inFlight.current) onClose(); }} className="rounded-md border bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50">{status === 'saved' || status === 'unknown' ? 'Close' : 'Cancel'}</button>
        {status !== 'saved' && <button type="submit" disabled={status === 'saving'} className="rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">{status === 'saving' ? 'Saving…' : status === 'unknown' ? 'Retry save' : 'Save assignment'}</button>}
      </div>
    </form>
  </dialog>;
}
