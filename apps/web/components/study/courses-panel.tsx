'use client';

import type { Course, ExamPrepPriority } from '@polymate/contracts/courses';
import { useEffect, useState, type FormEvent } from 'react';

const sampleCourses: Course[] = [{
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Algorithms and Data Structures', exerciseSessionCount: 12,
  lectureHoursPerWeek: 4, exerciseSessionMinutes: 120, examDate: '2027-01-25', version: 1,
  examPrep: { must: ['Dynamic programming sheets', 'Past exam 2025'], optional: ['Extra graph problems'], not_required: ['Optional coding project'] },
}];

type FormState = Omit<Course, 'examPrep'> & { examPrep: Record<ExamPrepPriority, string> };
const blank = (): FormState => ({ id: crypto.randomUUID(), name: '', exerciseSessionCount: 0, lectureHoursPerWeek: 0, exerciseSessionMinutes: 90,
  examDate: '', version: 0, examPrep: { must: '', optional: '', not_required: '' } });
const toForm = (course: Course): FormState => ({ ...course, examPrep: {
  must: course.examPrep.must.join('\n'), optional: course.examPrep.optional.join('\n'), not_required: course.examPrep.not_required.join('\n'),
} });
const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);
const inputClass = 'mt-1 w-full rounded-lg border border-[#c8d3c8] bg-white px-3 py-2 text-sm outline-none focus:border-[#658071]';

