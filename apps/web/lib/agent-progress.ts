import { randomUUID } from 'node:crypto';
import { ContractError, parseEventId, parseOperationId } from '@polymate/contracts/calendar';
import { parseLinkRequest, parseProgressRequest, type LinkRequest, type ProgressRequest } from '@polymate/contracts/study-progress';
import { encryptSecret, decryptSecret } from '@polymate/core/google-auth/crypto';
import type { OwnerContext } from '@polymate/core/identity';
import { studyProgressStore, syncStudyCalendarRead } from '@polymate/db/study-progress';
import { CalendarServiceError } from '@polymate/core/calendar';
import { GoogleNotConnectedError } from '@polymate/core/calendar/google-api';
import { studyProgressServiceFor } from './study-progress';
import { calendarServiceFor } from './calendar-route';

const TTL = 30 * 60_000;
type Context = { purpose: 'progress-context'; ownerId: string; expiresAt: number; request: LinkRequest & { expectedSessionRevision?: number } };
type Draft = { purpose: 'progress-draft'; ownerId: string; expiresAt: number } & (
  { kind: 'report'; request: ProgressRequest } | { kind: 'link'; request: LinkRequest }
);
export type ProgressDraftCard = {
  phase: 'draft'; kind: 'report' | 'link'; draftToken: string; expiresAt: string;
  assignmentTitle: string; eventId: string; action?: string; remainingMinutes?: number; assignmentFinished?: boolean; note?: string;
  startAt: string; endAt: string;
  sessionRevision?: number; recovery?: boolean;
};

function open<T extends Context | Draft>(token: unknown, owner: OwnerContext, purpose: T['purpose']): T {
  if (typeof token !== 'string' || token.length > 12_000) throw new ContractError('Use the progress reference supplied by the application.');
  let data: T;
  try {
    if (token.split('.').slice(1).some(part => Buffer.from(part, 'base64url').toString('base64url') !== part)) throw new Error('Noncanonical reference');
    data = JSON.parse(decryptSecret(token));
  } catch { throw new ContractError('Invalid progress reference. Read the latest progress again.'); }
  if (!data || data.purpose !== purpose || data.ownerId !== owner.userId || !Number.isFinite(data.expiresAt)) {
    throw new ContractError('This progress reference does not belong to your study space.');
  }
  return data;
}
function fresh(expiresAt: number) {
  if (expiresAt <= Date.now()) throw new ContractError('This progress draft expired. Read the latest progress and review a fresh draft.');
}
function contextToken(owner: OwnerContext, request: Context['request']) {
  return encryptSecret(JSON.stringify({ purpose: 'progress-context', ownerId: owner.userId, expiresAt: Date.now() + TTL, request } satisfies Context));
}
function draftCard(owner: OwnerContext, draft: Draft, assignmentTitle: string, session: { startAt: string; endAt: string }): ProgressDraftCard {
  return { phase: 'draft', kind: draft.kind, draftToken: encryptSecret(JSON.stringify(draft)), expiresAt: new Date(draft.expiresAt).toISOString(),
    assignmentTitle, eventId: draft.request.eventId, startAt: session.startAt, endAt: session.endAt, ...(draft.kind === 'report' ? {
      action: draft.request.action, remainingMinutes: draft.request.remainingMinutes, sessionRevision: draft.request.expectedSessionRevision,
      assignmentFinished: draft.request.assignmentFinished, note: draft.request.note,
    } : {}) };
}

