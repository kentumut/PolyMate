import { describe, expect, it, vi } from 'vitest';
import { MoodleClient, MOODLE_FUNCTIONS } from '../packages/core/integrations/moodle/client';

const token = 'a'.repeat(32);
function fixtureFetcher(overrides: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    core_webservice_get_site_info: { userid: 7, functions: MOODLE_FUNCTIONS.map(name => ({ name })) },
    core_enrol_get_users_courses: [{ id: 3, fullname: 'Analysis' }],
    mod_assign_get_assignments: { courses: [{ id: 3, assignments: [
      { id: 9, cmid: 12, name: 'Sheet', intro: '<p>Prove <b>the theorem</b></p>', duedate: 1791806400, allowsubmissionsfromdate: 0 },
    ] }], warnings: [] },
    mod_forum_get_forums_by_courses: [{ id: 5, course: 3, type: 'news' }, { id: 6, course: 3, type: 'general' }],
    mod_forum_get_forum_discussions: { discussions: [{ discussion: 23, subject: 'Exam date', message: '<script>evil()</script><p>Friday</p>', created: 1791620000 }], warnings: [] },
    mod_assign_get_submission_status: { lastattempt: { submission: { status: 'submitted' }, extensionduedate: 1791892800 } },
    ...overrides,
  };
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body));
    return Response.json(data[body.get('wsfunction')!]);
  });
}

describe('Moodle REST reader', () => {
  it('retrieves enrolled-course assignments and only announcement forums, with safe source URLs', async () => {
    const fetcher = fixtureFetcher();
    const client = new MoodleClient('https://moodle.test', token, fetcher);
    const snapshot = await client.snapshot();
    expect(snapshot.assignments[0]).toMatchObject({ id: 9, description: 'Prove the theorem', sourceUrl: 'https://moodle.test/mod/assign/view.php?id=12', opensAt: null });
    expect(snapshot.announcements).toHaveLength(1);
    expect(snapshot.announcements[0]).toMatchObject({ id: 23, text: 'Friday', sourceUrl: 'https://moodle.test/mod/forum/discuss.php?d=23' });
    expect(snapshot.warnings).toEqual([]);
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).not.toContain(token);
      expect(init?.redirect).toBe('error');
      expect(new URLSearchParams(String(init?.body)).get('wstoken')).toBe(token);
    }
    expect(await client.assignmentStatus(9)).toMatchObject({ submitted: true, extensionDueAt: '2026-10-13T12:00:00.000Z' });
  });

  it('reports partial announcement access and does not lose assignment results', async () => {
    const client = new MoodleClient('https://moodle.test', token, fixtureFetcher({ mod_forum_get_forum_discussions: { exception: 'denied', message: `secret ${token}` } }));
    const snapshot = await client.snapshot();
    expect(snapshot.assignments).toHaveLength(1);
    expect(snapshot.warnings[0]).toContain('incomplete');
    expect(JSON.stringify(snapshot)).not.toContain(token);
  });

  it('redacts upstream errors and rejects malformed IDs and unsafe site URLs', async () => {
    const client = new MoodleClient('https://moodle.test', token, fixtureFetcher({ core_webservice_get_site_info: { exception: 'invalidtoken', message: token } }));
    await expect(client.connect()).rejects.toThrow('Moodle denied access');
    await expect(new MoodleClient('https://moodle.test', token, fixtureFetcher({ core_enrol_get_users_courses: [{ id: '3', fullname: 'Course' }] })).snapshot()).rejects.toThrow('invalid ID');
    expect(() => new MoodleClient('http://moodle.test', token)).toThrow('HTTPS');
    expect(() => new MoodleClient('https://user:password@moodle.test', token)).toThrow('HTTPS');
  });

  it('recognizes completed group submissions and preserves assignments awaiting member confirmation', async () => {
    const complete = new MoodleClient('https://moodle.test', token, fixtureFetcher({ mod_assign_get_submission_status: {
      lastattempt: { teamsubmission: { status: 'submitted' }, submissiongroupmemberswhoneedtosubmit: [], extensionduedate: 0 },
    } }));
    expect(await complete.assignmentStatus(9)).toEqual({ submitted: true, extensionDueAt: null });
    const waiting = new MoodleClient('https://moodle.test', token, fixtureFetcher({ mod_assign_get_submission_status: {
      lastattempt: { teamsubmission: { status: 'submitted' }, submissiongroupmemberswhoneedtosubmit: [7], extensionduedate: 0 },
    } }));
    expect((await waiting.assignmentStatus(9)).submitted).toBe(false);
  });
});
