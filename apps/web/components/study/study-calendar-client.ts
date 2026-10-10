import type { StudyBlockInput, StudyBlockOperationResult } from './study-block-form';
import type { CalendarClient } from '@polymate/contracts/calendar';

type Mutation = { kind: 'create' | 'update' | 'complete' | 'delete'; eventId?: string; path: string; method: 'POST' | 'PATCH' | 'DELETE'; body: Record<string, unknown> };
type Operation = { mutation: Mutation | null; result: StudyBlockOperationResult };

export type StudyCalendarClientOptions = {
  /** Supplied by the backend calendar CSRF endpoint/provider. */
  getCsrfToken?: () => string | Promise<string>;
  /** Server-side read/reconciliation; must not blindly repeat a write. */
  reconcileOperation?: (operationId: string) => Promise<StudyBlockOperationResult>;
  /** Shared in-memory sample client. Production uses HTTP. */
  calendarClient?: CalendarClient;
  fetcher?: typeof fetch;
  createOperationId?: () => string;
  timeoutMs?: number;
};

const blockPath = '/api/calendar/study-blocks';
const knownRejections = new Set([400, 401, 403, 404, 409, 412, 422]);

function values(input: StudyBlockInput) {
  // Deliberately pick editable values; never forward a caller-supplied owner.
  return { title: input.title, startAt: input.startAt, endAt: input.endAt, timezone: input.timezone };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function operationResult(value: unknown, operationId: string): value is StudyBlockOperationResult {
  return object(value) && value.operationId === operationId
    && ['pending', 'synced', 'failed', 'unknown'].includes(String(value.status))
    && (value.error === undefined || (object(value.error) && typeof value.error.message === 'string'));
}

/** Browser callback adapter for Catalin's decided MVP mutation contract. */
export function createStudyCalendarClient(options: StudyCalendarClientOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const newId = options.createOperationId ?? (() => crypto.randomUUID());
  const operations = new Map<string, Operation>();
  const sending = new Set<string>();
  let csrf: Promise<string> | undefined;

  async function token(): Promise<string> {
    if (options.getCsrfToken) return options.getCsrfToken();
    if (!csrf) {
      csrf = fetcher('/api/calendar/csrf', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
        .then(async response => {
          const body = await response.json();
          if (!response.ok || typeof body.csrfToken !== 'string' || !body.csrfToken) throw new Error('Calendar session unavailable.');
          return body.csrfToken as string;
        });
      csrf.catch(() => { csrf = undefined; });
    }
    return csrf;
  }

  function remember(operationId: string, result: StudyBlockOperationResult) {
    const operation = operations.get(operationId)!;
    operation.result = Object.freeze({ ...result, error: result.error ? Object.freeze({ ...result.error }) : undefined });
    return operation.result;
  }

  function blockingOperation() {
    return [...operations.values()].find(operation => operation.result.status === 'pending' || operation.result.status === 'unknown')?.result ?? null;
  }

  function uncertain(operationId: string) {
    return remember(operationId, { operationId, status: 'unknown', error: {
      code: 'calendar_write_uncertain', message: 'The calendar change could not be confirmed. Reconcile this operation before trying again.',
    } });
  }

  async function send(operationId: string): Promise<StudyBlockOperationResult> {
    sending.add(operationId);
    try { return await performSend(operationId); }
    finally { sending.delete(operationId); }
  }

  async function performSend(operationId: string): Promise<StudyBlockOperationResult> {
    const { mutation } = operations.get(operationId)!;
    if (!mutation) return operations.get(operationId)!.result;
    remember(operationId, { operationId, status: 'pending' });
    if (options.calendarClient) {
      const client = options.calendarClient;
      const { title, startAt, endAt } = mutation.body;
      const input = { title, startAt, endAt } as Omit<StudyBlockInput, 'timezone'>;
      try {
        const result = mutation.kind === 'create' ? await client.createStudyBlock(input, operationId)
          : mutation.kind === 'update' ? await client.updateStudyBlock(mutation.eventId!, input, String(mutation.body.expectedEtag), operationId)
          : mutation.kind === 'complete' ? await client.completeStudyBlock(mutation.eventId!, String(mutation.body.expectedEtag), operationId)
          : await client.deleteStudyBlock(mutation.eventId!, String(mutation.body.expectedEtag), operationId);
        return operationResult(result, operationId) ? remember(operationId, result) : uncertain(operationId);
      } catch { return uncertain(operationId); }
    }
    let csrfToken: string;
    try {
      csrfToken = await token();
      if (!csrfToken.trim()) throw new Error('Missing CSRF token');
    } catch {
      // This is a known failure before a write was attempted.
      return remember(operationId, { operationId, status: 'failed', error: {
        code: 'csrf_unavailable', message: 'Calendar authorization is unavailable. Refresh your session before trying again.', recoverable: true,
      } });
    }

    try {
      const response = await fetcher(mutation.path, {
        method: mutation.method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ ...mutation.body, operationId }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
      });
      let body: unknown;
      try { body = await response.json(); } catch { return uncertain(operationId); }
      if (object(body) && object(body.error) && body.error.code === 'csrf') csrf = undefined;
      if (operationResult(body, operationId) && (response.ok || body.status === 'failed')) {
        return remember(operationId, body);
      }
      if (!response.ok && knownRejections.has(response.status) && object(body) && object(body.error) && typeof body.error.message === 'string') {
        return remember(operationId, { operationId, status: 'failed', error: {
          message: body.error.message,
          code: typeof body.error.code === 'string' ? body.error.code : `http_${response.status}`,
          recoverable: body.error.recoverable === true,
        } });
      }
      // A 2xx or 5xx alone does not prove that a calendar mutation succeeded or failed.
      return uncertain(operationId);
    } catch {
      return uncertain(operationId);
    }
  }

  function mutate(mutation: Mutation): Promise<StudyBlockOperationResult> {
    const blocking = blockingOperation();
    // The parent keeps this client alive across dialog openings. An outstanding
    // operation prevents another intent from silently bypassing reconciliation.
    if (blocking) return Promise.resolve(blocking);
    // A confirmed failure is terminal in the durable service. A retry is a new
    // attempt; only pending/unknown outcomes retain their original operation ID.
    const operationId = newId();
    operations.set(operationId, { mutation, result: { operationId, status: 'pending' } });
    return send(operationId);
  }

  return {
    onCreate: (input: StudyBlockInput) => mutate({ kind: 'create', path: blockPath, method: 'POST', body: values(input) }),
    onUpdate: (eventId: string, input: StudyBlockInput, expectedEtag: string) => mutate({
      kind: 'update', eventId, path: `${blockPath}/${encodeURIComponent(eventId)}`, method: 'PATCH', body: { ...values(input), expectedEtag },
    }),
    onComplete: (eventId: string, expectedEtag: string) => mutate({
      kind: 'complete', eventId, path: `${blockPath}/${encodeURIComponent(eventId)}/complete`, method: 'POST', body: { expectedEtag },
    }),
    onDelete: (eventId: string, expectedEtag: string) => mutate({
      kind: 'delete', eventId, path: `${blockPath}/${encodeURIComponent(eventId)}`, method: 'DELETE', body: { expectedEtag },
    }),
    getBlockingOperation: blockingOperation,
    getOperation: (operationId: string) => operations.get(operationId)?.result ?? null,
    async loadUnresolved(): Promise<StudyBlockOperationResult[]> {
      if (options.calendarClient) return [];
      const response = await fetcher('/api/calendar/operations', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      const body: unknown = await response.json();
      if (!response.ok || !object(body) || !Array.isArray(body.operations)
        || !body.operations.every(result => object(result) && typeof result.operationId === 'string'
          && operationResult(result, result.operationId) && (result.status === 'pending' || result.status === 'unknown'))) {
        throw new Error('Pending calendar changes could not be checked. Retry before making another change.');
      }
      for (const result of body.operations as StudyBlockOperationResult[]) {
        if (!operations.has(result.operationId)) operations.set(result.operationId, { mutation: null, result });
      }
      return body.operations as StudyBlockOperationResult[];
    },
    async reconcile(operationId: string): Promise<StudyBlockOperationResult> {
      const operation = operations.get(operationId);
      if (!operation) throw new Error('Unknown calendar operation.');
      if (sending.has(operationId)) return operation.result;
      if (operation.result.status === 'synced' || operation.result.status === 'failed') return operation.result;
      try {
        if (options.calendarClient) return send(operationId);
        const result: unknown = options.reconcileOperation ? await options.reconcileOperation(operationId)
          : await fetcher(`/api/calendar/operations/${encodeURIComponent(operationId)}/reconcile`, {
            method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
            headers: { 'x-csrf-token': await token() }, signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
          }).then(async response => {
            const body = await response.json();
            if (object(body) && object(body.error) && body.error.code === 'csrf') csrf = undefined;
            return body;
          });
        return operationResult(result, operationId) ? remember(operationId, result) : uncertain(operationId);
      } catch {
        // Preserve the last known pending/unknown state on a failed status read.
        return operation.result;
      }
    },
    async retryFailed(operationId: string): Promise<StudyBlockOperationResult> {
      const operation = operations.get(operationId);
      if (!operation) throw new Error('Unknown calendar operation.');
      const blocking = blockingOperation();
      if (blocking) return blocking;
      if (operation.result.status !== 'failed') return operation.result;
      return operation.mutation ? mutate(operation.mutation) : operation.result;
    },
  };
}