export function CoursesPanel({ sample }: { sample: boolean }) {
  const [courses, setCourses] = useState<Course[]>(sample ? sampleCourses : []);
  const [form, setForm] = useState<FormState>(() => blank());
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(!sample);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (sample) return;
    let current = true;
    fetch('/api/courses', { credentials: 'same-origin', cache: 'no-store' })
      .then(async response => {
        const body = await response.json() as { courses?: Course[]; error?: { message?: string } };
        if (!response.ok || !body.courses) throw new Error(body.error?.message ?? 'Courses could not be loaded.');
        return body.courses;
      })
      .then(next => { if (current) { setCourses(next); setError(''); setLoading(false); } })
      .catch(reason => { if (current) { setError(reason instanceof Error ? reason.message : 'Courses could not be loaded.'); setLoading(false); } });
    return () => { current = false; };
  }, [reloadKey, sample]);

  function reset() { setForm(blank()); setEditing(false); setNotice(''); }

  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const course: Course = { ...form, examPrep: { must: lines(form.examPrep.must), optional: lines(form.examPrep.optional), not_required: lines(form.examPrep.not_required) } };
    if (sample) {
      const saved = { ...course, version: Math.max(1, course.version + 1) };
      setCourses(previous => [...previous.filter(item => item.id !== saved.id), saved].sort((a, b) => a.examDate.localeCompare(b.examDate)));
      reset(); setNotice('Sample course saved.'); return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/courses', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', course }) });
      const body = await response.json() as { courses?: Course[]; error?: { message?: string } };
      if (!response.ok || !body.courses) throw new Error(body.error?.message ?? 'Course could not be saved.');
      setCourses(body.courses); reset(); setNotice('Course saved. PolyMate will use it in future chats.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Course could not be saved.'); }
    finally { setBusy(false); }
  }

  async function remove(course: Course) {
    if (!window.confirm(`Remove ${course.name} from PolyMate course context?`)) return;
    if (sample) { setCourses(previous => previous.filter(item => item.id !== course.id)); if (form.id === course.id) reset(); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/courses', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: course.id, expectedVersion: course.version }) });
      const body = await response.json() as { courses?: Course[]; error?: { message?: string } };
      if (!response.ok || !body.courses) throw new Error(body.error?.message ?? 'Course could not be removed.');
      setCourses(body.courses); if (form.id === course.id) reset(); setNotice('Course removed.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Course could not be removed.'); }
    finally { setBusy(false); }
  }

  return <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,0.75fr)]">
    <section className="space-y-4">
      <div className="rounded-2xl border border-[#dce3db] bg-[#f5f8f2] p-5 sm:p-6"><p className="text-[11px] font-semibold uppercase tracking-widest text-[#658071]">Course context</p><h2 className="mt-2 text-xl font-medium">Give PolyMate the shape of each course</h2><p className="mt-2 text-sm leading-6 text-[#617269]">Course workload and exam priorities become factual context for Chat. They do not create calendar blocks by themselves.</p></div>
      {loading && <p role="status" className="text-sm text-[#617269]">Loading courses…</p>}
      {courses.map(course => <article key={course.id} className="rounded-2xl border border-[#dce3db] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{course.name}</h3><p className="mt-1 text-xs text-[#617269]">Exam {new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', dateStyle: 'long' }).format(new Date(`${course.examDate}T12:00:00Z`))}</p></div><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => { setForm(toForm(course)); setEditing(true); setNotice(''); }} className="rounded-lg border border-[#c8d3c8] px-3 py-1.5 text-xs">Edit</button><button type="button" disabled={busy} onClick={() => void remove(course)} className="px-2 py-1.5 text-xs underline">Remove</button></div></div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-xs text-[#748278]">Exercise sessions</dt><dd className="mt-1 font-medium">{course.exerciseSessionCount}</dd></div><div><dt className="text-xs text-[#748278]">Lectures / week</dt><dd className="mt-1 font-medium">{course.lectureHoursPerWeek} h</dd></div><div><dt className="text-xs text-[#748278]">Per exercise session</dt><dd className="mt-1 font-medium">{course.exerciseSessionMinutes} min</dd></div></dl>
        <div className="mt-4 grid gap-3 md:grid-cols-3">{(['must','optional','not_required'] as const).map(priority => <div key={priority} className="rounded-xl bg-[#f6f7f3] p-3"><p className="text-xs font-semibold uppercase tracking-wider text-[#748278]">{priority === 'not_required' ? 'Not required' : priority}</p>{course.examPrep[priority].length ? <ul className="mt-2 space-y-1 text-sm">{course.examPrep[priority].map(item => <li key={item}>• {item}</li>)}</ul> : <p className="mt-2 text-xs text-[#748278]">Nothing listed</p>}</div>)}</div>
      </article>)}
      {!loading && !courses.length && <p className="rounded-2xl border border-dashed border-[#c8d3c8] p-6 text-sm text-[#617269]">No courses yet. Add the first one using the form.</p>}
    </section>

    <form onSubmit={save} className="sticky top-5 space-y-4 rounded-2xl border border-[#dce3db] bg-white p-5 sm:p-6">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-[#748278]">{editing ? 'Edit course' : 'New course'}</p><h2 className="mt-1 text-lg font-medium">Workload and exam preparation</h2></div>
      <label className="block text-sm">Course name<input required maxLength={120} className={inputClass} value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} /></label>
      <div className="grid grid-cols-2 gap-3"><label className="text-sm">Exercise sessions<input required type="number" min={0} max={200} className={inputClass} value={form.exerciseSessionCount} onChange={event => setForm(previous => ({ ...previous, exerciseSessionCount: Number(event.target.value) }))} /></label><label className="text-sm">Minutes per session<input required type="number" min={0} max={1440} className={inputClass} value={form.exerciseSessionMinutes} onChange={event => setForm(previous => ({ ...previous, exerciseSessionMinutes: Number(event.target.value) }))} /></label></div>
      <div className="grid grid-cols-2 gap-3"><label className="text-sm">Lecture hours / week<input required type="number" min={0} max={60} step="0.5" className={inputClass} value={form.lectureHoursPerWeek} onChange={event => setForm(previous => ({ ...previous, lectureHoursPerWeek: Number(event.target.value) }))} /></label><label className="text-sm">Exam date<input required type="date" className={inputClass} value={form.examDate} onChange={event => setForm(previous => ({ ...previous, examDate: event.target.value }))} /></label></div>
      <p className="text-xs leading-5 text-[#617269]">Add one exam-prep topic per line.</p>
      <label className="block text-sm">Must solve<textarea rows={4} maxLength={30000} className={inputClass} value={form.examPrep.must} onChange={event => setForm(previous => ({ ...previous, examPrep: { ...previous.examPrep, must: event.target.value } }))} placeholder={'Core exercise sheets\nPast exams'} /></label>
      <label className="block text-sm">Optional<textarea rows={3} maxLength={30000} className={inputClass} value={form.examPrep.optional} onChange={event => setForm(previous => ({ ...previous, examPrep: { ...previous.examPrep, optional: event.target.value } }))} /></label>
      <label className="block text-sm">Not required<textarea rows={3} maxLength={30000} className={inputClass} value={form.examPrep.not_required} onChange={event => setForm(previous => ({ ...previous, examPrep: { ...previous.examPrep, not_required: event.target.value } }))} /></label>
      {error && <p role="alert" className="text-sm text-[#9b302b]">{error} <button type="button" className="underline" onClick={() => setReloadKey(value => value + 1)}>Refresh</button></p>}
      {notice && <p role="status" className="text-sm text-[#617269]">{notice}</p>}
      <div className="flex gap-2"><button disabled={busy} className="rounded-xl bg-[#173b32] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save course'}</button>{editing && <button type="button" disabled={busy} onClick={reset} className="rounded-xl border border-[#c8d3c8] px-4 py-2 text-sm">Cancel</button>}</div>
    </form>
  </div>;
}
