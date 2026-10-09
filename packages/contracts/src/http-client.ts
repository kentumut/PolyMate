import type {
  CalendarClient, CalendarEvent, ListEventsResponse, OperationErrorCode, OperationResult, StudyBlockChanges, StudyBlockInput,
} from './calendar';
import type { DateRange } from './time';

export class CalendarRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = 'CalendarRequestError';
  }
}

/** Route errors use the operation codes plus transport codes such as `csrf` and `identity`. */
type ErrorBody = { error?: { code?: string; message?: string } };

/** Browser CalendarClient for the authenticated same-origin `/api/calendar` routes. */
export class HttpCalendarClient implements CalendarClient {
  private csrfToken: Promise<string> | undefined;

  constructor(private readonly baseUrl = '/api/calendar', private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  async listWeek(range: DateRange): Promise<CalendarEvent[]> {
    const query = new URLSearchParams({ from: range.from, to: range.to });
    const response = await this.fetcher(`${this.baseUrl}/events?${query}`, { cache: 'no-store' });
    const body = await response.json().catch(() => ({})) as Partial<Omit<ListEventsResponse, 'error'>> & ErrorBody;
    if (!response.ok || !Array.isArray(body.events)) {
      throw new CalendarRequestError(body.error?.message ?? 'Calendar could not be loaded.', body.error?.code ?? 'unknown', response.status);
    }
    return body.events;
  }

  createStudyBlock(block: StudyBlockInput, operationId: string): Promise<OperationResult> {
    return this.mutate('POST', '/events', operationId, { operationId, block });
  }

  updateStudyBlock(id: string, changes: StudyBlockChanges, expectedEtag: string, operationId: string): Promise<OperationResult> {
    return this.mutate('PATCH', `/events/${encodeURIComponent(id)}`, operationId, { operationId, expectedEtag, changes });
  }

  completeStudyBlock(id: string, expectedEtag: string, operationId: string): Promise<OperationResult> {
    return this.mutate('POST', `/events/${encodeURIComponent(id)}/complete`, operationId, { operationId, expectedEtag });
  }

  deleteStudyBlock(id: string, expectedEtag: string, operationId: string): Promise<OperationResult> {
    return this.mutate('DELETE', `/events/${encodeURIComponent(id)}`, operationId, { operationId, expectedEtag });
  }

  private token(refresh = false): Promise<string> {
    if (refresh || !this.csrfToken) {
      this.csrfToken = this.fetcher(`${this.baseUrl}/csrf`, { cache: 'no-store' })
        .then(async response => {
          const body = await response.json() as { csrfToken?: string };
          if (!response.ok || !body.csrfToken) throw new Error('Calendar session is unavailable.');
          return body.csrfToken;
        });
      this.csrfToken.catch(() => { this.csrfToken = undefined; });
    }
    return this.csrfToken;
  }

  private async mutate(method: string, path: string, operationId: string, body: unknown, retried = false): Promise<OperationResult> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, {
        method, cache: 'no-store', body: JSON.stringify(body),
        headers: { 'content-type': 'application/json', 'x-csrf-token': await this.token(retried) },
      });
    } catch {
      // The request may have reached the server. Report uncertainty; a retry with this operationId reconciles.
      return { operationId, status: 'unknown', error: { code: 'unknown', message: 'Connection lost before PolyMate confirmed the change. Retry to check.' } };
    }
    const parsed = await response.json().catch(() => ({})) as Omit<Partial<OperationResult>, 'error'> & ErrorBody;
    if (response.status === 403 && parsed.error?.code === 'csrf' && !retried) {
      return this.mutate(method, path, operationId, body, true);
    }
    if (parsed.operationId === operationId && parsed.status) return parsed as OperationResult;
    return {
      operationId,
      status: response.status >= 500 ? 'unknown' : 'failed',
      error: { code: (parsed.error?.code ?? 'unknown') as OperationErrorCode, message: parsed.error?.message ?? 'Calendar request failed.' },
    };
  }
}
