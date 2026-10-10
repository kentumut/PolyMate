import type { AssignmentInput } from '@polymate/contracts/assignments';
import { parseAssignment } from '@polymate/contracts/assignments';
import { parseInstant, parseOperationId } from '@polymate/contracts/calendar';
import { parseImportSaveRequest, type DurableImportPreview, type ImportSaveRequest, type ImportSaveResult, type ImportState } from '@polymate/contracts/imports';
import type { ImportEvent, ImportPreview, ImportSource } from '@polymate/core/calendar/import';
import { initialAssignmentFields, validateAssignmentFields, type AssignmentFields } from './assignment-form';

export const MAX_IMPORT_BYTES = 1_000_000;
export type ImportSelection = { event: ImportEvent; input: AssignmentInput };
export type ImportConfirmation = { requestId: string; source: ImportSource; selections: ImportSelection[] };
export type ImportOutcome = 'success' | 'failure' | 'conflict' | 'unknown' | 'slow';
export type ImportResult = { requestId: string; created: number; updated: number; unchanged: number; fixture: true };
export class ImportConfirmationError extends Error {
  constructor(message: string, public readonly kind: 'failure' | 'conflict' | 'unknown') { super(message); this.name = 'ImportConfirmationError'; }
}

export function validateImportFile(file: { name: string; size: number }) {
  if (!/\.ics$/i.test(file.name)) throw new Error('Choose a .ics calendar export from Moodle or myStudies.');
  if (!file.size) throw new Error('This file is empty. Export the calendar again.');
  if (file.size > MAX_IMPORT_BYTES) throw new Error('Choose an ICS file smaller than 1 MB.');
}
export function importAssignmentFields(event: ImportEvent): AssignmentFields {
  const fields = initialAssignmentFields({ title: event.title, dueAt: event.startAt, estimatedMinutes: 1 });
  return { ...fields, time: event.allDay ? '' : fields.time, estimatedMinutes: '' };
}
export function prepareImportSelections(events: ImportEvent[], selected: ReadonlySet<string>, fields: Record<string, AssignmentFields>) {
  const selections: ImportSelection[] = [];
  const errors: Record<string, string> = {};
  for (const event of events) {
    if (!selected.has(event.key)) continue;
    const checked = validateAssignmentFields(fields[event.key] ?? importAssignmentFields(event));
    if (checked.errors) errors[event.key] = Object.values(checked.errors).join(' ');
    else selections.push({ event, input: checked.input });
  }
  return { selections, errors };
}

