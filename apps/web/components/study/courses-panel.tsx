'use client';

import type { Course, ExamPrepPriority } from '@polymate/contracts/courses';
import { CalendarClock, Clock3, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { DEMO_COURSES } from '@/lib/demo-fixtures';

const sampleCourses: Course[] = DEMO_COURSES;

type FormState = Omit<Course, 'examPrep'> & { examPrep: Record<ExamPrepPriority, string> };
const blank = (): FormState => ({ id: crypto.randomUUID(), name: '', exerciseSessionCount: 0, lectureHoursPerWeek: 0, exerciseSessionMinutes: 90,
  examDate: '', version: 0, examPrep: { must: '', optional: '', not_required: '' } });
const toForm = (course: Course): FormState => ({ ...course, examPrep: {
  must: course.examPrep.must.join('\n'), optional: course.examPrep.optional.join('\n'), not_required: course.examPrep.not_required.join('\n'),
} });
const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);
const inputClass = 'mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30';
const examDate = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`));

export function CoursesPanel({ sample }: { sample: boolean }) {
  const [courses, setCourses] = useState<Course[]>(sample ? sampleCourses : []);
  const [form, setForm] = useState<FormState>(() => blank());
  const [editing, setEditing] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
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

  function reset() { setForm(blank()); setEditing(false); setFormOpen(false); setNotice(''); }

  function revealEditor() {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      document.getElementById('course-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  function startNew() { setForm(blank()); setEditing(false); setFormOpen(true); setNotice(''); revealEditor(); }

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

  const totalLectureHours = courses.reduce((sum, course) => sum + course.lectureHoursPerWeek, 0);
  const nextExam = [...courses].sort((a, b) => a.examDate.localeCompare(b.examDate))[0];

  return <div className="space-y-5">
    <section className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-lg font-semibold">Course context</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Tell PolyMate how much work each course takes and what matters for the exam. This context informs Chat without adding calendar events.</p></div>
      <Button type="button" onClick={startNew}><Plus aria-hidden="true" /> Add course</Button>
    </section>

    <dl className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border bg-card p-4"><dt className="text-xs text-muted-foreground">Tracked courses</dt><dd className="mt-1 text-2xl font-semibold">{courses.length}</dd></div>
      <div className="rounded-xl border bg-card p-4"><dt className="text-xs text-muted-foreground">Lectures each week</dt><dd className="mt-1 text-2xl font-semibold">{totalLectureHours}<span className="ml-1 text-sm font-normal text-muted-foreground">hours</span></dd></div>
      <div className="rounded-xl border bg-card p-4"><dt className="text-xs text-muted-foreground">Next exam</dt><dd className="mt-1 text-sm font-semibold">{nextExam ? nextExam.name : 'Nothing scheduled'}</dd>{nextExam && <p className="mt-1 text-xs text-muted-foreground">{examDate(nextExam.examDate)}</p>}</div>
    </dl>

    {formOpen && <form id="course-editor" onSubmit={save} className="scroll-mt-20 rounded-xl border bg-card shadow-sm md:scroll-mt-4">
      <div className="flex items-start justify-between gap-4 border-b px-5 py-4"><div><h2 className="font-semibold">{editing ? `Edit ${form.name}` : 'Add a course'}</h2><p className="mt-1 text-sm text-muted-foreground">Workload first, then exam scope.</p></div><Button type="button" size="icon" variant="ghost" onClick={reset} aria-label="Close course editor"><X aria-hidden="true" /></Button></div>
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <label className="block text-sm font-medium">Course name<input required maxLength={120} className={inputClass} value={form.name} onChange={event => setForm(previous => ({ ...previous, name: event.target.value }))} /></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Exercise sessions<input required type="number" min={0} max={200} className={inputClass} value={form.exerciseSessionCount} onChange={event => setForm(previous => ({ ...previous, exerciseSessionCount: Number(event.target.value) }))} /></label><label className="text-sm font-medium">Minutes / session<input required type="number" min={0} max={1440} className={inputClass} value={form.exerciseSessionMinutes} onChange={event => setForm(previous => ({ ...previous, exerciseSessionMinutes: Number(event.target.value) }))} /></label></div>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Lecture hours / week<input required type="number" min={0} max={60} step="0.5" className={inputClass} value={form.lectureHoursPerWeek} onChange={event => setForm(previous => ({ ...previous, lectureHoursPerWeek: Number(event.target.value) }))} /></label><label className="text-sm font-medium">Exam date<input required type="date" className={inputClass} value={form.examDate} onChange={event => setForm(previous => ({ ...previous, examDate: event.target.value }))} /></label></div>
        </div>
        <div><p className="text-sm font-medium">Exam preparation</p><p className="mt-1 text-xs text-muted-foreground">One topic per line. PolyMate uses these priorities when suggesting study work.</p><div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="block text-sm font-medium">Must solve<textarea rows={6} maxLength={30000} className={inputClass} value={form.examPrep.must} onChange={event => setForm(previous => ({ ...previous, examPrep: { ...previous.examPrep, must: event.target.value } }))} placeholder={'Core exercise sheets\nPast exams'} /></label>
          <label className="block text-sm font-medium">Optional<textarea rows={6} maxLength={30000} className={inputClass} value={form.examPrep.optional} onChange={event => setForm(previous => ({ ...previous, examPrep: { ...previous.examPrep, optional: event.target.value } }))} /></label>
          <label className="block text-sm font-medium">Not required<textarea rows={6} maxLength={30000} className={inputClass} value={form.examPrep.not_required} onChange={event => setForm(previous => ({ ...previous, examPrep: { ...previous.examPrep, not_required: event.target.value } }))} /></label>
        </div></div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4"><div>{error && <p role="alert" className="text-sm text-destructive">{error} <button type="button" className="underline" onClick={() => setReloadKey(value => value + 1)}>Refresh</button></p>}{notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}</div><div className="flex gap-2"><Button type="button" variant="outline" onClick={reset}>Cancel</Button><Button disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add course'}</Button></div></div>
    </form>}

    {loading && <p role="status" className="text-sm text-muted-foreground">Loading courses…</p>}
    {!formOpen && error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error} <button type="button" className="underline" onClick={() => setReloadKey(value => value + 1)}>Refresh</button></p>}
    {!formOpen && notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}

    {!loading && courses.length > 0 && <section><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Your courses</h2><p className="text-xs text-muted-foreground">{courses.length} in Chat context</p></div><div className="grid gap-4 xl:grid-cols-2">
      {courses.map(course => <article key={course.id} className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold sm:truncate">{course.name}</h3><p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClock className="size-3.5 shrink-0" aria-hidden="true" /> Exam {examDate(course.examDate)}</p></div><div className="flex shrink-0 gap-1"><Button type="button" size="icon" variant="ghost" disabled={busy} onClick={() => { setForm(toForm(course)); setEditing(true); setFormOpen(true); setNotice(''); revealEditor(); }} aria-label={`Edit ${course.name}`}><Pencil aria-hidden="true" /></Button><Button type="button" size="icon" variant="ghost" disabled={busy} onClick={() => void remove(course)} aria-label={`Remove ${course.name}`} className="text-muted-foreground hover:text-destructive"><Trash2 aria-hidden="true" /></Button></div></div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-y py-3 text-xs"><span className="flex items-center gap-1.5"><Clock3 className="size-3.5 text-muted-foreground" /> {course.lectureHoursPerWeek} lecture h/week</span><span>{course.exerciseSessionCount} exercise sessions</span><span>{course.exerciseSessionMinutes} min each</span></div>
        <div className="mt-4 space-y-3">{(['must','optional','not_required'] as const).map(priority => <div key={priority} className="grid grid-cols-[6rem_1fr] gap-3 text-sm"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{priority === 'not_required' ? 'Skip' : priority}</p>{course.examPrep[priority].length ? <p className="line-clamp-2">{course.examPrep[priority].join(' · ')}</p> : <p className="text-muted-foreground">—</p>}</div>)}</div>
      </article>)}
    </div></section>}

    {!loading && !courses.length && <section className="rounded-xl border border-dashed p-10 text-center"><h2 className="font-semibold">Add your first course</h2><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">A course profile gives Chat concrete workload and exam-priority context.</p><Button type="button" onClick={startNew} className="mt-4"><Plus /> Add course</Button></section>}
  </div>;
}
