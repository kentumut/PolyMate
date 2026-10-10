'use client';

import { useMemo, useState } from 'react';
import { MSC_CS_MAJORS, type MscCsMajor, type MscCsMinor } from '@polymate/core/vvz';
import { MSC_CS_MAJOR_MINOR_COMBINATIONS } from '@polymate/core/vvz/graduation';

type CourseStatus = 'passed' | 'in_progress' | 'planned';
type Course = { id: number; semester: string; number: string | null; title: string | null; credits: number | null; officialVvzUrl: string };
type PlannedCourse = Course & { status: CourseStatus };
type Requirement = { key: string; earned: number; required: number; missing: number; satisfied: boolean };
type Audit = { majorMinorCombinationValid: boolean; completed: { graduationReady: boolean; creditedCredits: number; requirements: Requirement[] }; projected: { graduationReady: boolean; creditedCredits: number; requirements: Requirement[] }; warnings: string[] };

const labels: Record<string, string> = { major_core: 'Major core', major_total: 'Major total', minor: 'Minor', inter_focus: 'Inter Focus', seminar: 'Seminar', practical_work: 'Practical work', science_in_perspective: 'Science in Perspective', masters_thesis: "Master's thesis", total: 'Total' };
function defaultSemester() {
  const now = new Date();
  return `${now.getFullYear()}${now.getMonth() >= 6 ? 'W' : 'S'}`;
}

