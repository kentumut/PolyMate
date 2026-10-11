'use client';

import type { CalendarEvent } from '@polymate/contracts/calendar';
import { shiftWeek, weekRange, zonedDateKey, type DateRange } from '@polymate/contracts/time';
import { useEffect, useMemo, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import type { ProposedBlock, UnscheduledWork } from './plan-overlay';
import {
  allDayEventsFor, calendarSelectionRange, eventLabel, formatTime, formatWeekLabel, nowOffset, placeDayEvents,
  proposedLabel, snappedGridMinute, visibleHours, weekDays, type PlacedEvent,
} from './week-layout';

export type WeekViewProps = {
  range: DateRange;
  events: readonly CalendarEvent[];
  loading?: boolean;
  error?: string | null;
  /** Shown above the grid, e.g. to label sample data. */
  notice?: string;
  selectedId?: string | null;
  /** Planner preview blocks not yet confirmed by Google; drawn distinctly and never selectable. */
  proposed?: readonly ProposedBlock[];
  /** Event ID → assignment title for study blocks linked to an assignment. */
  assignmentLabels?: ReadonlyMap<string, string>;
  /** Open assignment effort that no block covers yet. */
  unscheduled?: readonly UnscheduledWork[];
  /** Injected for tests and demos; defaults to the current time. */
  now?: Date;
  onSelect: (eventId: string) => void;
  onRangeChange: (range: DateRange) => void;
  onRetry?: () => void;
  /** Opens creation with a mouse-dragged time range. */
  onTimeRangeSelect?: (startAt: string, endAt: string) => void;
  /** Hands the uncovered assignments to the planner, e.g. as a chat request. */
  onPlanUnscheduled?: (items: readonly UnscheduledWork[]) => void;
};

type DragSelection = { dayIndex: number; anchorMinute: number; focusMinute: number };

const HOUR_HEIGHT = 40;
const COLUMNS = 'grid-cols-[44px_1fr] md:grid-cols-[44px_repeat(7,minmax(0,1fr))]';
const subscribeToHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

/** Prop-driven Monday–Sunday week in Europe/Zurich. Data loading and forms live outside. */
const NO_PROPOSALS: readonly ProposedBlock[] = [];
const NO_LABELS: ReadonlyMap<string, string> = new Map();

type WeekItem = CalendarEvent | ProposedBlock;
const isProposed = (item: WeekItem): item is ProposedBlock => 'kind' in item && item.kind === 'proposed';

export function WeekView({
  range, events, loading = false, error, notice, selectedId, proposed = NO_PROPOSALS, assignmentLabels = NO_LABELS, unscheduled,
  now: nowProp, onSelect, onRangeChange, onRetry, onTimeRangeSelect, onPlanUnscheduled,
}: WeekViewProps) {
  // The server and browser clocks can differ; reveal live time markers after hydration.
  const hydrated = useSyncExternalStore(subscribeToHydration, clientHydrated, serverHydrated);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (nowProp) return;
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [nowProp]);
  const current = nowProp ?? now;
  const days = useMemo(() => weekDays(range), [range]);
  const visibleProposals = useMemo(() => proposed.filter(block => Date.parse(block.startAt) < Date.parse(range.to) && Date.parse(block.endAt) > Date.parse(range.from)), [proposed, range]);
  const items = useMemo<WeekItem[]>(() => [...events, ...visibleProposals], [events, visibleProposals]);
  const hours = useMemo(() => visibleHours(items, days), [items, days]);
  const todayKey = zonedDateKey(current);
  const todayIndex = nowProp || hydrated ? days.findIndex(day => day.key === todayKey) : -1;
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  const mobileDay = focusedDay ?? (todayIndex >= 0 ? todayIndex : 0);
  const hasAllDay = events.some(event => event.allDay);
  const hourCount = hours.end - hours.start;
  const isCurrentWeek = todayIndex >= 0;
  const [dragSelection, setDragSelection] = useState<DragSelection | null>(null);
  // Touch has no drag-to-select (dragging scrolls), so a tap on an empty slot starts a block there.
  const [tap, setTap] = useState<{ dayIndex: number; pointerId: number; x: number; y: number } | null>(null);
  const canDrag = Boolean(onTimeRangeSelect) && !loading && !error;

  function changeRange(next: DateRange) {
    setFocusedDay(null);
    setDragSelection(null);
    onRangeChange(next);
  }

  function gridMinute(event: ReactPointerEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    return snappedGridMinute(event.clientY - rect.top, rect.height, hours);
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>, dayIndex: number) {
    if (!canDrag || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    if (event.pointerType !== 'mouse') { setTap({ dayIndex, pointerId: event.pointerId, x: event.clientX, y: event.clientY }); return; }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const minute = Math.min(gridMinute(event), hours.end * 60 - 15);
    setDragSelection({ dayIndex, anchorMinute: minute, focusMinute: minute });
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>, dayIndex: number) {
    if (!dragSelection || dragSelection.dayIndex !== dayIndex || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setDragSelection({ ...dragSelection, focusMinute: gridMinute(event) });
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>, dayIndex: number) {
    if (tap) {
      setTap(null);
      // A scroll cancels the pointer instead of lifting it; anything that moved is not a tap either.
      if (tap.dayIndex !== dayIndex || tap.pointerId !== event.pointerId || Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 8) return;
      const minute = Math.min(gridMinute(event), hours.end * 60 - 15);
      const selection = calendarSelectionRange(days[dayIndex], minute, minute);
      onTimeRangeSelect?.(selection.startAt, selection.endAt);
      return;
    }
    if (!dragSelection || dragSelection.dayIndex !== dayIndex) return;
    const selection = calendarSelectionRange(days[dayIndex], dragSelection.anchorMinute, gridMinute(event));
    setDragSelection(null);
    onTimeRangeSelect?.(selection.startAt, selection.endAt);
  }

  return <section className="overflow-hidden rounded-xl border bg-card" aria-label="Weekly calendar">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div>
        <h2 className="font-semibold" aria-live="polite">{formatWeekLabel(range)}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Europe/Zurich</p>
      </div>
      <nav className="flex items-center gap-1" aria-label="Week navigation">
        <button type="button" onClick={() => changeRange(shiftWeek(range, -1))} aria-label="Previous week"
          className="grid h-8 w-8 place-items-center rounded-md border text-lg hover:bg-accent">‹</button>
        <button type="button" onClick={() => changeRange(weekRange(current))} disabled={isCurrentWeek}
          className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-accent disabled:opacity-40">Today</button>
        <button type="button" onClick={() => changeRange(shiftWeek(range, 1))} aria-label="Next week"
          className="grid h-8 w-8 place-items-center rounded-md border text-lg hover:bg-accent">›</button>
      </nav>
    </header>

    {notice && <p className="border-b border-[#f0e3c4] bg-[#fbf5e6] px-6 py-2 text-xs text-[#7a5d1c]">{notice}</p>}
    {proposed.length > 0 && <p className="border-b border-[#f0e3c4] bg-[#fffaf0] px-6 py-2 text-xs text-[#7a5d1c]" role="status">
      <span className="font-semibold">Plan preview.</span> {visibleProposals.length === proposed.length
        ? `${proposed.length} proposed ${proposed.length === 1 ? 'block is' : 'blocks are'} outlined below.`
        : `${visibleProposals.length} of ${proposed.length} proposed blocks fall in this week.`} They are added to your calendar only after you approve the plan.
    </p>}
    {unscheduled && unscheduled.length > 0 && <UnscheduledStrip items={unscheduled} onPlan={onPlanUnscheduled} />}
    {error && <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f1d9d6] bg-[#fbf0ee] px-6 py-3 text-sm text-[#9e3e38]" role="alert">
      <span>{error}</span>
      {onRetry && <button type="button" onClick={onRetry} className="rounded-lg border border-[#e3c3bf] px-3 py-1 text-xs font-medium">Try again</button>}
    </div>}

    {/* Phones show one day at a time; the strip switches between days of this week. */}
    <div className="flex gap-1 overflow-x-auto border-b px-3 py-2 md:hidden" role="tablist" aria-label="Day">
      {days.map((day, index) => <button key={day.key} type="button" role="tab" aria-selected={index === mobileDay} onClick={() => setFocusedDay(index)}
        className={`min-w-0 flex-1 rounded-md py-1.5 text-center text-xs ${index === mobileDay ? 'bg-primary text-primary-foreground' : index === todayIndex ? 'bg-accent' : ''}`}>
        <span className="block">{day.weekday}</span><span className="block text-sm font-semibold">{day.dayOfMonth}</span>
      </button>)}
    </div>

    <div className="relative" aria-busy={loading}>
      <div className={`hidden border-b md:grid ${COLUMNS}`}>
        <span />
        {days.map((day, index) => <div key={day.key} className="border-l py-1.5 text-center">
          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{day.weekday}</span>
          <span className={`mt-0.5 inline-grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-semibold ${index === todayIndex ? 'bg-primary text-primary-foreground' : ''}`}
            aria-current={index === todayIndex ? 'date' : undefined}>{day.dayOfMonth}</span>
        </div>)}
      </div>

      {hasAllDay && <div className={`grid border-b ${COLUMNS}`}>
        <span className="self-center pr-1 text-right text-[10px] text-muted-foreground">all day</span>
        {days.map((day, index) => <div key={day.key} className={`min-h-8 space-y-1 border-l p-1 ${index === mobileDay ? '' : 'hidden md:block'}`}>
          {allDayEventsFor(events, day).map(event => <EventButton key={event.id} event={event} assignment={assignmentLabels.get(event.id)} selected={event.id === selectedId} onSelect={onSelect} compact />)}
        </div>)}
      </div>}

      <div className={`grid ${COLUMNS}`}>
        <div className="relative" style={{ height: hourCount * HOUR_HEIGHT }} aria-hidden="true">
          {Array.from({ length: hourCount }, (_, i) => <span key={i} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: i * HOUR_HEIGHT }}>
            {i === 0 ? '' : `${String(hours.start + i).padStart(2, '0')}:00`}
          </span>)}
        </div>
        {days.map((day, index) => {
          const placed = placeDayEvents(items, day, hours);
          const nowAt = nowProp || hydrated ? nowOffset(current, day, hours) : null;
          return <div key={day.key} role="group" aria-label={day.weekday + ' ' + day.dayOfMonth}
            onPointerDown={event => startDrag(event, index)} onPointerMove={event => moveDrag(event, index)}
            onPointerUp={event => finishDrag(event, index)} onPointerCancel={() => { setDragSelection(null); setTap(null); }}
            className={`relative border-l ${index === todayIndex ? 'bg-muted/30' : ''} ${index === mobileDay ? '' : 'hidden md:block'} ${canDrag ? 'select-none md:cursor-crosshair' : ''}`}
            style={{ height: hourCount * HOUR_HEIGHT, backgroundImage: `repeating-linear-gradient(to bottom, color-mix(in oklab, var(--border) 70%, transparent) 0 1px, transparent 1px ${HOUR_HEIGHT}px)` }}>
            {dragSelection?.dayIndex === index && <SelectionPreview selection={dragSelection} hours={hours} />}
            {placed.map(item => {
              const { event } = item;
              return isProposed(event)
                ? <ProposedTile key={event.id} item={{ ...item, event }} />
                : <PlacedEventButton key={event.id} item={{ ...item, event }} assignment={assignmentLabels.get(event.id)} selected={event.id === selectedId} onSelect={onSelect} />;
            })}
            {nowAt !== null && <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-[#d4553f]" style={{ top: `${nowAt}%` }} aria-hidden="true">
              <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-[#d4553f]" />
            </div>}
          </div>;
        })}
      </div>

      {loading && <div className="absolute inset-0 z-30 grid place-items-center bg-background/60">
        <span className="rounded-full border bg-card px-4 py-2 text-xs font-medium shadow-sm" role="status">Loading your week…</span>
      </div>}
      {!loading && !error && items.length === 0 && <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-[#767f8b]">Nothing planned this week yet.</p>}
    </div>

    <footer className="flex flex-wrap gap-4 border-t px-4 py-2.5 text-[11px] text-muted-foreground" aria-label="Legend">
      {events.some(event => event.source === 'google-personal') && <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-l-[3px] border-[#9ca4af] bg-[#edf0f5]" />Personal Google events · view only</span>}
      <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-[#215caf]" />PolyMate study block</span>
      <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-dashed border-[#215caf] bg-[#e5ecf7]" />Done</span>
      {proposed.length > 0 && <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-2 border-dashed border-[#c08a2b] bg-[#fffaf0]" />Proposed, not added yet</span>}
      {onTimeRangeSelect && <span className="ml-auto"><span className="hidden md:inline">Drag across an empty time slot to add a block</span><span className="md:hidden">Tap an empty time slot to add a block</span></span>}
    </footer>
  </section>;
}

function SelectionPreview({ selection, hours }: { selection: DragSelection; hours: { start: number; end: number } }) {
  const start = Math.min(selection.anchorMinute, selection.focusMinute);
  const end = selection.anchorMinute === selection.focusMinute ? start + 50 : Math.max(selection.anchorMinute, selection.focusMinute);
  const span = (hours.end - hours.start) * 60;
  const label = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return <div className="pointer-events-none absolute inset-x-0 z-10 mx-0.5 rounded-md border border-[#215caf] bg-[#dee7f5]/90 px-1.5 py-1 text-[11px] font-semibold text-[#08407e] shadow-sm"
    style={{ top: `${((start - hours.start * 60) / span) * 100}%`, height: `${Math.max(((end - start) / span) * 100, 1)}%` }} aria-hidden="true">
    {label(start)}–{label(end)}
  </div>;
}

function eventClasses(event: CalendarEvent, selected: boolean): string {
  const base = 'w-full overflow-hidden rounded-md text-left text-[11px] leading-tight transition focus-visible:z-30 focus-visible:outline-offset-1';
  const ring = selected ? ' ring-2 ring-[#d49a2f] ring-offset-1 z-20' : '';
  if (event.source === 'google-personal') return `${base} border-l-[3px] border-[#9ca4af] bg-[#edf0f5] text-[#404855] hover:bg-[#e3e9f0]${ring}`;
  if (event.completion === 'done') return `${base} border border-dashed border-[#215caf] bg-[#e5ecf7] text-[#215caf] hover:bg-[#dbe4f2]${ring}`;
  return `${base} bg-[#215caf] text-white shadow-sm hover:bg-[#1a4f99]${ring}`;
}

type EventButtonProps = { event: CalendarEvent; assignment?: string; selected: boolean; onSelect: (id: string) => void; compact?: boolean };

function EventButton({ event, assignment, selected, onSelect, compact = false }: EventButtonProps) {
  return <button type="button" onClick={() => onSelect(event.id)} aria-label={eventLabel(event, assignment)} aria-pressed={selected}
    className={`${eventClasses(event, selected)} ${compact ? 'truncate px-1.5 py-1' : ''}`}>
    {event.completion === 'done' && '✓ '}{event.title}
  </button>;
}

function PlacedEventButton({ item, assignment, selected, onSelect }: { item: PlacedEvent; assignment?: string; selected: boolean; onSelect: (id: string) => void }) {
  const { event } = item;
  const short = item.height < 8;
  // Planned blocks are titled after their assignment; only label blocks whose title says something else.
  const showAssignment = assignment && assignment !== event.title && item.height >= 10;
  return <button type="button" onClick={() => onSelect(event.id)} aria-label={eventLabel(event, assignment)} aria-pressed={selected}
    className={`absolute px-1.5 py-1 ${eventClasses(event, selected)} ${item.continuesBefore ? 'rounded-t-none' : ''} ${item.continuesAfter ? 'rounded-b-none' : ''}`}
    style={{ top: `${item.top}%`, height: `${item.height}%`, left: `calc(${item.left}% + 2px)`, width: `calc(${item.width}% - 4px)` }}>
    <span className={`block font-semibold ${event.completion === 'done' ? 'line-through decoration-1' : ''} ${short || showAssignment ? 'truncate' : 'line-clamp-2'}`}>
      {event.completion === 'done' && '✓ '}{event.title}
    </span>
    {showAssignment && <span className="block truncate opacity-90">↳ {assignment}</span>}
    {!short && <span className="block opacity-80">{formatTime(event.startAt)}–{formatTime(event.endAt)}</span>}
  </button>;
}

const proposedTag = { proposed: 'Proposed', unknown: 'Checking', failed: 'Not added' } as const;

/** Preview of a planner block: dashed amber outline, no fill colour shared with synced blocks, not clickable. */
function ProposedTile({ item }: { item: PlacedEvent<ProposedBlock> }) {
  const { event: block } = item;
  const short = item.height < 8;
  return <div role="note" tabIndex={0} aria-label={proposedLabel(block)} title={proposedLabel(block)}
    className={`absolute overflow-hidden rounded-md border-2 border-dashed px-1.5 py-0.5 text-[11px] leading-tight focus-visible:z-30 focus-visible:outline-offset-1 ${
      block.status === 'failed' ? 'border-[#c4655d] bg-[#fbf0ee] text-[#9e3e38]' : 'border-[#c08a2b] bg-[#fffaf0] text-[#7a5d1c]'}`}
    style={{ top: `${item.top}%`, height: `${item.height}%`, left: `calc(${item.left}% + 2px)`, width: `calc(${item.width}% - 4px)` }}>
    <span className={`flex items-baseline gap-1 ${short ? 'truncate' : ''}`}>
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide">{proposedTag[block.status]}</span>
      {short && <span className="truncate font-semibold">{block.title}</span>}
    </span>
    {!short && <span className="block font-semibold line-clamp-2">{block.title}</span>}
    {!short && <span className="block opacity-80">{formatTime(block.startAt)}–{formatTime(block.endAt)}</span>}
  </div>;
}

function UnscheduledStrip({ items, onPlan }: { items: readonly UnscheduledWork[]; onPlan?: (items: readonly UnscheduledWork[]) => void }) {
  const total = items.reduce((sum, item) => sum + item.minutes, 0);
  return <details className="group border-b border-[#f0e3c4] bg-[#fbf5e6] px-6 py-2 text-xs text-[#7a5d1c]">
    <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
      <span className="font-semibold">Unscheduled work:</span> {total} min across {items.length} {items.length === 1 ? 'assignment' : 'assignments'} {items.length === 1 ? 'is' : 'are'} not covered by a study block.
      <span className="ml-1 underline group-open:hidden">Show</span>
      {onPlan && <button type="button" onClick={event => { event.preventDefault(); onPlan(items); }} className="ml-3 rounded-md border border-[#d9c48f] bg-white px-2 py-0.5 font-medium hover:bg-[#fffaf0]">Plan with PolyMate</button>}
    </summary>
    <ul className="mt-2 space-y-1" aria-label="Unscheduled work">
      {items.map(item => <li key={item.assignmentId} className="break-words">
        <span className="font-medium">{item.title}</span> · {item.minutes} min{item.reason ? ` — ${item.reason}` : ''}
      </li>)}
    </ul>
  </details>;
}
