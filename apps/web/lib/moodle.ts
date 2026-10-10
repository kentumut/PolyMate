import { ContractError } from '@polymate/contracts/calendar';
import type { AssignmentTimeline } from '@polymate/contracts/moodle';
import { MoodleClient, MoodleError, MOODLE_FUNCTIONS } from '@polymate/core/moodle';
import { MoodleAgentTools } from '@polymate/core/moodle/tools';
import { decryptSecret, encryptSecret } from '@polymate/core/google-auth/crypto';
import { assertSameOrigin, IdentityError, resolveOwner, type OwnerContext } from '@polymate/core/identity';
import { NextResponse, type NextRequest } from 'next/server';
import { calendarError, calendarServiceFor } from './calendar-route';
import { MoodleCalendarFeed, parseMoodleFeedUrl } from '@polymate/core/moodle/calendar-feed';
import { readBoundedText } from '@polymate/core/agent/http';
import type { MoodleReader, MoodleSnapshot } from '@polymate/contracts/moodle';
import { findCalendarSubscription, saveCalendarSubscription, updateCalendarSnapshot, deleteCalendarSubscription } from './moodle-calendar-store';

const COOKIE = 'polymate_moodle';
const TTL = 8 * 60 * 60;
const NO_STORE = { 'Cache-Control': 'no-store' };
const site = () => process.env.MOODLE_SITE_URL ?? 'https://moodle-app2.let.ethz.ch';
type Connection = { ownerId: string; site: string; token: string; expiresAt: number };

export function connectionFor(request: NextRequest, owner: OwnerContext): Connection {
  try {
    const sealed = request.cookies.get(COOKIE)?.value;
    if (!sealed) throw new Error();
    const connection: Connection = JSON.parse(decryptSecret(sealed));
    if (connection.ownerId !== owner.userId || connection.expiresAt <= Date.now() || connection.site !== site()) throw new Error();
    return connection;
  } catch { throw new MoodleError('not_connected', 'Connect Moodle with your web-service token.'); }
}

export function moodleError(error: unknown): Response {
  if (error instanceof MoodleError) return Response.json({ error: { code: error.code, message: error.message } }, {
    status: error.code === 'not_connected' ? 409 : error.code === 'access_denied' ? 403 : 502, headers: NO_STORE,
  });
  return calendarError(error);
}

export async function moodleBody(request: NextRequest): Promise<Record<string, unknown>> {
  assertSameOrigin(request);
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ContractError('Send JSON.');
  if (Number(request.headers.get('content-length')) > 200000) throw new ContractError('Request is too large.');
  let raw: string;
  try { raw = await readBoundedText(request.body, 200000); } catch { throw new ContractError('Request is too large or incomplete.'); }
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new ContractError('Send valid JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ContractError('Send a JSON object.');
  return data as Record<string, unknown>;
}

export async function connectMoodle(request: NextRequest): Promise<Response> {
  try {
    const owner = resolveOwner(request.headers);
    const body = await moodleBody(request);
    if ('subscriptionUrl' in body) {
      if (Object.keys(body).some(key => key !== 'subscriptionUrl')) throw new ContractError('Send only the Moodle subscription URL.');
      const url = parseMoodleFeedUrl(body.subscriptionUrl, site());
      const snapshot = await new MoodleCalendarFeed(site(), url).snapshot();
      await saveCalendarSubscription(owner, { site: site(), url, snapshot });
      const response = NextResponse.json({ connected: true, mode: 'calendar-subscription', lastSyncedAt: snapshot.fetchedAt, eventCount: snapshot.calendarEvents?.length ?? 0, snapshot }, { headers: NO_STORE });
      response.cookies.set(COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV !== 'development', sameSite: 'strict', path: '/api', maxAge: 0 });
      return response;
    }
    if (typeof body.token !== 'string') throw new ContractError('Provide a Moodle web-service token.');
    const client = new MoodleClient(site(), body.token);
    const info = await client.connect();
    const missing = MOODLE_FUNCTIONS.filter(name => !info.availableFunctions.includes(name));
    if (missing.some(name => !name.startsWith('mod_forum_'))) throw new MoodleError('access_denied', `Enable Moodle functions: ${missing.join(', ')}.`);
    const connection: Connection = { ownerId: owner.userId, site: site(), token: body.token, expiresAt: Date.now() + TTL * 1000 };
    const response = NextResponse.json({ connected: true, site: site(), expiresAt: new Date(connection.expiresAt).toISOString(), missingFunctions: missing }, { headers: NO_STORE });
    response.cookies.set(COOKIE, encryptSecret(JSON.stringify(connection)), {
      httpOnly: true, secure: process.env.NODE_ENV !== 'development', sameSite: 'strict', path: '/api', maxAge: TTL,
    });
    return response;
  } catch (error) { return moodleError(error); }
}

