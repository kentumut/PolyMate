/** Minimal Google Calendar v3 REST adapter for the student's primary calendar. */

export type GoogleEventTime = { dateTime?: string; date?: string; timeZone?: string };

export type GoogleEvent = {
  id: string;
  etag: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  transparency?: 'opaque' | 'transparent';
  colorId?: string;
  attendees?: { self?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
};

export type GoogleEventWrite = Partial<Omit<GoogleEvent, 'etag' | 'status' | 'attendees'>> & {
  /** Only 'confirmed', to restore an event this owner deleted earlier. */
  status?: 'confirmed';
};

/** Google answered with an error status. The write definitely did not apply (except 5xx). */
export class GoogleApiError extends Error {
  constructor(readonly status: number, readonly reason: string | undefined) {
    super(`Google Calendar returned ${status}${reason ? ` (${reason})` : ''}.`);
    this.name = 'GoogleApiError';
  }
}

/** The request may or may not have reached Google: network failure, timeout, or unreadable reply. */
export class GoogleTransportError extends Error {
  constructor() {
    super('Google Calendar did not answer.');
    this.name = 'GoogleTransportError';
  }
}

/** No usable Google credentials: never connected, revoked, or refresh failed. */
export class GoogleNotConnectedError extends Error {
  constructor() {
    super('Google Calendar must be connected.');
    this.name = 'GoogleNotConnectedError';
  }
}

export type GoogleCalendarApiOptions = {
  accessToken: () => Promise<string>;
  fetcher?: typeof fetch;
  calendarId?: string;
  timeoutMs?: number;
};

const BASE = 'https://www.googleapis.com/calendar/v3';
const MAX_PAGES = 10;

export class GoogleCalendarApi {
  private readonly fetcher: typeof fetch;
  private readonly calendarPath: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: GoogleCalendarApiOptions) {
    this.fetcher = options.fetcher ?? ((...args) => fetch(...args));
    this.calendarPath = `/calendars/${encodeURIComponent(options.calendarId ?? 'primary')}/events`;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Expanded single events overlapping [timeMin, timeMax). */
  async list(timeMin: string, timeMax: string): Promise<GoogleEvent[]> {
    const events: GoogleEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query: Record<string, string> = {
        timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', showDeleted: 'false',
      };
      if (pageToken) query.pageToken = pageToken;
      const body = await this.request<{ items?: GoogleEvent[]; nextPageToken?: string }>('GET', '', { query });
      if (!body || typeof body !== 'object' || (body.items !== undefined && !Array.isArray(body.items)) ||
          (body.nextPageToken !== undefined && typeof body.nextPageToken !== 'string')) throw new GoogleTransportError();
      for (const event of body.items ?? []) assertEvent(event);
      events.push(...(body?.items ?? []));
      pageToken = body?.nextPageToken;
      if (!pageToken) return events;
    }
    throw new GoogleApiError(413, 'tooManyEvents');
  }

  /** Returns null when the event does not exist or, unless asked for, was deleted. */
  async get(id: string, options: { includeCancelled?: boolean } = {}): Promise<GoogleEvent | null> {
    try {
      const event = await this.request<GoogleEvent>('GET', `/${encodeURIComponent(id)}`);
      assertEvent(event);
      return event && (options.includeCancelled || event.status !== 'cancelled') ? event : null;
    } catch (error) {
      if (error instanceof GoogleApiError && (error.status === 404 || error.status === 410)) return null;
      throw error;
    }
  }

  async insert(event: GoogleEventWrite & { id: string }): Promise<GoogleEvent> {
    const result = await this.request<GoogleEvent>('POST', '', { body: event });
    assertEvent(result);
    return result;
  }

  async patch(id: string, changes: GoogleEventWrite, ifMatch: string): Promise<GoogleEvent> {
    const result = await this.request<GoogleEvent>('PATCH', `/${encodeURIComponent(id)}`, { body: changes, ifMatch });
    assertEvent(result);
    return result;
  }

  async delete(id: string, ifMatch: string): Promise<void> {
    await this.request('DELETE', `/${encodeURIComponent(id)}`, { ifMatch, query: { sendUpdates: 'none' } });
  }

  private async request<T>(
    method: string,
    path: string,
    init: { query?: Record<string, string>; body?: unknown; ifMatch?: string } = {},
  ): Promise<T | null> {
    let token: string;
    try {
      token = await this.options.accessToken();
    } catch {
      throw new GoogleNotConnectedError();
    }
    const url = new URL(`${BASE}${this.calendarPath}${path}`);
    if (init.query) url.search = new URLSearchParams(init.query).toString();
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.ifMatch) headers['if-match'] = init.ifMatch;

    let response: Response;
    try {
      response = await this.fetcher(url, {
        method, headers, cache: 'no-store', signal: AbortSignal.timeout(this.timeoutMs),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new GoogleTransportError();
    }
    if (response.status === 204) return null;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (response.ok) throw new GoogleTransportError();
    }
    if (!response.ok) {
      const reason = (body as { error?: { errors?: { reason?: string }[] } } | undefined)?.error?.errors?.[0]?.reason;
      if (response.status === 401 || (response.status === 403 && reason?.startsWith('insufficient'))) {
        throw new GoogleNotConnectedError();
      }
      throw new GoogleApiError(response.status, reason);
    }
    return body as T;
  }
}

function assertEvent(event: unknown): asserts event is GoogleEvent {
  if (!event || typeof event !== 'object') throw new GoogleTransportError();
  const value = event as GoogleEvent;
  if (typeof value.id !== 'string' || !value.id || typeof value.etag !== 'string' || !value.etag) throw new GoogleTransportError();
  if (value.status === 'cancelled') return;
  const time = (value: GoogleEventTime | undefined) => {
    if (value?.dateTime) return Number.isFinite(Date.parse(value.dateTime));
    if (typeof value?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return false;
    const parsed = Date.parse(value.date + 'T00:00:00Z');
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value.date;
  };
  if (!time(value.start) || !time(value.end)) throw new GoogleTransportError();
}
