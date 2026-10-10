import { parseLinkRequest, parseProgressRequest, progressSignature, type LinkRequest, type ProgressReceipt, type ProgressRequest, type StudyProgressState, type BlockAssignmentLink } from '@polymate/contracts/study-progress';
import type { StudyProgressService } from '@polymate/core/progress';
import { parseAssignment } from '@polymate/contracts/assignments';
import { parseOperationId } from '@polymate/contracts/calendar';

export class ProgressSaveError extends Error {
  constructor(message: string, readonly kind: 'failed' | 'unknown', readonly code = 'unknown') { super(message); this.name = 'ProgressSaveError'; }
}
export function createProgressClient(options: { fetcher?: typeof fetch; service?: StudyProgressService; createRequestId?: () => string } = {}) {
  const fetcher = options.fetcher ?? fetch;
  let csrf: Promise<string> | undefined;
  let pending: ProgressRequest | null = null;
  let inFlight: Promise<ProgressReceipt> | null = null;
  let uncertain = false;
  let completionOnly = false;
  function recoverCompletions(state: StudyProgressState) {
    if (completionOnly && pending && !state.pendingCompletions.some(item => item.clientRequestId === pending!.clientRequestId)
      && state.reports.some(item => item.clientRequestId === pending!.clientRequestId)) {
      pending = null; uncertain = false; completionOnly = false;
    }
    if (!pending && state.pendingCompletions.length) {
      pending = parseProgressRequest(state.pendingCompletions[0]); uncertain = true; completionOnly = true;
    }
  }
  async function token() {
    if (!csrf) {
      csrf = fetcher('/api/study-progress/csrf', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' }).then(async response => {
        const body = await response.json();
        if (!response.ok || typeof body.csrfToken !== 'string' || !body.csrfToken) throw new ProgressSaveError('Progress session unavailable. Refresh and retry.', 'failed', 'csrf');
        return body.csrfToken as string;
      });
      csrf.catch(() => { csrf = undefined; });
    }
    return csrf;
  }
  async function post(path: string, value: unknown) {
    let csrfToken: string;
    try { csrfToken = await token(); }
    catch { throw new ProgressSaveError('Progress session unavailable. Refresh and retry.', 'failed', 'csrf'); }
    const response = await fetcher(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(value), signal: AbortSignal.timeout(15000) });
    const body = await response.json();
    if (!response.ok) {
      csrf = undefined;
      throw new ProgressSaveError(body.error?.message ?? 'Progress could not be confirmed.', response.status < 500 ? 'failed' : 'unknown', body.error?.code);
    }
    return body;
  }
  async function save(request: ProgressRequest): Promise<ProgressReceipt> {
    try {
      const receipt: ProgressReceipt = options.service ? await options.service.record(request) : (await post('/api/study-progress/reports', request)).receipt;
      if (!receipt?.report || receipt.report.clientRequestId !== request.clientRequestId || receipt.report.eventId !== request.eventId
        || receipt.report.assignmentId !== request.assignmentId || receipt.report.action !== request.action || receipt.report.sessionRevision !== request.expectedSessionRevision
        || parseOperationId(receipt.report.id) !== receipt.report.id || parseAssignment(receipt.assignment).id !== request.assignmentId
        || receipt.assignment.version !== request.expectedAssignmentVersion + 1) throw new Error('Unconfirmed report response.');
      const unconfirmed = receipt.calendarOperation?.status === 'unknown' || receipt.calendarOperation?.status === 'pending';
      pending = unconfirmed ? request : null; uncertain = unconfirmed; completionOnly = unconfirmed; return receipt;
    } catch (error) {
      if (error instanceof ProgressSaveError && error.kind === 'failed' && (!uncertain || error.code === 'version_conflict')) { pending = null; uncertain = false; throw error; }
      if (options.service && error instanceof Error && 'code' in error) { pending = null; throw new ProgressSaveError(error.message, 'failed', String(error.code)); }
      uncertain = true;
      throw new ProgressSaveError(error instanceof Error ? error.message : 'Progress save unconfirmed. Retry the same report.', 'unknown');
    } finally { inFlight = null; }
  }
  return {
    getPendingReport: () => pending,
    async state(): Promise<StudyProgressState> {
      if (options.service) {
        const state = await options.service.state();
        recoverCompletions(state);
        return state;
      }
      const response = await fetcher('/api/study-progress', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.assignments) || !Array.isArray(body.links) || !Array.isArray(body.reports) || !Array.isArray(body.pendingCompletions)) throw new Error('Assignment links and progress could not be loaded. Apply the migration and retry.');
      recoverCompletions(body);
      return body;
    },
    async link(value: LinkRequest): Promise<BlockAssignmentLink> {
      const request = parseLinkRequest(value);
      return options.service ? options.service.link(request) : (await post('/api/study-progress/links', request)).link;
    },
    record(value: Omit<ProgressRequest, 'clientRequestId'>): Promise<ProgressReceipt> {
      let request: ProgressRequest;
      try { request = parseProgressRequest({ ...value, clientRequestId: pending?.clientRequestId ?? options.createRequestId?.() ?? crypto.randomUUID() }); }
      catch (error) { return Promise.reject(new ProgressSaveError(error instanceof Error ? error.message : 'Check your progress report.', 'failed', 'validation')); }
      if (pending && progressSignature(pending) !== progressSignature(request)) return Promise.reject(new ProgressSaveError('Confirm the outstanding report before changing its values.', 'unknown'));
      if (inFlight) return inFlight;
      pending = request; inFlight = save(request); return inFlight;
    },
    retry(): Promise<ProgressReceipt> {
      if (!pending) return Promise.reject(new ProgressSaveError('No unconfirmed report.', 'failed'));
      if (inFlight) return inFlight;
      inFlight = save(pending); return inFlight;
    },
  };
}
