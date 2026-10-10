import { describe, expect, it, vi } from 'vitest';
import { parseVvzCourseDetailsRequest, parseVvzSearchRequest, VvzClient, VvzError } from '../packages/core/integrations/vvz/client';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const unit = {
  id: 204421, semkez: '2026W', number: '263-3713-00L', title: 'Menschzentrierte Computer Vision',
  title_english: 'Human-Centric Computer Vision', credits: 2, language: 'English', levels: ['BSC', 'MSC'],
  exam_type: 'graded semester performance', exam_mode: 'oral', exam_language: 'English', written_aids: null,
  priority: 'Registration restricted', comment_english: 'Does not take place this semester.', abstract_english: 'Course abstract.',
  objective_english: 'Course objective.', content_english: 'Course content.', literature_english: 'Course literature.',
  additional_english: 'Additional notes.', primary_target_group: ['Computer Science MSc'], repetition: 'Re-enrolment required.',
  scraped_at: 1_789_870_160,
};

describe('VVZ API client', () => {
  it('validates structured searches and exact detail lookups', () => {
    expect(parseVvzSearchRequest({ semester: '2026W', title: 'vision' })).toMatchObject({ semester: '2026W', title: 'vision', limit: 8, offset: 0 });
    expect(parseVvzCourseDetailsRequest({ unitId: 204421 })).toEqual({ unitId: 204421 });
    expect(() => parseVvzSearchRequest({})).toThrow('at least one');
    expect(() => parseVvzSearchRequest({ semester: 'HS2026' })).toThrow('2026W');
    expect(() => parseVvzSearchRequest({ title: 'vision', minCredits: 8, maxCredits: 2 })).toThrow('cannot exceed');
    expect(() => parseVvzCourseDetailsRequest({ unitId: '204421' })).toThrow('positive VVZ unitId');
  });

  it('searches stable v1 endpoints and returns compact, attributed summaries', async () => {
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (url.pathname === '/api/v1/unit/list') {
        expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '2', offset: '0', semkez: '2026W', title: 'vision', ects_min: '2' });
        return json([204421]);
      }
      if (url.pathname === '/api/v1/unit/204421/get') return json(unit);
      return json({}, 404);
    });
    const result = await new VvzClient(fetcher).searchCourses({ semester: '2026W', title: 'vision', minCredits: 2, limit: 2 });
    expect(result).toMatchObject({
      courses: [{ id: 204421, semester: '2026W', title: 'Human-Centric Computer Vision', credits: 2, restricted: true }],
      nextOffset: null,
      source: { official: false },
    });
    expect(result.courses[0].officialVvzUrl).toContain('lerneinheitId=204421');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('enriches one course with occurrences, timeslots, and lecturers', async () => {
    const fetcher = vi.fn<typeof fetch>(async input => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/unit/204421/get') return json(unit);
      if (path === '/api/v1/course/get/204421') return json([{ number: '263-3713-00 S', title: 'Seminar', type: 'seminar', hours: 2,
        comment: null, timeslots: [{ weekday: 'Tuesday', date: null, start_time: '10:15', end_time: '12:00', building: 'CAB', floor: 'G', room: '11', first_half_semester: false, second_half_semester: false, biweekly: false }] }]);
      if (path === '/api/v1/unit/204421/lecturers') return json([91]);
      if (path === '/api/v1/lecturer/get/91') return json({ id: 91, name: 'Ada', surname: 'Lovelace', title: 'Prof.', department: 'Computer Science' });
      return json({}, 404);
    });
    const result = await new VvzClient(fetcher).getCourseDetails({ unitId: 204421 });
    expect(result).toMatchObject({ id: 204421, abstract: 'Course abstract.', examMode: 'oral',
      courses: [{ number: '263-3713-00 S', timeslots: [{ weekday: 'Tuesday', building: 'CAB', room: '11' }] }],
      lecturers: [{ id: 91, name: 'Ada', surname: 'Lovelace' }], source: { official: false } });
  });

  it('keeps course details usable when VVZ cannot resolve one of its lecturer IDs', async () => {
    const fetcher = vi.fn<typeof fetch>(async input => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/v1/unit/204421/get') return json(unit);
      if (path === '/api/v1/course/get/204421') return json([]);
      if (path === '/api/v1/unit/204421/lecturers') return json([91]);
      if (path === '/api/v1/lecturer/get/91') return json(null);
      return json({}, 404);
    });
    await expect(new VvzClient(fetcher).getCourseDetails({ unitId: 204421 })).resolves.toMatchObject({
      lecturerIds: [91], lecturers: [], lecturerDetailsComplete: false,
    });
  });

  it('rejects unavailable and malformed upstream results without exposing response bodies', async () => {
    await expect(new VvzClient(async () => json({ private: 'upstream detail' }, 503)).searchCourses({ title: 'vision' }))
      .rejects.toMatchObject({ code: 'unavailable', message: 'VVZ API did not accept the request.' });
    await expect(new VvzClient(async () => json(['bad-id'])).searchCourses({ title: 'vision' }))
      .rejects.toBeInstanceOf(VvzError);
    await expect(new VvzClient(async () => new Response('not json')).searchCourses({ title: 'vision' }))
      .rejects.toMatchObject({ code: 'invalid_response' });
  });
});
