import { parseAssignmentInput, type Assignment, type AssignmentInput } from './assignments';
import { ContractError, parseOperationId } from './calendar';

export type ImportSource = 'moodle' | 'mystudies';
export type ImportEvent = Readonly<{
  key: string; uid: string; recurrenceId: string | null; title: string; description: string;
  startAt: string; endAt: string; allDay: boolean;
}>;
export type ImportPreview = Readonly<{
  source: ImportSource; previewedAt: string; events: ImportEvent[]; warnings: string[];
  duplicateCount: number; recurrenceWindow: { from: string; to: string };
}>;
export type ImportKind = 'assignment' | 'commitment';
export type ImportCollection = { id: string; source: ImportSource; name: string; revision: number; importedAt: string | null };
export type ImportReviewRow = { event: ImportEvent; change: 'new' | 'changed' | 'unchanged'; previousKind: ImportKind | null;
  assignment: Assignment | null; suggestedInput: AssignmentInput | null };
export type DurableImportPreview = ImportPreview & { id: string; collection: ImportCollection; expiresAt: string; rows: ImportReviewRow[] };
export type ImportSaveSelection = { key: string; kind: 'assignment'; input: AssignmentInput } | { key: string; kind: 'commitment' };
export type ImportSaveRequest = { requestId: string; previewId: string; selections: ImportSaveSelection[] };
export type ImportSaveResult = { requestId: string; previewId: string; collectionId: string; created: number; updated: number; unchanged: number;
  assignments: Assignment[]; commitments: number; savedAt: string };
export type ImportState = { collections: ImportCollection[]; preview: DurableImportPreview | null; result: ImportSaveResult | null };
export type ImportedCommitment = { id: string; title: string; startAt: string; endAt: string; allDay: boolean; source: 'imported'; editable: false };

export class ImportStoreError extends Error {
  constructor(public readonly code: 'not_found' | 'conflict' | 'expired', message: string) { super(message); this.name = 'ImportStoreError'; }
}
export function parseImportSource(value: unknown): ImportSource {
  if (value !== 'moodle' && value !== 'mystudies') throw new ContractError('Choose Moodle or myStudies.');
  return value;
}
export function parseImportCollectionName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) throw new ContractError('Name the import collection (up to 100 characters).');
  return value.trim();
}
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError('Send import details as an object.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) throw new ContractError('Import request contains unsupported fields.');
  return record;
}
export function parseImportSaveRequest(value: unknown): ImportSaveRequest {
  const body = object(value, ['requestId', 'previewId', 'selections']);
  if (!Array.isArray(body.selections) || !body.selections.length || body.selections.length > 500) throw new ContractError('Select between 1 and 500 events.');
  const seen = new Set<string>();
  const selections: ImportSaveSelection[] = body.selections.map(value => {
    const row = object(value, ['key', 'kind', 'input']);
    if (typeof row.key !== 'string' || !/^[a-f0-9]{64}$/.test(row.key) || seen.has(row.key)) throw new ContractError('Select each event once using its preview reference.');
    seen.add(row.key);
    if (row.kind === 'assignment') return { key: row.key, kind: row.kind, input: parseAssignmentInput(row.input) };
    if (row.kind === 'commitment' && row.input === undefined) return { key: row.key, kind: row.kind };
    throw new ContractError('Choose assignment or read-only commitment for each selected event.');
  });
  return { requestId: parseOperationId(body.requestId), previewId: parseOperationId(body.previewId), selections: selections.sort((a, b) => a.key.localeCompare(b.key)) };
}
