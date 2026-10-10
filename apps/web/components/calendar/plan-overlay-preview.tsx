'use client';

import { weekRange, zonedParts, zonedTimeToInstant, type DateRange } from '@polymate/contracts/time';
import { FAKE_CALENDAR_LABEL, sampleWeekEvents } from '@polymate/core/calendar/fake';
import { useState } from 'react';
import type { ProposedBlock, UnscheduledWork } from './plan-overlay';
import { WeekView } from './week-view';

/** Development-only fixture for reviewing the plan overlay without Postgres or Google. */
export function PlanOverlayPreview() {
  const [range, setRange] = useState<DateRange>(() => weekRange());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fixture] = useState(() => {
    const monday = zonedParts(weekRange().from);
    const at = (day: number, hour: number, minute = 0) => zonedTimeToInstant({ ...monday, day: monday.day + day, hour, minute }).toISOString();
    const block = (n: number, day: number, hour: number, title: string, status: ProposedBlock['status'] = 'proposed'): ProposedBlock => ({
      kind: 'proposed', id: `proposed:preview-${n}`, operationId: `preview-${n}`, title, startAt: at(day, hour), endAt: at(day, hour, 50), allDay: false, status,
    });
    const proposed = [
      block(1, 3, 10, 'Analysis I problem set 5'), block(2, 3, 11, 'Analysis I problem set 5'),
      block(3, 4, 9, 'Physics lab report'), block(4, 4, 14, 'Physics lab report', 'unknown'), block(5, 5, 10, 'Analysis I problem set 5', 'failed'),
    ];
    const unscheduled: UnscheduledWork[] = [
      { assignmentId: 'physics', title: 'Physics lab report', minutes: 40, reason: 'Not enough study time before the deadline.' },
      { assignmentId: 'discrete', title: 'Discrete Mathematics sheet 2', minutes: 90 },
    ];
    return { events: sampleWeekEvents(), proposed, unscheduled, labels: new Map([['sample4', 'Analysis I problem set 5'], ['sample8', 'Discrete Mathematics sheet 2']]) };
  });
  return <main className="mx-auto max-w-7xl px-4 py-8">
    <h1 className="mb-4 text-xl font-semibold">Plan overlay preview</h1>
    <WeekView range={range} events={fixture.events} proposed={fixture.proposed} assignmentLabels={fixture.labels} unscheduled={fixture.unscheduled}
      notice={FAKE_CALENDAR_LABEL} selectedId={selectedId} onSelect={setSelectedId} onRangeChange={setRange} />
  </main>;
}
