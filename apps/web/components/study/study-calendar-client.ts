import type { StudyBlockInput, StudyBlockOperationResult } from './study-block-form';

type Mutation = { path: string; method: 'POST' | 'PATCH' | 'DELETE'; body: Record<string, unknown> };
type Operation = { mutation: Mutation; result: StudyBlockOperationResult };

export type StudyCalendarClientOptions = {
  /** Supplied by the backend calendar CSRF endpoint/provider. */
  getCsrfToken: () => string | Promise<string>;
  /** Server-side read/reconciliation; must not blindly repeat a write. */
  reconcileOperation?: (operationId: string) => Promise<StudyBlockOperationResult>;
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
export function createStudyCalendarClient(options: StudyCalendarClientOptions) {
  const fetcher = options.fetcher ?? fetch;
  const newId = options.createOperationId ?? (() => crypto.randomUUID());
  const operations = new Map<string, Operation>();
  const sending = new Set<string>();
  let activeId: string | null = null;
  let lastId: string | null = null;

  function remember(operationId: string, result: StudyBlockOperationResult) {
    const operation = operations.get(operationId)!;
    operation.result = Object.freeze({ ...result, error: result.error ? Object.freeze({ ...result.error }) : undefined });
    if (result.status === 'pending' || result.status === 'unknown') activeId = operationId;
    else if (activeId === operationId) activeId = null;
    return operation.result;
  }

  function blockingOperation() {
    return activeId ? operations.get(activeId)!.result : null;
  }

  function uncertain(operationId: string) {
    return remember(operationId, { operationId, status: 'unknown', error: {
      code: 'calendar_write_uncertain', message: 'Google changes could not be confirmed. Reconcile this operation before trying again.',
    } });
  }

  async function send(operationId: string): Promise<StudyBlockOperationResult> {
    lastId = operationId;
    sending.add(operationId);
    try { return await performSend(operationId); }
    finally { sending.delete(operationId); }
  }

  async function performSend(operationId: string): Promise<StudyBlockOperationResult> {
    const { mutation } = operations.get(operationId)!;
    remember(operationId, { operationId, status: 'pending' });
    let csrfToken: string;
    try {
      csrfToken = await options.getCsrfToken();
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
      // A 2xx or 5xx alone does not prove a Google mutation succeeded/failed.
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
    const last = lastId ? operations.get(lastId) : undefined;
    // A dialog's Retry click calls the same callback again. Preserve the ID for
    // the unchanged failed intent; edited values represent a new intent.
    if (last && last.result.status === 'failed' && JSON.stringify(last.mutation) === JSON.stringify(mutation)) {
      return send(last.result.operationId);
    }
    const operationId = newId();
    operations.set(operationId, { mutation, result: { operationId, status: 'pending' } });
    return send(operationId);
  }

  return {
    onCreate: (input: StudyBlockInput) => mutate({ path: blockPath, method: 'POST', body: values(input) }),
    onUpdate: (eventId: string, input: StudyBlockInput, expectedEtag: string) => mutate({
      path: `${blockPath}/${encodeURIComponent(eventId)}`, method: 'PATCH', body: { ...values(input), expectedEtag },
    }),
    onComplete: (eventId: string, expectedEtag: string) => mutate({
      path: `${blockPath}/${encodeURIComponent(eventId)}/complete`, method: 'POST', body: { expectedEtag },
    }),
    onDelete: (eventId: string, expectedEtag: string) => mutate({
      path: `${blockPath}/${encodeURIComponent(eventId)}`, method: 'DELETE', body: { expectedEtag },
    }),
    getBlockingOperation: blockingOperation,
    getOperation: (operationId: string) => operations.get(operationId)?.result ?? null,
    async reconcile(operationId: string): Promise<StudyBlockOperationResult> {
      const operation = operations.get(operationId);
      if (!operation) throw new Error('Unknown calendar operation.');
      if (sending.has(operationId)) return operation.result;
      if (operation.result.status === 'synced' || operation.result.status === 'failed' || !options.reconcileOperation) return operation.result;
      try {
        const result = await options.reconcileOperation(operationId);
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
      // Explicit retry of the same intended mutation retains its request ID.
      return send(operationId);
    },
  };
}
