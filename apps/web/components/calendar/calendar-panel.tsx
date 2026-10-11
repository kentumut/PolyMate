'use client';

import type { CalendarClient, CalendarEvent } from '@polymate/contracts/calendar';
import { CalendarRequestError, HttpCalendarClient } from '@polymate/contracts/http-client';
import { weekRange, type DateRange } from '@polymate/contracts/time';
import { FAKE_CALENDAR_LABEL, FakeCalendarClient } from '@polymate/core/calendar/fake';
import { useEffect, useState } from 'react';
import { eventLabel } from './week-layout';
import { WeekView, type WeekViewProps } from './week-view';

export type CalendarPanelProps = {
  /** Share the read client with the study workflow, especially for in-memory samples. */
  client?: CalendarClient;
  /** Use the labelled in-memory sample calendar instead of the persistent calendar. */
  sample?: boolean;
  /** Receives the selected event, e.g. to open Catalin's study-block dialog. */
  onSelect?: (event: CalendarEvent) => void;
  /** Change this value to reload the visible week after a mutation. */
  reloadKey?: string | number;
  /** Opens a specific week, used by the time-relative guided demo. */
  initialDate?: string;
  onRangeChange?: (range: DateRange) => void;
  onTimeRangeSelect?: (startAt: string, endAt: string) => void;
  /** A new object jumps to the week containing its date, e.g. to show a chat draft. */
  focus?: { date: string };
} & Pick<WeekViewProps, 'proposed' | 'assignmentLabels' | 'unscheduled' | 'onPlanUnscheduled'>;

/** Loads the visible week through the shared CalendarClient and owns navigation/selection state. */
export function CalendarPanel({ client: suppliedClient, sample = false, onSelect, reloadKey, initialDate, onRangeChange, onTimeRangeSelect, focus, ...overlay }: CalendarPanelProps) {
  const [defaultClient] = useState<CalendarClient>(() => suppliedClient ?? (sample ? new FakeCalendarClient(undefined, 250) : new HttpCalendarClient()));
  const client = suppliedClient ?? defaultClient;
  const [range, setRange] = useState<DateRange>(() => weekRange(initialDate));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [appliedFocus, setAppliedFocus] = useState(focus);
  if (focus !== appliedFocus) {
    setAppliedFocus(focus);
    if (focus) setRange(weekRange(focus.date));
  }
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; events: CalendarEvent[]; error: string | null } | null>(null);
  const key = `${range.from}|${reloadKey ?? ''}|${attempt}`;
  const loading = loaded?.key !== key;
  const events = loaded?.events ?? [];

  useEffect(() => {
    let current = true;
    client.listWeek(range)
      .then(next => { if (current) setLoaded({ key, events: next, error: null }); })
      .catch((reason: unknown) => {
        if (current) setLoaded({ key, events: [], error: reason instanceof CalendarRequestError ? reason.message : 'Calendar could not be loaded.' });
      });
    return () => { current = false; };
  }, [client, range, key]);

  function select(id: string) {
    setSelectedId(id);
    const event = events.find(item => item.id === id);
    if (event) onSelect?.(event);
  }

  const selected = events.find(event => event.id === selectedId);

  return <div className="min-w-0 space-y-3">
    <WeekView {...overlay} range={range} events={events} loading={loading} error={loading ? null : loaded?.error} selectedId={selectedId}
      notice={sample ? FAKE_CALENDAR_LABEL : undefined}
      onSelect={select} onRangeChange={next => { setRange(next); onRangeChange?.(next); }} onRetry={() => setAttempt(n => n + 1)}
      onTimeRangeSelect={onTimeRangeSelect} />
    {selected && !onSelect && <p className="rounded-xl border border-[#dbe1ea] bg-white px-4 py-3 text-sm" role="status">
      {eventLabel(selected, overlay.assignmentLabels?.get(selected.id))}
    </p>}
  </div>;
}
