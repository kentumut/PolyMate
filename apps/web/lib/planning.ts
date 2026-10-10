import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ContractError, type OperationResult } from '@polymate/contracts/calendar';
import { assertPlanCurrent, type PlanningRequest, type PlanningState, type StoredStudyPlan } from '@polymate/contracts/planning';
import { assertStudyPlanFits, planStudyWeek, type LinkedStudyEvent } from '@polymate/core/scheduling/planner';
import type { OwnerContext } from '@polymate/core/identity';
import { listAssignments } from '@polymate/db/assignments';
import { listImportedCommitments } from '@polymate/db/imports';
import { findCalendarOperation, listUnresolvedCalendarOperations } from '@polymate/db/calendar-operations';
import { getStudyPlan, getStudyPreferences, linkedStudyBlocks, saveStudyPlan, updateStudyPlan, withPlanningLock } from '@polymate/db/planning';
import { calendarServiceFor, type OwnerCalendar } from './calendar-route';
import { observeStudyCalendarChange } from '@polymate/db/study-progress';

const publicState = (preferences: PlanningState['preferences'], snapshot: StoredStudyPlan | null): PlanningState => ({
  preferences, plan: snapshot?.plan ?? null, results: snapshot?.results ?? [],
});

export async function readPlanningState(ownerId: string): Promise<PlanningState> {
  const [preferences, snapshot] = await Promise.all([getStudyPreferences(ownerId), getStudyPlan(ownerId)]);
  if (snapshot) {
    // Recover confirmations even if the process stopped before updating the preview snapshot.
    const operations = await Promise.all(snapshot.plan.blocks.map(block => findCalendarOperation(ownerId, block.operationId)));
    snapshot.results = operations.flatMap(op => op?.result ? [op.result] : []);
  }
  return publicState(preferences, snapshot);
}

async function currentLinkedEvents(ownerId: string, calendar: OwnerCalendar, excludingPlanId?: string): Promise<LinkedStudyEvent[]> {
  const links = await linkedStudyBlocks(ownerId, excludingPlanId);
  const events: LinkedStudyEvent[] = [];
  for (const { assignmentId, eventId } of links) {
    const event = await calendar.getStudyBlock(eventId);
    if (event) events.push({ assignmentId, event });
  }
  return events;
}

const fingerprint = (events: LinkedStudyEvent[]) => events.map(({ assignmentId, event }) => ({ assignmentId, id: event.id, etag: event.etag }))
  .sort((a, b) => a.id.localeCompare(b.id));

/** Browser and future agent tools can share this owner-bound service. Never accept draft blocks from callers. */
export async function executePlanning(owner: OwnerContext, input: PlanningRequest, clock: () => Date = () => new Date()): Promise<PlanningState> {
  return withPlanningLock(owner.userId, async () => {
    const calendar = calendarServiceFor(owner);
    const assignments = await listAssignments(owner.userId);
    if (input.action === 'generate') {
      if ((await listUnresolvedCalendarOperations(owner.userId)).length) throw new ContractError('Check pending calendar changes before generating another plan.');
      const now = clock();
      const linkedEvents = await currentLinkedEvents(owner.userId, calendar);
      // Ask the pure planner for the horizon before fetching actual busy intervals.
      const draft = planStudyWeek({ assignments: [], events: [], linkedEvents: [], preferences: input.preferences, now, planId: randomUUID(), operationId: () => randomUUID() });
      const events = [...await calendar.listBusy(draft.horizon), ...await listImportedCommitments(owner.userId, draft.horizon)];
      const plan = planStudyWeek({ assignments, events, linkedEvents, preferences: input.preferences, now, planId: draft.id, operationId: () => randomUUID() });
      const snapshot: StoredStudyPlan = { plan, assignments, linkedEvents: fingerprint(linkedEvents), approved: false, results: [] };
      await saveStudyPlan(owner, snapshot);
      return publicState(plan.preferences, snapshot);
    }
    const snapshot = await getStudyPlan(owner.userId, input.planId);
    if (!snapshot) throw new ContractError('This preview is unavailable. Generate a new plan.');
    const { plan } = snapshot;
    if (plan.unscheduled.length && !input.allowPartial) throw new ContractError('Some work cannot fit. Explicitly choose to add only the blocks that fit.');
    // An old tab must not approve a superseded preview. Already approved attempts can still reconcile.
    const latest = await getStudyPlan(owner.userId);
    if (!snapshot.approved && latest?.plan.id !== plan.id) throw new ContractError('A newer preview exists. Review it before applying.');
    const operations = await Promise.all(plan.blocks.map(block => findCalendarOperation(owner.userId, block.operationId)));
    const outstanding = await listUnresolvedCalendarOperations(owner.userId);
    const ownIds = new Set(plan.blocks.map(block => block.operationId));
    if (outstanding.some(op => !ownIds.has(op.operationId))) throw new ContractError('Check other pending calendar changes before applying this plan.');
    const hasUnsent = operations.some(op => !op);
    let newWriteWarning: string | undefined;
    if (hasUnsent) {
      try {
        assertPlanCurrent(plan, clock());
        if (!isDeepStrictEqual(snapshot.assignments, assignments)) throw new ContractError('Assignments changed. Generate a fresh plan.');
        const linkedEvents = await currentLinkedEvents(owner.userId, calendar, plan.id);
        if (!isDeepStrictEqual(snapshot.linkedEvents, fingerprint(linkedEvents))) throw new ContractError('Existing study blocks changed. Generate a fresh plan.');
        const busy = [...await calendar.listBusy(plan.horizon), ...await listImportedCommitments(owner.userId, plan.horizon)];
        assertStudyPlanFits(plan, busy, plan.blocks.filter((_, index) => !operations[index]));
      } catch (error) {
        if (!operations.some(Boolean)) throw error;
        newWriteWarning = error instanceof ContractError ? error.message : 'Current availability could not be checked.';
      }
    }
    snapshot.approved = true;
    // Persist approval before dispatch; operation IDs and links were committed with the preview.
    await updateStudyPlan(owner.userId, snapshot);
    const results: OperationResult[] = [];
    for (const [index, block] of plan.blocks.entries()) {
      if (!operations[index]) {
        if (newWriteWarning) continue;
        if (Date.parse(plan.expiresAt) <= clock().getTime() || Date.parse(block.startAt) <= clock().getTime()) {
          newWriteWarning = 'The preview expired or a proposed block is now in the past. Generate a fresh plan.';
          continue;
        }
      }
      // The owner-bound calendar rechecks conflicts under its operation lock before each new write.
      const result = await calendar.createStudyBlock({ title: block.title, startAt: block.startAt, endAt: block.endAt }, block.operationId);
      await observeStudyCalendarChange(owner.userId, 'create', result.event?.id ?? null, result);
      results.push(result);
      snapshot.results = [...results];
      await updateStudyPlan(owner.userId, snapshot);
      if (result.status !== 'synced') break;
    }
    return { ...publicState(plan.preferences, snapshot), ...(newWriteWarning ? { warning: `${newWriteWarning} Only previously attempted blocks were checked; no further blocks were added.` } : {}) };
  });
}
