import { describe, expect, it, vi } from 'vitest';
import { GoogleCalendarApi, GoogleTransportError } from '../packages/core/calendar/google-api';
import { HttpCalendarClient } from '../packages/contracts/src/http-client';

const event = { id: 'event', etag: '"version"', start: { dateTime: '2026-10-12T10:00:00Z' }, end: { dateTime: '2026-10-12T10:50:00Z' } };

describe('Google Calendar REST adapter', () => {
  it('paginates commitments and expands recurrence before checking availability', async () => {
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      expect(url.searchParams.get('singleEvents')).toBe('true');
      expect(url.searchParams.get('showDeleted')).toBe('false');
      return url.searchParams.get('pageToken') === 'next'
        ? Response.json({ items: [{ ...event, id: 'second' }] }) : Response.json({ items: [event], nextPageToken: 'next' });
    });
    const api = new GoogleCalendarApi({ accessToken: async () => 'token', fetcher });
    expect(await api.list(event.start.dateTime, event.end.dateTime)).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed availability responses instead of treating them as free time', async () => {
    for (const body of [null, { items: 'invalid' }, { items: [{ ...event, start: {} }] }, { items: [{ ...event, etag: undefined }] }]) {
      const api = new GoogleCalendarApi({ accessToken: async () => 'token', fetcher: async () => Response.json(body) });
      await expect(api.list(event.start.dateTime, event.end.dateTime)).rejects.toBeInstanceOf(GoogleTransportError);
    }
  });

  it('preserves If-Match and marks malformed successful writes uncertain', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect((init?.headers as Record<string, string>)['if-match']).toBe(event.etag);
      return Response.json({ id: event.id });
    });
    const api = new GoogleCalendarApi({ accessToken: async () => 'token', fetcher });
    await expect(api.patch(event.id, { summary: 'Changed' }, event.etag)).rejects.toBeInstanceOf(GoogleTransportError);
  });
});

describe('HTTP calendar client', () => {
  it('does not report failure when a successful write reply is unreadable', async () => {
    const operationId = '00000000-0000-4000-8000-000000000001';
    const client = new HttpCalendarClient('/api/calendar', async input => String(input).endsWith('/csrf')
      ? Response.json({ csrfToken: 'nonce' }) : new Response('invalid json', { status: 200 }));
    expect(await client.createStudyBlock({ title: 'Sheet', startAt: event.start.dateTime, endAt: event.end.dateTime }, operationId))
      .toMatchObject({ operationId, status: 'unknown' });
  });
});