/** Bounded model view. Local UUIDs are never interchangeable with numeric Moodle feed IDs. */
export async function readAgentProgress(owner: OwnerContext, args: Record<string, unknown>) {
  const assignmentId = args.assignmentId === undefined ? undefined : parseOperationId(args.assignmentId);
  const eventId = args.eventId === undefined ? undefined : parseEventId(args.eventId);
  let state = await studyProgressStore.state(owner.userId);
  let refresh: { status: 'cached' | 'fresh' | 'unavailable'; message?: string } = { status: 'cached' };
  const selected = state.links.find(link => link.eventId === eventId && !link.deleted && (!assignmentId || link.assignmentId === assignmentId));
  // General history stays local. Only an owner-linked, explicitly selected event is fetched from Google.
  if (selected) {
    try {
      const observedAt = new Date();
      const event = await calendarServiceFor(owner).readStudyBlock(selected.eventId);
      await syncStudyCalendarRead(owner.userId, [event], observedAt);
      state = await studyProgressStore.state(owner.userId);
      const current = state.links.find(link => link.eventId === event.id && !link.deleted);
      refresh = current?.etag === event.etag && current.startAt === event.startAt && current.endAt === event.endAt
        ? { status: 'fresh' } : { status: 'unavailable', message: 'The session changed during refresh. Read this session again before reporting.' };
    } catch (error) {
      refresh = { status: 'unavailable', message: error instanceof GoogleNotConnectedError
        ? 'Connect Google Calendar to refresh this session before reporting.'
        : error instanceof CalendarServiceError && ['not_found', 'forbidden'].includes(error.code)
          ? 'This session is no longer available as an editable PolyMate block in Google. No new report can be prepared.'
          : 'Session details could not be refreshed. Retry this session-specific progress read before reporting.' };
    }
  }
  const assignments = state.assignments.filter(a => !assignmentId || a.id === assignmentId);
  const links = state.links.filter(l => (!assignmentId || l.assignmentId === assignmentId) && (!eventId || l.eventId === eventId));
  const selectedIds = new Set(eventId ? links.map(l => l.assignmentId) : assignments.map(a => a.id));
  const visibleAssignments = assignments.filter(a => selectedIds.has(a.id)).slice(0, 50);
  const visibleIds = new Set(visibleAssignments.map(a => a.id));
  const sessions = links.filter(l => visibleIds.has(l.assignmentId)).slice(0, 100).map(link => {
    const assignment = state.assignments.find(a => a.id === link.assignmentId)!;
    return { ...link, assignmentTitle: assignment.title,
      contextToken: link.deleted || refresh.status !== 'fresh' ? undefined : contextToken(owner, { eventId: link.eventId, assignmentId: assignment.id,
        expectedAssignmentVersion: assignment.version, expectedSessionRevision: link.sessionRevision, expectedEtag: link.etag }) };
  });
  const sessionIds = new Set(sessions.map(l => l.eventId));
  const reports = state.reports.filter(r => visibleIds.has(r.assignmentId) && (!eventId || r.eventId === eventId)).slice(-30);
  const pending = state.pendingCompletions.filter(r => sessionIds.has(r.eventId)).slice(0, 10).map(request => {
    const assignment = state.assignments.find(a => a.id === request.assignmentId)!;
    return { ...draftCard(owner, { purpose: 'progress-draft', ownerId: owner.userId, expiresAt: Date.now() + TTL, kind: 'report', request }, assignment.title, state.links.find(l => l.eventId === request.eventId)!), recovery: true };
  });
  return { source: 'local-study-progress', assignments: visibleAssignments, sessions, reports, pending, refresh,
    truncated: assignments.length > 50 || links.length > 100,
    guidance: 'General reads are cached history. To prepare a new report, select a linked session and read again with its eventId; a contextToken is issued only after Google and local metadata refresh successfully. Session completion is not assignment completion or Moodle submission. Reports for old revisions are history. Retry saved pending completions using their original recovery cards, not a new report.' };
}

/** Tools prepare changes; only a same-origin authenticated browser confirmation executes them. */
export async function prepareAgentReport(owner: OwnerContext, args: Record<string, unknown>) {
  if (Object.keys(args).some(key => !['contextToken', 'action', 'remainingMinutes', 'assignmentFinished', 'note'].includes(key))) throw new ContractError('Unsupported progress tool fields.');
  const context = open<Context>(args.contextToken, owner, 'progress-context');
  fresh(context.expiresAt);
  const { contextToken: _token, ...fields } = args;
  void _token;
  const request = parseProgressRequest({ ...context.request, ...fields, clientRequestId: randomUUID() });
  const state = await studyProgressStore.state(owner.userId);
  const assignment = state.assignments.find(a => a.id === request.assignmentId);
  const session = state.links.find(l => l.eventId === request.eventId && !l.deleted);
  if (!assignment || !session) throw new ContractError('Linked assignment/session not found. Read the latest progress.');
  if (assignment.version !== request.expectedAssignmentVersion || session.sessionRevision !== request.expectedSessionRevision || session.etag !== request.expectedEtag) throw new ContractError('The assignment or session changed. Read the latest progress before preparing a report.');
  return draftCard(owner, { purpose: 'progress-draft', ownerId: owner.userId, expiresAt: Date.now() + TTL, kind: 'report', request }, assignment.title, session);
}

export async function prepareAgentLink(owner: OwnerContext, args: Record<string, unknown>, event: { id: string; etag: string; editable: boolean; source: string; startAt: string; endAt: string } | undefined) {
  const assignmentId = parseOperationId(args.assignmentId);
  const eventId = parseEventId(args.eventId);
  if (!event || event.id !== eventId || !event.editable || event.source !== 'polymate') throw new ContractError('First read the existing editable PolyMate block with polymate_get_calendar.');
  const state = await studyProgressStore.state(owner.userId);
  const assignment = state.assignments.find(a => a.id === assignmentId);
  if (!assignment || ['completed', 'cancelled'].includes(assignment.status)) throw new ContractError('Select an open local assignment from polymate_get_study_progress.');
  const request = parseLinkRequest({ eventId, assignmentId, expectedAssignmentVersion: assignment.version, expectedEtag: event.etag });
  return draftCard(owner, { purpose: 'progress-draft', ownerId: owner.userId, expiresAt: Date.now() + TTL, kind: 'link', request }, assignment.title, event);
}

export async function confirmAgentProgress(owner: OwnerContext, token: unknown, confirmAssignmentFinished = false) {
  const draft = open<Draft>(token, owner, 'progress-draft');
  const progress = studyProgressServiceFor(owner);
  if (draft.kind === 'link') {
    fresh(draft.expiresAt);
    const link = await progress.link(parseLinkRequest(draft.request));
    return { phase: 'saved' as const, kind: 'link' as const, link };
  }
  const request = parseProgressRequest(draft.request);
  if (request.assignmentFinished && confirmAssignmentFinished !== true) throw new ContractError('Explicitly confirm that the entire assignment is finished.');
  // An expired reference may replay an already persisted report, never start a new one.
  if (draft.expiresAt <= Date.now() && !await studyProgressStore.attempt(owner.userId, request.clientRequestId)) fresh(draft.expiresAt);
  const receipt = await progress.record(request);
  return { phase: 'saved' as const, kind: 'report' as const, receipt };
}
