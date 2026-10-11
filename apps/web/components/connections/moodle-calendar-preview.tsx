'use client';

import { useState } from 'react';
import type { MoodleCalendarEvent, MoodleSnapshot } from '@polymate/contracts/moodle';

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

const ZURICH = 'Europe/Zurich';
const DAY_MS = 86_400_000;
const zurichDay = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: ZURICH }).format(value);
const dayLabel = (value: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: ZURICH, weekday: 'short', day: 'numeric', month: 'short' }).format(value);
const timeLabel = (value: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: ZURICH, timeStyle: 'short' }).format(value);
const safeMoodleUrl = (value: string) => { try { return new URL(value).protocol === 'https:' ? value : null; } catch { return null; } };

function relativeDay(value: Date, now: Date) {
  const days = Math.round((Date.parse(zurichDay(value)) - Date.parse(zurichDay(now))) / DAY_MS);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return days > 1 && days < 7 ? `In ${days} days` : null;
}

function DeadlineRow({ event, now, past }: { event: MoodleCalendarEvent; now: Date; past?: boolean }) {
  const start = new Date(event.startAt);
  const soon = past ? null : relativeDay(start, now);
  const url = safeMoodleUrl(event.sourceUrl);
  return <li className="flex items-baseline gap-3 py-2 text-sm">
    <span className={`w-24 shrink-0 tabular-nums ${past ? 'text-[#8a968e]' : 'font-medium'}`}>{dayLabel(start)}<span className="block text-xs font-normal text-[#617269]">{event.allDay ? 'All day' : timeLabel(start)}</span></span>
    <span className="min-w-0 flex-1">
      {url ? <a href={url} target="_blank" rel="noreferrer" className={`hover:underline ${past ? 'text-[#617269]' : ''}`}>{event.title}</a> : <span className={past ? 'text-[#617269]' : ''}>{event.title}</span>}
      <span className="block truncate text-xs text-[#748278]">{event.courseName}</span>
    </span>
    {soon && <span className="shrink-0 rounded-full bg-[#f3eadb] px-2 py-0.5 text-xs text-[#8a5a26]">{soon}</span>}
  </li>;
}

/** Compact, date-sorted deadline list for chat replies. Upcoming first; past events stay collapsed. */
export function MoodleDeadlineList({ snapshot, limit = 5 }: { snapshot: MoodleSnapshot; limit?: number }) {
  const [now] = useState(() => new Date());
  const [expanded, setExpanded] = useState(false);
  const events = [...(snapshot.calendarEvents ?? [])].sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
  const upcoming = events.filter(event => Date.parse(event.endAt || event.startAt) >= now.getTime());
  const past = events.filter(event => !upcoming.includes(event)).reverse();
  const visible = expanded ? upcoming : upcoming.slice(0, limit);
  return <div aria-label="Moodle deadlines">
    {upcoming.length ? <ul className="divide-y divide-[#e5eae4]">{visible.map(event => <DeadlineRow key={event.id} event={event} now={now} />)}</ul>
      : <p className="py-2 text-sm text-[#617269]">Nothing upcoming in your Moodle calendar.</p>}
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {upcoming.length > limit && <button type="button" onClick={() => setExpanded(value => !value)} className="underline">{expanded ? 'Show fewer' : `Show all ${upcoming.length} upcoming`}</button>}
    </div>
    {past.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-[#617269]">{past.length} past {past.length === 1 ? 'event' : 'events'}</summary>
      <ul className="divide-y divide-[#e5eae4]">{past.map(event => <DeadlineRow key={event.id} event={event} now={now} past />)}</ul></details>}
    {snapshot.warnings.map((warning, index) => <p key={index} className="mt-2 text-xs leading-5 text-[#8a5a26]">{warning}</p>)}
  </div>;
}