/** Only parsing uses HTTP. Confirmation is deliberately a separate integration adapter. */
export async function previewImport(file: File, source: ImportSource, signal?: AbortSignal, target: { collectionId?: string; name?: string; fixture?: boolean } = {}): Promise<ImportPreview> {
  validateImportFile(file);
  const csrf = await fetch('/api/assignments/csrf', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
  const token = await csrf.json();
  if (!csrf.ok || typeof token.csrfToken !== 'string') throw new Error('Import session unavailable. Please retry.');
  const query = new URLSearchParams({ source });
  if (target.collectionId) query.set('collectionId', target.collectionId);
  else if (target.name) query.set('name', target.name);
  if (target.fixture) query.set('fixture', 'true');
  const response = await fetch(`/api/assignments/import/preview?${query}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    headers: { 'Content-Type': 'text/calendar', 'x-csrf-token': token.csrfToken }, body: file });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? 'The calendar could not be previewed.');
  return body as ImportPreview;
}

export function createPersistentImportClient(fetcher: typeof fetch = fetch) {
  let inFlight = false;
  return {
    async state(collectionId?: string, previewId?: string): Promise<ImportState> {
      const query = previewId ? `?previewId=${encodeURIComponent(previewId)}` : collectionId ? `?collectionId=${encodeURIComponent(collectionId)}` : '';
      const response = await fetcher(`/api/assignments/import${query}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.collections)) throw new Error(body.error?.message ?? 'Imports could not be loaded. Check the database migration and retry.');
      return body as ImportState;
    },
    async preview(file: File, source: ImportSource, target: { collectionId?: string; name?: string }): Promise<DurableImportPreview> {
      const parsed = await previewImport(file, source, AbortSignal.timeout(30000), target) as DurableImportPreview;
      if (!parsed.id || !parsed.collection || !Array.isArray(parsed.rows)) throw new Error('The stored preview could not be confirmed. Reload imports.');
      return parsed;
    },
    async confirm(value: ImportSaveRequest): Promise<ImportSaveResult> {
      if (inFlight) throw new ImportConfirmationError('An import confirmation is already running.', 'failure');
      const request = parseImportSaveRequest(value);
      inFlight = true; let sent = false;
      try {
        const csrf = await fetcher('/api/assignments/csrf', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
        const token = await csrf.json();
        if (!csrf.ok || typeof token.csrfToken !== 'string') throw new ImportConfirmationError('Your import session expired. Please retry.', 'failure');
        sent = true;
        const response = await fetcher('/api/assignments/import/confirm', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': token.csrfToken }, body: JSON.stringify(request) });
        const body = await response.json();
        if (!response.ok) throw new ImportConfirmationError(body.error?.message ?? 'Import confirmation could not be completed.', response.status >= 500 ? 'unknown' : response.status === 409 ? 'conflict' : 'failure');
        if (body.requestId !== request.requestId || body.previewId !== request.previewId || parseOperationId(body.collectionId) !== body.collectionId || !Array.isArray(body.assignments)
          || !['created','updated','unchanged','commitments'].every(key => Number.isInteger(body[key]) && body[key] >= 0)
          || body.created + body.updated + body.unchanged !== request.selections.length
          || body.assignments.length + body.commitments !== request.selections.length) throw new Error('The import result could not be confirmed.');
        parseInstant(body.savedAt, 'savedAt');
        body.assignments = body.assignments.map(parseAssignment);
        return body as ImportSaveResult;
      } catch (error) {
        if (error instanceof ImportConfirmationError) throw error;
        throw new ImportConfirmationError(error instanceof Error ? error.message : 'Import response lost. Retry the same request.', sent ? 'unknown' : 'failure');
      } finally { inFlight = false; }
    },
  };
}

/** Per-component fixture memory: never calls assignment, calendar or confirmation APIs. */
export function createImportFixtureAdapter() {
  const records = new Map<string, string>();
  const receipts = new Map<string, { signature: string; result: ImportResult }>();
  let inFlight = false;
  return {
    async confirm(request: ImportConfirmation, outcome: ImportOutcome): Promise<ImportResult> {
      if (inFlight) throw new ImportConfirmationError('A fixture confirmation is already running.', 'failure');
      inFlight = true;
      try {
        const signature = JSON.stringify(request);
        const prior = receipts.get(request.requestId);
        if (prior) {
          if (prior.signature !== signature) throw new ImportConfirmationError('This request changed. Retry the original selection.', 'conflict');
          return prior.result;
        }
        if (outcome === 'slow') await new Promise(resolve => setTimeout(resolve, 1200));
        if (outcome === 'failure') throw new ImportConfirmationError('Simulated save failure. Your selection and edits are preserved; retry when ready.', 'failure');
        if (outcome === 'conflict') throw new ImportConfirmationError('Simulated source conflict. Review the selection and revise it before confirming again.', 'conflict');
        const result: ImportResult = { requestId: request.requestId, created: 0, updated: 0, unchanged: 0, fixture: true };
        for (const { event, input } of request.selections) {
          const identity = JSON.stringify([request.source, event.uid, event.recurrenceId]);
          const content = JSON.stringify(input);
          const previous = records.get(identity);
          if (previous === content) result.unchanged++;
          else if (previous === undefined) result.created++;
          else result.updated++;
          records.set(identity, content);
        }
        receipts.set(request.requestId, { signature, result });
        if (outcome === 'unknown') throw new ImportConfirmationError('Simulated lost reply. Retry the same frozen selection to recover its result.', 'unknown');
        return result;
      } finally { inFlight = false; }
    },
  };
}
