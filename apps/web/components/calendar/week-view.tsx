'use client';

import type { CalendarEvent } from '@polymate/contracts/calendar';
import { shiftWeek, weekRange, zonedDateKey, type DateRange } from '@polymate/contracts/time';
import { useEffect, useMemo, useState } from 'react';
import {
  allDayEventsFor, eventLabel, formatTime, formatWeekLabel, nowOffset, placeDayEvents, visibleHours, weekDays, type PlacedEvent,
} from './week-layout';

export type WeekViewProps = {
  range: DateRange;
  events: readonly CalendarEvent[];
  loading?: boolean;
  error?: string | null;
  /** Shown above the grid, e.g. to label sample data. */
  notice?: string;
  selectedId?: string | null;
  /** Injected for tests and demos; defaults to the current time. */
  now?: Date;
  onSelect: (eventId: string) => void;
  onRangeChange: (range: DateRange) => void;
  onRetry?: () => void;
};

const HOUR_HEIGHT = 56;
const COLUMNS = 'grid-cols-[48px_1fr] md:grid-cols-[48px_repeat(7,minmax(0,1fr))]';

/** Prop-driven Monday–Sunday week in Europe/Zurich. Data loading and forms live outside. */
export function WeekView({ range, events, loading = false, error, notice, selectedId, now: nowProp, onSelect, onRangeChange, onRetry }: WeekViewProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (nowProp) return;
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [nowProp]);
  const current = nowProp ?? now;
  const days = useMemo(() => weekDays(range), [range]);
  const hours = useMemo(() => visibleHours(events, days), [events, days]);
  const todayKey = zonedDateKey(current);
  const todayIndex = days.findIndex(day => day.key === todayKey);
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  const mobileDay = focusedDay ?? (todayIndex >= 0 ? todayIndex : 0);
  const hasAllDay = events.some(event => event.allDay);
  const hourCount = hours.end - hours.start;
  const isCurrentWeek = todayIndex >= 0;

  function changeRange(next: DateRange) {
    setFocusedDay(null);
    onRangeChange(next);
  }

  return <section className="overflow-hidden rounded-2xl border border-[#dce3db] bg-white" aria-label="Weekly calendar">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] px-4 py-4 sm:px-6">
      <div>
        <h2 className="font-semibold" aria-live="polite">{formatWeekLabel(range)}</h2>
        <p className="mt-1 text-xs text-[#748278]">Europe/Zurich · Google Calendar</p>
      </div>
      <nav className="flex items-center gap-1" aria-label="Week navigation">
        <button type="button" onClick={() => changeRange(shiftWeek(range, -1))} aria-label="Previous week"
          className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce3db] text-lg hover:bg-[#f2f5f0]">‹</button>
        <button type="button" onClick={() => changeRange(weekRange(current))} disabled={isCurrentWeek}
          className="h-9 rounded-lg border border-[#dce3db] px-3 text-sm font-medium hover:bg-[#f2f5f0] disabled:opacity-40">Today</button>
        <button type="button" onClick={() => changeRange(shiftWeek(range, 1))} aria-label="Next week"
          className="grid h-9 w-9 place-items-center rounded-lg border border-[#dce3db] text-lg hover:bg-[#f2f5f0]">›</button>
      </nav>
    </header>

    {notice && <p className="border-b border-[#f0e3c4] bg-[#fbf5e6] px-6 py-2 text-xs text-[#7a5d1c]">{notice}</p>}
    {error && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f1d9d6] bg-[#fbf0ee] px-6 py-3 text-sm text-[#9e3e38]" role="alert">
      <span>{error}</span>
      {onRetry && <button type="button" onClick={onRetry} className="rounded-lg border border-[#e3c3bf] px-3 py-1 text-xs font-medium">Try again</button>}
    </div>}

    {/* Phones show one day at a time; the strip switches between days of this week. */}
    <div className="flex gap-1 overflow-x-auto border-b border-[#edf0eb] px-3 py-2 md:hidden" role="tablist" aria-label="Day">
      {days.map((day, index) => <button key={day.key} type="button" role="tab" aria-selected={index === mobileDay} onClick={() => setFocusedDay(index)}
        className={`min-w-0 flex-1 rounded-lg py-1.5 text-center text-xs ${index === mobileDay ? 'bg-[#173b32] text-white' : index === todayIndex ? 'bg-[#eef2e9]' : ''}`}>
        <span className="block">{day.weekday}</span><span className="block text-sm font-semibold">{day.dayOfMonth}</span>
      </button>)}
    </div>

    <div className="relative" aria-busy={loading}>
      <div className={`hidden border-b border-[#edf0eb] md:grid ${COLUMNS}`}>
        <span />
        {days.map((day, index) => <div key={day.key} className="border-l border-[#edf0eb] py-2 text-center">
          <span className="block text-[11px] uppercase tracking-wide text-[#748278]">{day.weekday}</span>
          <span className={`mt-0.5 inline-grid h-7 min-w-7 place-items-center rounded-full px-1 text-sm font-semibold ${index === todayIndex ? 'bg-[#173b32] text-white' : ''}`}
            aria-current={index === todayIndex ? 'date' : undefined}>{day.dayOfMonth}</span>
        </div>)}
      </div>

      {hasAllDay && <div className={`grid border-b border-[#edf0eb] ${COLUMNS}`}>
        <span className="self-center pr-1 text-right text-[10px] text-[#87928b]">all day</span>
        {days.map((day, index) => <div key={day.key} className={`min-h-8 space-y-1 border-l border-[#edf0eb] p-1 ${index === mobileDay ? '' : 'hidden md:block'}`}>
          {allDayEventsFor(events, day).map(event => <EventButton key={event.id} event={event} selected={event.id === selectedId} onSelect={onSelect} compact />)}
        </div>)}
      </div>}

      <div className={`grid ${COLUMNS}`}>
        <div className="relative" style={{ height: hourCount * HOUR_HEIGHT }} aria-hidden="true">
          {Array.from({ length: hourCount }, (_, i) => <span key={i} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-[#87928b]" style={{ top: i * HOUR_HEIGHT }}>
            {i === 0 ? '' : `${String(hours.start + i).padStart(2, '0')}:00`}
          </span>)}
        </div>
        {days.map((day, index) => {
          const placed = placeDayEvents(events, day, hours);
          const nowAt = nowOffset(current, day, hours);
          return <div key={day.key} role="group" aria-label={day.weekday + ' ' + day.dayOfMonth}
            className={`relative border-l border-[#edf0eb] ${index === todayIndex ? 'bg-[#fafcf8]' : ''} ${index === mobileDay ? '' : 'hidden md:block'}`}
            style={{ height: hourCount * HOUR_HEIGHT, backgroundImage: `repeating-linear-gradient(to bottom, #edf0eb 0 1px, transparent 1px ${HOUR_HEIGHT}px)` }}>
            {placed.map(item => <PlacedEventButton key={item.event.id} item={item} selected={item.event.id === selectedId} onSelect={onSelect} />)}
            {nowAt !== null && <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-[#d4553f]" style={{ top: `${nowAt}%` }} aria-hidden="true">
              <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-[#d4553f]" />
            </div>}
          </div>;
        })}
      </div>

      {loading && <div className="absolute inset-0 z-30 grid place-items-center bg-white/60">
        <span className="rounded-full border border-[#dce3db] bg-white px-4 py-2 text-xs font-medium" role="status">Loading your week…</span>
      </div>}
      {!loading && !error && events.length === 0 && <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-[#748278]">Nothing planned this week yet.</p>}
    </div>

    <footer className="flex flex-wrap gap-4 border-t border-[#edf0eb] px-6 py-3 text-[11px] text-[#617269]" aria-label="Legend">
      <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-l-[3px] border-[#9aa79f] bg-[#eef1ec]" />Your Google events (read-only)</span>
      <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-[#2f6b55]" />PolyMate study block</span>
      <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-dashed border-[#2f6b55] bg-[#e4efe7]" />Done</span>
    </footer>
  </section>;
}

function eventClasses(event: CalendarEvent, selected: boolean): string {
  const base = 'w-full overflow-hidden rounded-md text-left text-[11px] leading-tight transition focus-visible:z-30 focus-visible:outline-offset-1';
  const ring = selected ? ' ring-2 ring-[#d49a2f] ring-offset-1 z-20' : '';
  if (event.source === 'google-personal') return `${base} border-l-[3px] border-[#9aa79f] bg-[#eef1ec] text-[#3d4c44] hover:bg-[#e5eae2]${ring}`;
  if (event.completion === 'done') return `${base} border border-dashed border-[#2f6b55] bg-[#e4efe7] text-[#2f6b55] hover:bg-[#d9e8dd]${ring}`;
  return `${base} bg-[#2f6b55] text-white shadow-sm hover:bg-[#245a47]${ring}`;
}

function EventButton({ event, selected, onSelect, compact = false }: { event: CalendarEvent; selected: boolean; onSelect: (id: string) => void; compact?: boolean }) {
  return <button type="button" onClick={() => onSelect(event.id)} aria-label={eventLabel(event)} aria-pressed={selected}
    className={`${eventClasses(event, selected)} ${compact ? 'truncate px-1.5 py-1' : ''}`}>
    {event.completion === 'done' && '✓ '}{event.title}
  </button>;
}

function PlacedEventButton({ item, selected, onSelect }: { item: PlacedEvent; selected: boolean; onSelect: (id: string) => void }) {
  const { event } = item;
  const short = item.height < 5;
  return <button type="button" onClick={() => onSelect(event.id)} aria-label={eventLabel(event)} aria-pressed={selected}
    className={`absolute px-1.5 py-1 ${eventClasses(event, selected)} ${item.continuesBefore ? 'rounded-t-none' : ''} ${item.continuesAfter ? 'rounded-b-none' : ''}`}
    style={{ top: `${item.top}%`, height: `${item.height}%`, left: `calc(${item.left}% + 2px)`, width: `calc(${item.width}% - 4px)` }}>
    <span className={`block font-semibold ${event.completion === 'done' ? 'line-through decoration-1' : ''} ${short ? 'truncate' : 'line-clamp-2'}`}>
      {event.completion === 'done' && '✓ '}{event.title}
    </span>
    {!short && <span className="block opacity-80">{formatTime(event.startAt)}–{formatTime(event.endAt)}</span>}
  </button>;
}