export async function moodleStatus(request: NextRequest): Promise<Response> {
  try {
    const owner = resolveOwner(request.headers);
    const subscription = await findCalendarSubscription(owner.userId);
    if (subscription && subscription.site === site()) return Response.json({ connected: true, mode: 'calendar-subscription', lastSyncedAt: subscription.lastSyncedAt, eventCount: subscription.snapshot.calendarEvents?.length ?? 0 }, { headers: NO_STORE });
    try {
      const connection = connectionFor(request, owner);
      return Response.json({ connected: true, site: connection.site, expiresAt: new Date(connection.expiresAt).toISOString() }, { headers: NO_STORE });
    } catch (error) {
      if (!(error instanceof MoodleError)) throw error;
      return Response.json({ connected: false }, { headers: NO_STORE });
    }
  } catch (error) { return moodleError(error); }
}

export async function disconnectMoodle(request: NextRequest): Promise<Response> {
  try {
    const owner = resolveOwner(request.headers); assertSameOrigin(request);
    await deleteCalendarSubscription(owner.userId);
    const response = NextResponse.json({ connected: false }, { headers: NO_STORE });
    response.cookies.set(COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV !== 'development', sameSite: 'strict', path: '/api', maxAge: 0 });
    return response;
  } catch (error) { return moodleError(error); }
}

export async function moodleConnectionAvailable(ownerId: string): Promise<boolean> {
  const subscription = await findCalendarSubscription(ownerId);
  return Boolean(subscription && subscription.site === site());
}

/** Resolves background authorization from the server-owned registration, never from cookies or model arguments. */
export async function calendarSnapshotForOwner(ownerId: string, force = false, connectionId?: string): Promise<MoodleSnapshot> {
  const subscription = await findCalendarSubscription(ownerId);
  if (!subscription || subscription.site !== site()) throw new MoodleError('not_connected', 'Connect your Moodle calendar subscription first.');
  if (connectionId && subscription.connectionId !== connectionId) throw new ContractError('The Moodle calendar connection changed. Generate a fresh draft.');
  if (!force && Date.now() - Date.parse(subscription.lastSyncedAt) < 5 * 60_000) return subscription.snapshot;
  let url: string;
  try { url = decryptSecret(subscription.urlCiphertext); } catch { throw new MoodleError('not_connected', 'Reconnect your Moodle calendar subscription.'); }
  const snapshot = await new MoodleCalendarFeed(subscription.site, url).snapshot();
  const current = await findCalendarSubscription(ownerId);
  if (current?.connectionId !== subscription.connectionId) throw new ContractError('The Moodle calendar connection changed during refresh. Try again.');
  await updateCalendarSnapshot(ownerId, subscription.connectionId, snapshot);
  return snapshot;
}

export async function readMoodleCalendar(request: NextRequest, force = false): Promise<Response> {
  try {
    const owner = resolveOwner(request.headers);
    if (force) assertSameOrigin(request);
    const snapshot = await calendarSnapshotForOwner(owner.userId, force);
    return Response.json({ snapshot }, { headers: NO_STORE });
  } catch (error) { return moodleError(error); }
}

