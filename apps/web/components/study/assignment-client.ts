import { parseAssignment, parseAssignmentCreateRequest, parseAssignmentInput, type Assignment, type AssignmentInput } from '@polymate/contracts/assignments';

export class AssignmentSaveError extends Error {
  constructor(message: string, readonly kind: 'failed' | 'unknown', readonly code = 'assignment_unavailable') {
    super(message); this.name = 'AssignmentSaveError';
  }
}

type PendingSave = Readonly<{ input: AssignmentInput; clientRequestId: string; status: 'saving' | 'unknown' }>;
type Options = { fetcher?: typeof fetch; createRequestId?: () => string; getCsrfToken?: () => Promise<string> | string };

export type AssignmentClient = ReturnType<typeof createAssignmentClient>;

/** Local DB save: an uncertain reply can be retried with the exact request UUID. */
export function createAssignmentClient(options: Options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const requestId = options.createRequestId ?? (() => crypto.randomUUID());
  let pending: PendingSave | null = null;
  let inFlight: Promise<Assignment> | null = null;
  let csrf: Promise<string> | undefined;

  async function token() {
    if (options.getCsrfToken) return options.getCsrfToken();
    if (!csrf) {
      csrf = fetcher('/api/assignments/csrf', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
        .then(async response => {
          const body = await response.json();
          if (!response.ok || typeof body.csrfToken !== 'string' || !body.csrfToken) throw new Error('Session unavailable.');
          return body.csrfToken as string;
        });
      csrf.catch(() => { csrf = undefined; });
    }
    return csrf;
  }

  async function save(attempt: PendingSave): Promise<Assignment> {
    let csrfToken: string;
    try {
      csrfToken = await token();
      if (!csrfToken.trim()) throw new Error('Missing token');
    } catch {
      // An earlier uncertain request must stay uncertain even if this retry's token lookup fails.
      if (attempt.status === 'unknown') throw new AssignmentSaveError('Refresh your session, then retry the same assignment save.', 'unknown', 'csrf');
      pending = null;
      throw new AssignmentSaveError('Your session is unavailable. Retry to refresh it.', 'failed', 'csrf');
    }
    try {
      const response = await fetcher('/api/assignments', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ ...attempt.input, clientRequestId: attempt.clientRequestId }),
      });
      const body = await response.json() as { assignment?: unknown; error?: { code?: string; message?: string } };
      if (response.ok) {
        const assignment = parseAssignment(body.assignment);
        pending = null;
        return assignment;
      }
      if (body.error?.code === 'csrf') csrf = undefined;
      if ([400, 401, 403, 404, 409, 422].includes(response.status)) {
        if (attempt.status === 'unknown' && body.error?.code !== 'request_conflict') {
          throw new AssignmentSaveError(body.error?.message ?? 'Refresh your session and retry the original save.', 'unknown', body.error?.code);
        }
        pending = null;
        throw new AssignmentSaveError(body.error?.message ?? 'The assignment could not be saved.', 'failed', body.error?.code);
      }
      throw new Error('Unconfirmed response');
    } catch (error) {
      if (error instanceof AssignmentSaveError && error.kind === 'failed') throw error;
      pending = { ...attempt, status: 'unknown' };
      if (error instanceof AssignmentSaveError) throw error;
      throw new AssignmentSaveError('We could not confirm the save. Retry checks the same request without creating a duplicate.', 'unknown');
    }
  }

  return {
    getPendingSave: () => pending,
    async listAssignments(): Promise<Assignment[]> {
      const response = await fetcher('/api/assignments', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) });
      const body = await response.json() as { assignments?: unknown; error?: { message?: string } };
      if (!response.ok || !Array.isArray(body.assignments)) throw new Error(body.error?.message ?? 'Assignments could not be loaded. Please retry.');
      return body.assignments.map(parseAssignment);
    },
    createAssignment(value: AssignmentInput): Promise<Assignment> {
      const input = parseAssignmentInput(value);
      if (pending && JSON.stringify(input) !== JSON.stringify(pending.input)) {
        return Promise.reject(new AssignmentSaveError('Confirm the outstanding assignment save before starting a different one.', 'unknown'));
      }
      if (inFlight) return inFlight;
      const attempt = pending ?? { input, clientRequestId: requestId(), status: 'saving' as const };
      pending = attempt;
      inFlight = save(attempt).finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

export type AssignmentFixtureOutcome = 'success' | 'failure' | 'unknown' | 'slow';

/** Uses the same HTTP adapter but only a labelled in-memory fixture transport. */
export function createSampleAssignmentClient() {
  const entries = new Map<string, { input: AssignmentInput; assignment: Assignment }>();
  let outcome: AssignmentFixtureOutcome = 'success';
  const fetcher: typeof fetch = async (path, init) => {
    await new Promise(resolve => setTimeout(resolve, outcome === 'slow' ? 1500 : 200));
    if (String(path).endsWith('/csrf')) return Response.json({ csrfToken: 'assignment-fixture-token' });
    if ((init?.method ?? 'GET') === 'GET') return Response.json({ assignments: [...entries.values()].map(entry => entry.assignment) });
    const { clientRequestId, ...input } = parseAssignmentCreateRequest(JSON.parse(init!.body as string));
    const existing = entries.get(clientRequestId);
    if (existing) return JSON.stringify(existing.input) === JSON.stringify(input)
      ? Response.json({ assignment: existing.assignment })
      : Response.json({ error: { code: 'request_conflict', message: 'Fixture request details changed.' } }, { status: 409 });
    if (outcome === 'failure') return Response.json({ error: { code: 'validation', message: 'Simulated save failure. Your values have been kept.' } }, { status: 422 });
    const assignment: Assignment = { ...input, id: crypto.randomUUID(), remainingMinutes: input.estimatedMinutes, status: 'open', version: 1 };
    entries.set(clientRequestId, { input, assignment });
    if (outcome === 'unknown') throw new Error('Simulated lost reply after the fixture save.');
    return Response.json({ assignment }, { status: 201 });
  };
  return { ...createAssignmentClient({ fetcher }), setOutcome: (next: AssignmentFixtureOutcome) => { outcome = next; },
    applySampleProgress: (assignment: Assignment) => {
      for (const entry of entries.values()) if (entry.assignment.id === assignment.id) { entry.assignment = assignment; return; }
      throw new Error('Sample assignment not found.');
    } };
}
