'use client';

import { useState } from 'react';
import type { MoodleSnapshot } from '@polymate/contracts/moodle';

export const formatMoodleDate = (value: string, allDay = false) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Zurich', dateStyle: 'medium', ...(allDay ? {} : { timeStyle: 'short' as const }),
}).format(new Date(value));

export function MoodleCalendarPreview({ snapshot }: { snapshot: MoodleSnapshot }) {
  const [expanded, setExpanded] = useState(false);
  const events = snapshot.calendarEvents ?? [];
  const visible = expanded ? events : events.slice(0, 8);
  return <div className="mt-4 space-y-3" aria-label="Moodle calendar events">
    <p className="text-xs text-[#617269]">{events.length} events · Updated {formatMoodleDate(snapshot.fetchedAt)} · Europe/Zurich</p>
    {events.length ? <ul className="space-y-2">{visible.map(event => <li key={event.id} className="rounded-xl bg-[#f5f8f2] p-3 text-sm">
      <p className="text-xs text-[#617269]">{event.courseName}</p><p className="mt-1 font-medium">{event.title}</p>
      <p className="mt-1 text-xs text-[#617269]">{formatMoodleDate(event.startAt, event.allDay)}{event.allDay ? ' · All day' : event.endAt !== event.startAt ? `–${formatMoodleDate(event.endAt)}` : ' · Calendar date'}</p>
      {event.description && <details className="mt-2"><summary className="cursor-pointer text-xs underline">Event details</summary><p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{event.description}</p></details>}
      <a href={event.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline">Open in Moodle</a>
    </li>)}</ul> : <p className="text-sm text-[#617269]">No events in this export for the recent and upcoming date range. Check your Moodle export filters.</p>}
    {events.length > 8 && <button type="button" onClick={() => setExpanded(value => !value)} className="text-xs underline">{expanded ? 'Show fewer events' : `Show all ${events.length} events`}</button>}
    {snapshot.warnings.map((warning, index) => <p key={index} className="text-xs leading-5 text-[#8a5a26]">{warning}</p>)}
  </div>;
}
