import type { Assignment } from '@polymate/contracts/assignments';
import type { OperationResult } from '@polymate/contracts/calendar';
import type { StudyPlan } from '@polymate/contracts/planning';
import type { BlockAssignmentLink, ProgressReport } from '@polymate/contracts/study-progress';

/** A planner block that Google has not confirmed yet. Never selectable as a calendar event. */
export type ProposedBlock = Readonly<{
  kind: 'proposed';
  /** Prefixed so it can never collide with a Google event ID. */
  id: string;
  operationId: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: false;
  /** `failed`/`unknown` blocks were attempted during apply but are not confirmed in Google. */
  status: 'proposed' | 'failed' | 'unknown';
}>;

export type UnscheduledWork = Readonly<{
  assignmentId: string;
  title: string;
  minutes: number;
  /** Planner explanation, or absent when no plan covers this assignment. */
  reason?: string;
}>;

/**
 * Plan blocks still waiting for Google. Confirmed blocks are dropped because the real event
 * now renders in their place; expired previews that were never applied can no longer be applied.
 */
export function proposedBlocks(plan: StudyPlan | null | undefined, results: readonly OperationResult[], now: Date): ProposedBlock[] {
  if (!plan) return [];
  const byOperation = new Map(results.map(result => [result.operationId, result]));
  if (!results.length && Date.parse(plan.expiresAt) <= now.getTime()) return [];
  return plan.blocks.flatMap(block => {
    const status = byOperation.get(block.operationId)?.status;
    if (status === 'synced') return [];
    return [{
      kind: 'proposed' as const, id: `proposed:${block.operationId}`, operationId: block.operationId,
      title: block.title, startAt: block.startAt, endAt: block.endAt, allDay: false as const,
      status: status === 'failed' ? 'failed' as const : status === 'unknown' || status === 'pending' ? 'unknown' as const : 'proposed' as const,
    }];
  });
}

/** Event ID → assignment title for every live block linked to an assignment. */
export function assignmentLabels(links: readonly BlockAssignmentLink[], assignments: readonly Assignment[]): Map<string, string> {
  const titles = new Map(assignments.map(assignment => [assignment.id, assignment.title]));
  const labels = new Map<string, string>();
  for (const link of links) {
    const title = titles.get(link.assignmentId);
    if (!link.deleted && title) labels.set(link.eventId, title);
  }
  return labels;
}

/**
 * Open work not covered by a study block. A current preview's shortfall is authoritative;
 * otherwise mirror the planner: linked sessions without a report for their current revision
 * reserve their duration, because reported sessions are already reflected in remaining effort.
 */
export function unscheduledWork(input: {
  assignments: readonly Assignment[]; links: readonly BlockAssignmentLink[]; reports: readonly ProgressReport[];
  plan?: StudyPlan | null; now: Date;
}): UnscheduledWork[] {
  const { assignments, links, reports, plan, now } = input;
  if (plan && Date.parse(plan.expiresAt) > now.getTime()) {
    return plan.unscheduled.map(item => ({ assignmentId: item.assignmentId, title: item.title, minutes: item.remainingMinutes, reason: item.reason }));
  }
  const reported = new Set(reports.map(report => `${report.eventId}:${report.sessionRevision}`));
  const reserved = new Map<string, number>();
  for (const link of links) {
    if (link.deleted || reported.has(`${link.eventId}:${link.sessionRevision}`)) continue;
    const minutes = Math.max(0, (Date.parse(link.endAt) - Date.parse(link.startAt)) / 60_000);
    reserved.set(link.assignmentId, (reserved.get(link.assignmentId) ?? 0) + minutes);
  }
  return assignments
    .filter(assignment => (assignment.status === 'open' || assignment.status === 'in_progress') && Date.parse(assignment.dueAt) > now.getTime())
    .map(assignment => ({ assignmentId: assignment.id, title: assignment.title, minutes: Math.round(assignment.remainingMinutes - (reserved.get(assignment.id) ?? 0)) }))
    .filter(item => item.minutes > 0);
}
