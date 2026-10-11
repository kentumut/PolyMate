'use client';

import { daysWithItems, fittedHours, formatDay, formatTime, placeDayEvents, type TimedItem } from './week-layout';

export type GridBlock = TimedItem & Readonly<{ title: string; href?: string | null }>;

const HOUR_PX = 44;

/** Compact time grid showing only the days that contain blocks, so a draft plan reads like a calendar. */
export function DayTimelineGrid({ blocks }: { blocks: readonly GridBlock[] }) {
  const days = daysWithItems(blocks);
  if (!days.length) return null;
  const hours = fittedHours(blocks, days);
  const height = (hours.end - hours.start) * HOUR_PX;
  const hourMarks = Array.from({ length: hours.end - hours.start + 1 }, (_, index) => hours.start + index);
  return <div className="overflow-x-auto rounded-xl border border-[#dbe1ea] bg-white">
    <div className="flex min-w-max">
      <div className="w-12 shrink-0 border-r border-[#e4e9ef]">
        <div className="h-10" />
        <div className="relative" style={{ height }}>
          {hourMarks.slice(0, -1).map(hour => <span key={hour} className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-[#8c939e]" style={{ top: (hour - hours.start) * HOUR_PX }}>{String(hour).padStart(2, '0')}:00</span>)}
        </div>
      </div>
      {days.map(day => <div key={day.key} className="w-36 shrink-0 border-r border-[#e4e9ef] last:border-r-0 sm:w-auto sm:min-w-36 sm:flex-1">
        <div className="flex h-10 items-baseline gap-1.5 border-b border-[#e4e9ef] px-2 pt-3 text-sm" title={formatDay(day.start)}>
          <span className="text-xs uppercase tracking-wide text-[#656e7c]">{day.weekday}</span><span className="font-semibold">{day.dayOfMonth}</span>
        </div>
        <div className="relative" style={{ height }}>
          {hourMarks.slice(1, -1).map(hour => <div key={hour} className="absolute inset-x-0 border-t border-[#eff2f7]" style={{ top: (hour - hours.start) * HOUR_PX }} aria-hidden="true" />)}
          {placeDayEvents(blocks, day, hours).map(({ event, top, height: size, left, width }) => {
            const label = `${event.title}, ${formatDay(event.startAt)}, ${formatTime(event.startAt)} to ${formatTime(event.endAt)}`;
            const body = <>
              <span className="block truncate font-medium leading-4">{event.title}</span>
              <span className="block truncate tabular-nums text-[#2a5490]">{formatTime(event.startAt)}–{formatTime(event.endAt)}</span>
            </>;
            const className = 'absolute overflow-hidden rounded-md border-l-[3px] border-[#215caf] bg-[#e4ebf6] px-1.5 py-1 text-[11px] text-[#08407e]';
            const style = { top: `${top}%`, height: `calc(${size}% - 2px)`, left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)` };
            return event.href
              ? <a key={event.id} href={event.href} target="_blank" rel="noreferrer" title={label} aria-label={`${label}. Open Moodle source`} className={`${className} hover:bg-[#d6e2f2]`} style={style}>{body}</a>
              : <div key={event.id} title={label} aria-label={label} className={className} style={style}>{body}</div>;
          })}
        </div>
      </div>)}
    </div>
  </div>;
}