export function SemesterPlanner({ sample, onRecommend }: { sample: boolean; onRecommend: (prompt: string) => void }) {
  const [major, setMajor] = useState<MscCsMajor>('Machine Intelligence');
  const [minor, setMinor] = useState<MscCsMinor>('Computer Graphics');
  const [semester, setSemester] = useState(defaultSemester);
  const [query, setQuery] = useState('');
  const [courses, setCourses] = useState<PlannedCourse[]>([]);
  const [results, setResults] = useState<Course[]>([]);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [busy, setBusy] = useState<'search' | 'audit' | ''>('');
  const [error, setError] = useState('');
  const validMinors = MSC_CS_MAJOR_MINOR_COMBINATIONS[major];

  const plannedCredits = useMemo(() => courses.reduce((sum, course) => sum + (course.credits ?? 0), 0), [courses]);

  async function search() {
    if (!query.trim() || busy) return;
    setBusy('search'); setError('');
    try {
      const response = await fetch(`/api/vvz/search?semester=${encodeURIComponent(semester)}&q=${encodeURIComponent(query.trim())}`, { credentials: 'same-origin', cache: 'no-store' });
      const body = await response.json() as { courses?: Course[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'Course search failed.');
      setResults(body.courses ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Course search failed.'); }
    finally { setBusy(''); }
  }

  async function checkRequirements() {
    if (!courses.length || busy) return;
    setBusy('audit'); setError('');
    try {
      const response = await fetch('/api/vvz/graduation', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ major, minor, courses: courses.map(({ id, status }) => ({ unitId: id, status })), previousBachelorLanguageCredits: 0 }) });
      const body = await response.json() as Audit & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'Requirements check failed.');
      setAudit(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Requirements check failed.'); }
    finally { setBusy(''); }
  }

  function recommend() {
    const courseList = courses.length ? courses.map(course => `${course.number ?? course.id} ${course.title ?? ''} (${course.credits ?? '?'} ECTS, ${course.status})`).join('; ') : 'none yet';
    const deficits = audit?.projected.requirements.filter(item => !item.satisfied).map(item => `${labels[item.key] ?? item.key}: ${item.missing} ECTS missing`).join('; ') ?? 'not checked yet';
    onRecommend(`Recommend courses for my ETH MSc Computer Science semester ${semester}. My major is ${major} and minor is ${minor}. Current plan: ${courseList}. Projected requirement gaps: ${deficits}. Search VVZ for this semester, prioritize courses that close the major/minor and graduation gaps, avoid duplicate credit counting, and explain why each recommendation fits. Verify details with the VVZ tools and include official VVZ links.`);
  }

  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(19rem,.75fr)]">
    <section className="rounded-2xl border border-[#dce3db] bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-medium">Build your semester</h2><p className="mt-1 text-sm text-[#617269]">Search the live VVZ catalogue and keep a local planning draft.</p></div><span className="rounded-full bg-[#eef2eb] px-3 py-1 text-xs">{plannedCredits} ECTS selected</span></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="text-xs font-medium">Major<select value={major} onChange={event => { const next = event.target.value as MscCsMajor; setMajor(next); setAudit(null); if (!MSC_CS_MAJOR_MINOR_COMBINATIONS[next].includes(minor)) setMinor(MSC_CS_MAJOR_MINOR_COMBINATIONS[next][0]); }} className="mt-1.5 w-full rounded-xl border border-[#cbd7ce] bg-white px-3 py-2.5 text-sm">{MSC_CS_MAJORS.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs font-medium">Minor<select value={minor} onChange={event => { setMinor(event.target.value as MscCsMinor); setAudit(null); }} className="mt-1.5 w-full rounded-xl border border-[#cbd7ce] bg-white px-3 py-2.5 text-sm">{validMinors.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs font-medium">Semester<input value={semester} onChange={event => setSemester(event.target.value.toUpperCase())} maxLength={5} placeholder="2026W" className="mt-1.5 w-full rounded-xl border border-[#cbd7ce] px-3 py-2.5 text-sm" /></label>
      </div>
      <form onSubmit={event => { event.preventDefault(); void search(); }} className="mt-5 flex gap-2"><input value={query} onChange={event => setQuery(event.target.value)} disabled={sample} placeholder="Course title, e.g. Computer Vision" className="min-w-0 flex-1 rounded-xl border border-[#cbd7ce] px-3 py-2.5 text-sm" /><button disabled={sample || busy !== '' || !query.trim()} className="rounded-xl bg-[#173b32] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy === 'search' ? 'Searching…' : 'Search VVZ'}</button></form>
      {results.length > 0 && <div className="mt-4 divide-y divide-[#e5eae4] rounded-xl border border-[#e5eae4]">{results.map(course => <div key={course.id} className="flex items-center gap-3 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{course.title}</p><p className="mt-1 text-xs text-[#748278]">{course.number} · {course.credits ?? '?'} ECTS</p></div><button type="button" disabled={courses.some(item => item.id === course.id)} onClick={() => { setCourses(value => [...value, { ...course, status: 'planned' }]); setAudit(null); }} className="rounded-lg border border-[#cbd7ce] px-3 py-1.5 text-xs disabled:opacity-40">Add</button></div>)}</div>}
      <div className="mt-6"><h3 className="text-sm font-medium">Current plan</h3>{courses.length === 0 ? <p className="mt-3 rounded-xl bg-[#f5f7f3] p-4 text-sm text-[#617269]">Add completed, current, or planned courses to see how they count.</p> : <div className="mt-3 space-y-2">{courses.map(course => <div key={course.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#e5eae4] p-3"><div className="min-w-0 flex-1"><a href={course.officialVvzUrl} target="_blank" rel="noreferrer" className="text-sm font-medium underline decoration-[#a9b9ad] underline-offset-2">{course.title}</a><p className="mt-1 text-xs text-[#748278]">{course.number} · {course.semester} · {course.credits ?? '?'} ECTS</p></div><select value={course.status} onChange={event => { setCourses(value => value.map(item => item.id === course.id ? { ...item, status: event.target.value as CourseStatus } : item)); setAudit(null); }} className="rounded-lg border border-[#cbd7ce] bg-white px-2 py-1.5 text-xs"><option value="passed">Passed</option><option value="in_progress">In progress</option><option value="planned">Planned</option></select><button type="button" aria-label={`Remove ${course.title}`} onClick={() => { setCourses(value => value.filter(item => item.id !== course.id)); setAudit(null); }} className="px-2 text-lg text-[#748278]">×</button></div>)}</div>}</div>
      {error && <p role="alert" className="mt-4 text-sm text-[#9e3e38]">{error}</p>}
      <div className="mt-5 flex flex-wrap gap-2"><button type="button" disabled={sample || !courses.length || busy !== ''} onClick={() => void checkRequirements()} className="rounded-xl bg-[#173b32] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy === 'audit' ? 'Checking…' : 'Check requirements'}</button><button type="button" disabled={sample} onClick={recommend} className="rounded-xl border border-[#8da094] px-4 py-2.5 text-sm font-medium disabled:opacity-50">Recommend with PolyMate</button></div>
    </section>
    <aside className="space-y-5"><section className="rounded-2xl border border-[#dce3db] bg-white p-5"><h2 className="text-lg font-medium">Degree progress</h2><p className="mt-1 text-xs text-[#748278]">MSc Computer Science · Regulations 2020</p>{audit ? <><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#eef2eb] p-3"><p className="text-xs text-[#617269]">Completed</p><p className="mt-1 text-2xl font-medium">{audit.completed.creditedCredits}</p></div><div className="rounded-xl bg-[#eef2eb] p-3"><p className="text-xs text-[#617269]">Projected</p><p className="mt-1 text-2xl font-medium">{audit.projected.creditedCredits}</p></div></div><div className="mt-5 space-y-3">{audit.projected.requirements.map(item => <div key={item.key}><div className="flex justify-between text-xs"><span>{labels[item.key] ?? item.key}</span><span>{item.earned}/{item.required}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#e5eae4]"><div className="h-full rounded-full bg-[#3f7662]" style={{ width: `${Math.min(100, item.earned / item.required * 100)}%` }} /></div></div>)}</div><p className={`mt-5 rounded-xl p-3 text-sm ${audit.projected.graduationReady ? 'bg-[#e5f2e8] text-[#275b3b]' : 'bg-[#fff4df] text-[#805a20]'}`}>{audit.projected.graduationReady ? 'Your projected plan satisfies the encoded graduation requirements.' : 'Your projected plan still has requirement gaps.'}</p></> : <div className="mt-5 space-y-3 text-sm text-[#617269]"><p>Major: 26 ECTS, including 16 core</p><p>Minor: 18 ECTS</p><p>Inter Focus: 2 courses / 16 ECTS</p><p>Seminar: 2 · Practical work: 8</p><p>Science in Perspective: 2</p><p>Master’s thesis: 30 · Total: 120</p></div>}</section><p className="px-1 text-xs leading-5 text-[#748278]">Unofficial planning aid. VVZ API is community-maintained; confirm course allocation and graduation eligibility in myStudies or with D-INFK Studies Administration.</p></aside>
  </div>;
}