/** Call this from the future main agent with the original authenticated request; never pass a token to the model. */
export async function executeMoodleTool(request: NextRequest, name: string, args: Record<string, unknown>): Promise<unknown> {
  const owner = resolveOwner(request.headers);
  const subscription = await findCalendarSubscription(owner.userId);
  if (subscription && subscription.site === site()) {
    if (name === 'moodle_get_calendar_events' || name === 'moodle_get_assignments_and_announcements') return calendarSnapshotForOwner(owner.userId);
    const reader: MoodleReader = { snapshot: () => calendarSnapshotForOwner(owner.userId, true, subscription.connectionId), assignmentStatus: async () => ({ submitted: null, extensionDueAt: null }) };
    const tools = new MoodleAgentTools(owner.userId, reader, calendarServiceFor(owner));
    if (name === 'moodle_plan_assignment_timeline') {
      const timeline = await tools.planAssignments(args), expiresAt = Date.now() + 30 * 60_000;
      const planToken = encryptSecret(JSON.stringify({ ownerId: owner.userId, site: site(), connectionId: subscription.connectionId, expiresAt, timeline }));
      return { timeline, planToken, expiresAt: new Date(expiresAt).toISOString() };
    }
    if (name === 'moodle_schedule_assignment_timeline') {
      if (typeof args.planToken !== 'string' || args.planToken.length > 180000 || (args.allowPartial !== undefined && typeof args.allowPartial !== 'boolean')) throw new ContractError('Use the generated planToken and optional partial-plan choice.');
      let plan: { ownerId: string; site: string; connectionId: string; expiresAt: number; timeline: AssignmentTimeline };
      try { plan = JSON.parse(decryptSecret(args.planToken)); } catch { throw new ContractError('Invalid timeline token. Generate a fresh draft.'); }
      if (plan.ownerId !== owner.userId || plan.site !== site() || plan.connectionId !== subscription.connectionId) throw new IdentityError('This timeline belongs to a different calendar connection.', 403);
      if (!Number.isFinite(plan.expiresAt) || plan.expiresAt <= Date.now()) throw new ContractError('Timeline expired. Generate a new timeline.');
      return tools.scheduleTimeline(plan.timeline, args.allowPartial === true);
    }
    throw new ContractError('Unknown Moodle tool.');
  }
  if (name === 'moodle_get_calendar_events') throw new MoodleError('not_connected', 'Connect your Moodle calendar subscription first.');
  const connection = connectionFor(request, owner);
  const client = new MoodleClient(connection.site, connection.token);
  if (name === 'moodle_get_assignments_and_announcements') return client.snapshot();
  const tools = new MoodleAgentTools(owner.userId, client, calendarServiceFor(owner));
  if (name === 'moodle_plan_assignment_timeline') {
    const timeline = await tools.planAssignments(args);
    const expiresAt = Math.min(Date.now() + 30 * 60000, connection.expiresAt);
    // Encrypt + authenticate the exact draft so the model cannot invent assignments or calendar writes.
    const planToken = encryptSecret(JSON.stringify({ ownerId: owner.userId, site: connection.site, expiresAt, timeline }));
    return { timeline, planToken, expiresAt: new Date(expiresAt).toISOString() };
  }
  if (name === 'moodle_schedule_assignment_timeline') {
    if (typeof args.planToken !== 'string' || args.planToken.length > 180000 || (args.allowPartial !== undefined && typeof args.allowPartial !== 'boolean')) {
      throw new ContractError('Provide the generated planToken and an optional boolean allowPartial.');
    }
    let plan: { ownerId: string; site: string; expiresAt: number; timeline: AssignmentTimeline };
    try { plan = JSON.parse(decryptSecret(args.planToken)); } catch { throw new ContractError('Invalid timeline token. Generate a new timeline.'); }
    if (plan.ownerId !== owner.userId || plan.site !== connection.site) throw new IdentityError('This timeline belongs to a different connection.', 403);
    if (!plan.expiresAt || plan.expiresAt <= Date.now()) throw new ContractError('Timeline expired. Generate a new timeline.');
    return tools.scheduleTimeline(plan.timeline, args.allowPartial === true);
  }
  throw new ContractError('Unknown Moodle tool.');
}
