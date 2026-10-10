import { ContractError } from '@polymate/contracts/calendar';
import type { AssignmentStatus, MoodleAssignment, MoodleReader, MoodleSnapshot } from '@polymate/contracts/moodle';

export class MoodleError extends Error {
  constructor(readonly code: 'not_connected' | 'access_denied' | 'unavailable' | 'invalid_response', message: string) {
    super(message); this.name = 'MoodleError';
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MoodleError('invalid_response', 'Moodle returned an invalid object.');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new MoodleError('invalid_response', 'Moodle returned an invalid list.');
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new MoodleError('invalid_response', 'Moodle returned an invalid ID.');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new MoodleError('invalid_response', 'Moodle returned invalid text.');
  // Return inert text, not Moodle HTML or attachment URLs containing credentials.
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim().slice(0, 12000);
}
function timestamp(value: unknown): string | null {
  if (value === 0 || value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 253402300799) {
    throw new MoodleError('invalid_response', 'Moodle returned an invalid timestamp.');
  }
  return new Date(value * 1000).toISOString();
}

export const MOODLE_FUNCTIONS = [
  'core_webservice_get_site_info', 'core_enrol_get_users_courses', 'mod_assign_get_assignments',
  'mod_assign_get_submission_status', 'mod_forum_get_forums_by_courses', 'mod_forum_get_forum_discussions',
] as const;

/** Server-only. The site is administrator configured, never supplied by a browser or model. */
export class MoodleClient implements MoodleReader {
  private readonly site: string;
  constructor(site: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(site);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new ContractError('Moodle needs a configured HTTPS site URL.');
    this.site = url.href.replace(/\/$/, '');
    if (!/^[A-Za-z0-9]{16,256}$/.test(token)) throw new ContractError('Invalid Moodle web-service token.');
  }

  private async call(name: typeof MOODLE_FUNCTIONS[number], parameters: Record<string, string> = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.site}/webservice/rest/server.php`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ wstoken: this.token, wsfunction: name, moodlewsrestformat: 'json', ...parameters }),
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      });
    } catch { throw new MoodleError('unavailable', 'Moodle is unavailable. Try again shortly.'); }
    if (!response.ok) throw new MoodleError('unavailable', 'Moodle did not accept the request.');
    let data: unknown;
    try { data = await response.json(); } catch { throw new MoodleError('invalid_response', 'Moodle did not return JSON.'); }
    if (data && !Array.isArray(data) && typeof data === 'object' && 'exception' in data) {
      // Upstream errors can contain secrets; never return their raw message/debug fields.
      throw new MoodleError('access_denied', 'Moodle denied access. Check the token and enabled web-service functions.');
    }
    return data;
  }

  async connect(): Promise<{ userId: number; availableFunctions: string[] }> {
    const info = object(await this.call('core_webservice_get_site_info'));
    return { userId: integer(info.userid), availableFunctions: array(info.functions).map(f => text(object(f).name)) };
  }

  async snapshot(): Promise<MoodleSnapshot> {
    const { userId, availableFunctions } = await this.connect();
    const warnings: string[] = [];
    const rawCourses = array(await this.call('core_enrol_get_users_courses', { userid: String(userId) }));
    if (rawCourses.length > 50) warnings.push('Only the first 50 enrolled courses were retrieved.');
    const courses = rawCourses.slice(0, 50).map(value => {
      const c = object(value); return { id: integer(c.id), name: text(c.fullname) };
    });
    const parameters = Object.fromEntries(courses.map((c, i) => [`courseids[${i}]`, String(c.id)]));
    const assignments: MoodleAssignment[] = [];
    if (courses.length) {
      const result = object(await this.call('mod_assign_get_assignments', parameters));
      if (array(result.warnings ?? []).length) warnings.push('Moodle reported assignment retrieval warnings; some records may be missing.');
      for (const raw of array(result.courses)) {
        const c = object(raw); const course = courses.find(course => course.id === c.id);
        if (!course) continue;
        for (const value of array(c.assignments)) {
          const a = object(value);
          assignments.push({ id: integer(a.id), courseId: course.id, courseName: course.name,
            title: text(a.name), description: text(a.intro), dueAt: timestamp(a.duedate), opensAt: timestamp(a.allowsubmissionsfromdate),
            sourceUrl: `${this.site}/mod/assign/view.php?id=${integer(a.cmid)}` });
        }
      }
    }
    const announcements: MoodleSnapshot['announcements'] = [];
    if (courses.length && availableFunctions.includes('mod_forum_get_forums_by_courses') && availableFunctions.includes('mod_forum_get_forum_discussions')) {
      try {
        const forums = array(await this.call('mod_forum_get_forums_by_courses', parameters));
        const news = forums.map(object).filter(f => f.type === 'news' && courses.some(c => c.id === f.course));
        if (news.length > 100) warnings.push('Only the first 100 announcement forums were retrieved.');
        for (const forum of news.slice(0, 100)) {
          for (let page = 0; page < 10; page++) {
            const result = object(await this.call('mod_forum_get_forum_discussions', { forumid: String(integer(forum.id)), page: String(page), perpage: '100' }));
            if (array(result.warnings ?? []).length) warnings.push(`Some announcements in forum ${forum.id} were inaccessible.`);
            const discussions = array(result.discussions);
            for (const value of discussions) {
              const d = object(value);
              announcements.push({ id: integer(d.discussion), courseId: integer(forum.course), title: text(d.subject), text: text(d.message),
                postedAt: timestamp(d.created) ?? '', sourceUrl: `${this.site}/mod/forum/discuss.php?d=${integer(d.discussion)}` });
            }
            if (discussions.length < 100) break;
            if (page === 9) warnings.push(`Announcement history in forum ${forum.id} was truncated at 1000 posts.`);
          }
        }
      } catch (error) {
        if (!(error instanceof MoodleError)) throw error;
        warnings.push('Announcement retrieval was incomplete. Check Moodle forum permissions or try again.');
      }
    } else if (courses.length) warnings.push('Announcements unavailable: enable both Moodle forum web-service functions.');
    return { courses, assignments, announcements, warnings, fetchedAt: new Date().toISOString() };
  }

  async assignmentStatus(assignmentId: number): Promise<AssignmentStatus> {
    const result = object(await this.call('mod_assign_get_submission_status', { assignid: String(integer(assignmentId)) }));
    if (array(result.warnings ?? []).length) throw new MoodleError('access_denied', 'Moodle could not verify assignment submission status.');
    const attempt = result.lastattempt ? object(result.lastattempt) : null;
    const submission = attempt?.submission ? object(attempt.submission) : null;
    const teamSubmission = attempt?.teamsubmission ? object(attempt.teamsubmission) : null;
    const membersStillNeeded = attempt?.submissiongroupmemberswhoneedtosubmit;
    const teamComplete = teamSubmission?.status === 'submitted' && Array.isArray(membersStillNeeded) && membersStillNeeded.length === 0;
    return { submitted: submission?.status === 'submitted' || teamComplete, extensionDueAt: timestamp(attempt?.extensionduedate) };
  }
}
