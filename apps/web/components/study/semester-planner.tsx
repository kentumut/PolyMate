'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { MSC_CS_MAJORS, type MscCsMajor, type MscCsMinor } from '@polymate/core/vvz';
import { MSC_CS_MAJOR_MINOR_COMBINATIONS } from '@polymate/core/vvz/graduation';
import { creditsForSemester, currentSemester, semesterSequence, workloadLabel, type CourseStatus, type PlannedCourse, type SemesterPlan } from './semester-plan-model';

type Course = Omit<PlannedCourse, 'status'>;
type Requirement = { key: string; earned: number; required: number; missing: number; satisfied: boolean };
type Assignment = { unitId: number; assignedCategory: string };
type AuditPart = { graduationReady: boolean; creditedCredits: number; requirements: Requirement[]; assignments: Assignment[] };
type Audit = { majorMinorCombinationValid: boolean; completed: AuditPart; projected: AuditPart; warnings: string[] };

const requirementLabels: Record<string, string> = { major_core: 'Major core', major_total: 'Major total', minor: 'Minor', inter_focus: 'Inter Focus', seminar: 'Seminar', practical_work: 'Practical work', science_in_perspective: 'Science in Perspective', masters_thesis: "Master's thesis", total: 'Total' };
const categoryLabels: Record<string, string> = { major_core: 'Major core', major_elective: 'Major elective', minor: 'Minor', inter_focus: 'Inter Focus', seminar: 'Seminar', practical_work: 'Practical work', science_in_perspective: 'Science in Perspective', masters_thesis: "Master's thesis", free_elective: 'Free elective', unclassified: 'Needs review' };
const storageKey = 'polymate-semester-plan-v2';
const storeEvent = 'polymate-semester-plan-change';
const initialPlan: SemesterPlan = { major: 'Machine Intelligence', minor: 'Computer Graphics', activeSemester: currentSemester(), targetCredits: 30, courses: [] };
let cachedPlan: SemesterPlan | undefined;

function validStoredPlan(value: unknown): value is SemesterPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<SemesterPlan>;
  return typeof plan.major === 'string' && (MSC_CS_MAJORS as readonly string[]).includes(plan.major)
    && typeof plan.minor === 'string' && MSC_CS_MAJOR_MINOR_COMBINATIONS[plan.major as MscCsMajor].includes(plan.minor as MscCsMinor)
    && typeof plan.activeSemester === 'string' && /^\d{4}[SW]$/.test(plan.activeSemester)
    && typeof plan.targetCredits === 'number' && plan.targetCredits >= 10 && plan.targetCredits <= 45 && Array.isArray(plan.courses);
}

function readPlan(): SemesterPlan {
  if (cachedPlan) return cachedPlan;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as unknown;
    if (validStoredPlan(parsed)) return cachedPlan = { ...parsed, courses: parsed.courses.slice(0, 50) };
  } catch { /* Use a fresh plan. */ }
  return cachedPlan = initialPlan;
}

function subscribePlan(callback: () => void) {
  window.addEventListener(storeEvent, callback);
  window.addEventListener('storage', callback);
  return () => { window.removeEventListener(storeEvent, callback); window.removeEventListener('storage', callback); };
}

function savePlan(plan: SemesterPlan) {
  cachedPlan = plan;
  try { localStorage.setItem(storageKey, JSON.stringify(plan)); } catch { /* The in-memory plan still works. */ }
  window.dispatchEvent(new Event(storeEvent));
}

function useSemesterPlan() {
  const plan = useSyncExternalStore(subscribePlan, readPlan, () => initialPlan);
  return [plan, (update: (current: SemesterPlan) => SemesterPlan) => savePlan(update(readPlan()))] as const;
}

export function SemesterPlanner({ sample, onRecommend }: { sample: boolean; onRecommend: (prompt: string) => void }) {
  const [plan, updatePlan] = useSemesterPlan();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Course[]>([]);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [busy, setBusy] = useState<'search' | 'audit' | ''>('');
  const [error, setError] = useState('');
  const validMinors = MSC_CS_MAJOR_MINOR_COMBINATIONS[plan.major];
  const semesters = useMemo(() => [...new Set([...semesterSequence(currentSemester()), ...plan.courses.map(course => course.semester), plan.activeSemester])].sort(), [plan.activeSemester, plan.courses]);
  const activeCredits = creditsForSemester(plan.courses, plan.activeSemester);
  const assignments = new Map(audit?.projected.assignments.map(item => [item.unitId, item.assignedCategory]) ?? []);
  const groupedCourses = semesters.map(semester => ({ semester, courses: plan.courses.filter(course => course.semester === semester), credits: creditsForSemester(plan.courses, semester) })).filter(group => group.courses.length || group.semester === plan.activeSemester);

  function changePlan(update: (current: SemesterPlan) => SemesterPlan) {
    updatePlan(update);
    setAudit(null);
  }

  async function search() {
    if (!query.trim() || busy) return;
    setBusy('search'); setError('');
    try {
      const response = await fetch(`/api/vvz/search?semester=${encodeURIComponent(plan.activeSemester)}&q=${encodeURIComponent(query.trim())}`, { credentials: 'same-origin', cache: 'no-store' });
      const body = await response.json() as { courses?: Course[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'Course search failed.');
      setResults(body.courses ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Course search failed.'); }
    finally { setBusy(''); }
  }

  async function checkRequirements() {
    if (!plan.courses.length || busy) return;
    setBusy('audit'); setError('');
    try {
      const response = await fetch('/api/vvz/graduation', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ major: plan.major, minor: plan.minor, courses: plan.courses.map(({ id, status }) => ({ unitId: id, status })), previousBachelorLanguageCredits: 0 }) });
      const body = await response.json() as Audit & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? 'Requirements check failed.');
      setAudit(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Requirements check failed.'); }
    finally { setBusy(''); }
  }

  function addCourse(course: Course) {
    changePlan(current => ({ ...current, courses: [...current.courses, { ...course, status: 'planned' }] }));
  }

  function recommend() {
    const courseList = plan.courses.length ? plan.courses.map(course => `${course.semester}: ${course.number ?? course.id} ${course.title ?? ''} (${course.credits ?? '?'} ECTS, ${course.status})`).join('; ') : 'none yet';
    const deficits = audit?.projected.requirements.filter(item => !item.satisfied).map(item => `${requirementLabels[item.key] ?? item.key}: ${item.missing} ECTS missing`).join('; ') ?? 'not checked yet';
    onRecommend(`Help me improve my ETH MSc Computer Science degree plan. My major is ${plan.major} and minor is ${plan.minor}. I am planning ${plan.activeSemester} with a target of ${plan.targetCredits} ECTS. Current multi-semester plan: ${courseList}. Projected requirement gaps: ${deficits}. Search VVZ for ${plan.activeSemester}, recommend a balanced set of courses that closes the most important gaps, avoid duplicate credit counting, and explain the workload and curriculum fit. Verify details with the VVZ tools and include official VVZ links.`);
  }

  return <div className="space-y-5">
    <section className="rounded-2xl border border-[#dce3db] bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#748278]">Step 1 · Degree path</p><h2 className="mt-1 text-lg font-medium">What are you working toward?</h2><p className="mt-1 text-sm text-[#617269]">Your choices filter valid combinations and guide PolyMate’s recommendations.</p></div><span className="rounded-full bg-[#eef2eb] px-3 py-1.5 text-xs">Saved in this browser</span></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_12rem]">
        <label className="text-xs font-medium">Major<select value={plan.major} onChange={event => { const major = event.target.value as MscCsMajor; changePlan(current => ({ ...current, major, minor: MSC_CS_MAJOR_MINOR_COMBINATIONS[major].includes(current.minor) ? current.minor : MSC_CS_MAJOR_MINOR_COMBINATIONS[major][0] })); }} className="mt-1.5 w-full rounded-xl border border-[#cbd7ce] bg-white px-3 py-2.5 text-sm">{MSC_CS_MAJORS.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs font-medium">Minor<select value={plan.minor} onChange={event => changePlan(current => ({ ...current, minor: event.target.value as MscCsMinor }))} className="mt-1.5 w-full rounded-xl border border-[#cbd7ce] bg-white px-3 py-2.5 text-sm">{validMinors.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs font-medium">ECTS target<input type="number" min={10} max={45} value={plan.targetCredits} onChange={event => { const targetCredits = Number(event.target.value); if (targetCredits >= 10 && targetCredits <= 45) updatePlan(current => ({ ...current, targetCredits })); }} className="mt-1.5 w-full rounded-xl border border-[#cbd7ce] px-3 py-2.5 text-sm" /></label>
      </div>
    </section>

    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,.65fr)]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-2xl border border-[#dce3db] bg-white p-5 sm:p-6">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#748278]">Step 2 · Find courses</p><h2 className="mt-1 text-lg font-medium">Choose a semester</h2></div>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Semesters">{semesters.map(semester => <button key={semester} type="button" onClick={() => { updatePlan(current => ({ ...current, activeSemester: semester })); setResults([]); }} className={`shrink-0 rounded-full px-3 py-2 text-xs font-medium ${plan.activeSemester === semester ? 'bg-[#173b32] text-white' : 'border border-[#cbd7ce] bg-white text-[#52645a]'}`}>{semester}<span className="ml-1.5 opacity-70">{creditsForSemester(plan.courses, semester)} ECTS</span></button>)}</div>
          <div className="mt-4 rounded-xl bg-[#f1f4ee] p-4"><div className="flex items-center justify-between gap-3 text-sm"><span><strong>{plan.activeSemester}</strong> workload</span><span>{activeCredits}/{plan.targetCredits} ECTS</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className={`h-full rounded-full ${activeCredits > plan.targetCredits + 4 ? 'bg-[#b56a53]' : 'bg-[#4d7b68]'}`} style={{ width: `${Math.min(100, activeCredits / plan.targetCredits * 100)}%` }} /></div><p className="mt-2 text-xs text-[#617269]">{workloadLabel(activeCredits, plan.targetCredits)}</p></div>
          <form onSubmit={event => { event.preventDefault(); void search(); }} className="mt-4 flex flex-col gap-2 sm:flex-row"><input value={query} onChange={event => setQuery(event.target.value)} disabled={sample} placeholder="Search title or number, e.g. 263-5902" className="min-w-0 flex-1 rounded-xl border border-[#cbd7ce] px-3 py-2.5 text-sm" /><button disabled={sample || busy !== '' || !query.trim()} className="rounded-xl bg-[#173b32] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy === 'search' ? 'Searching…' : `Search ${plan.activeSemester}`}</button></form>
          {results.length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-2">{results.map(course => { const selected = plan.courses.some(item => item.id === course.id); return <article key={course.id} className="flex min-h-32 flex-col rounded-xl border border-[#dce3db] p-4"><p className="text-xs text-[#748278]">{course.number} · {course.credits ?? '?'} ECTS</p><h3 className="mt-1 line-clamp-2 text-sm font-medium">{course.title}</h3><div className="mt-auto flex items-center justify-between pt-4"><a href={course.officialVvzUrl} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2">Details</a><button type="button" disabled={selected} onClick={() => addCourse(course)} className="rounded-lg border border-[#8da094] px-3 py-1.5 text-xs font-medium disabled:opacity-40">{selected ? 'Added' : `Add to ${course.semester}`}</button></div></article>; })}</div>}
          {!busy && query && results.length === 0 && !error && <p className="mt-4 text-sm text-[#617269]">Search VVZ to see course options for this semester.</p>}
        </section>

        <section className="rounded-2xl border border-[#dce3db] bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#748278]">Step 3 · Review plan</p><h2 className="mt-1 text-lg font-medium">Your semesters</h2></div><span className="rounded-full bg-[#eef2eb] px-3 py-1.5 text-xs">{plan.courses.reduce((sum, course) => sum + (course.credits ?? 0), 0)} ECTS planned</span></div>
          {plan.courses.length === 0 ? <div className="mt-5 rounded-xl border border-dashed border-[#cbd7ce] p-8 text-center"><p className="text-sm font-medium">Your plan is empty</p><p className="mt-2 text-sm text-[#617269]">Search the selected semester above and add courses. You can then mark older courses as passed.</p></div> : <div className="mt-5 space-y-5">{groupedCourses.map(group => <section key={group.semester}><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-medium">{group.semester}</h3><span className="text-xs text-[#748278]">{group.credits} ECTS</span></div><div className="space-y-2">{group.courses.map(course => <div key={course.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#e5eae4] p-3"><div className="min-w-48 flex-1"><a href={course.officialVvzUrl} target="_blank" rel="noreferrer" className="text-sm font-medium underline decoration-[#a9b9ad] underline-offset-2">{course.title}</a><p className="mt-1 text-xs text-[#748278]">{course.number} · {course.credits ?? '?'} ECTS {assignments.get(course.id) && <>· <span className="text-[#355f4e]">{categoryLabels[assignments.get(course.id)!] ?? assignments.get(course.id)}</span></>}</p></div><select aria-label={`Status for ${course.title}`} value={course.status} onChange={event => changePlan(current => ({ ...current, courses: current.courses.map(item => item.id === course.id ? { ...item, status: event.target.value as CourseStatus } : item) }))} className="rounded-lg border border-[#cbd7ce] bg-white px-2 py-1.5 text-xs"><option value="passed">Passed</option><option value="in_progress">In progress</option><option value="planned">Planned</option></select><button type="button" aria-label={`Remove ${course.title}`} onClick={() => changePlan(current => ({ ...current, courses: current.courses.filter(item => item.id !== course.id) }))} className="grid h-8 w-8 place-items-center rounded-lg text-lg text-[#748278] hover:bg-[#f1f4ee]">×</button></div>)}</div></section>)}</div>}
          {error && <p role="alert" className="mt-4 rounded-xl bg-[#fff2ef] p-3 text-sm text-[#9e3e38]">{error}</p>}
          <div className="mt-5 flex flex-wrap gap-2"><button type="button" disabled={sample || !plan.courses.length || busy !== ''} onClick={() => void checkRequirements()} className="rounded-xl bg-[#173b32] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy === 'audit' ? 'Checking…' : audit ? 'Refresh degree check' : 'Check degree progress'}</button><button type="button" disabled={sample} onClick={recommend} className="rounded-xl border border-[#8da094] px-4 py-2.5 text-sm font-medium disabled:opacity-50">Improve with PolyMate</button></div>
        </section>
      </div>

      <aside className="sticky top-5 space-y-5"><section className="rounded-2xl border border-[#dce3db] bg-white p-5"><h2 className="text-lg font-medium">Degree progress</h2><p className="mt-1 text-xs text-[#748278]">MSc Computer Science · Regulations 2020</p>{audit ? <><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#eef2eb] p-3"><p className="text-xs text-[#617269]">Completed</p><p className="mt-1 text-2xl font-medium">{audit.completed.creditedCredits}</p></div><div className="rounded-xl bg-[#eef2eb] p-3"><p className="text-xs text-[#617269]">Projected</p><p className="mt-1 text-2xl font-medium">{audit.projected.creditedCredits}</p></div></div><div className="mt-5 space-y-3">{audit.projected.requirements.map(item => <div key={item.key}><div className="flex justify-between text-xs"><span>{requirementLabels[item.key] ?? item.key}</span><span>{item.earned}/{item.required}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#e5eae4]"><div className="h-full rounded-full bg-[#3f7662]" style={{ width: `${Math.min(100, item.earned / item.required * 100)}%` }} /></div></div>)}</div><p className={`mt-5 rounded-xl p-3 text-sm ${audit.projected.graduationReady ? 'bg-[#e5f2e8] text-[#275b3b]' : 'bg-[#fff4df] text-[#805a20]'}`}>{audit.projected.graduationReady ? 'Your projected plan satisfies the encoded graduation requirements.' : 'Your projected plan still has requirement gaps.'}</p></> : <div className="mt-5 space-y-3 text-sm text-[#617269]"><p>Major: 26 ECTS, including 16 core</p><p>Minor: 18 ECTS</p><p>Inter Focus: 2 courses / 16 ECTS</p><p>Seminar: 2 · Practical work: 8</p><p>Science in Perspective: 2</p><p>Master’s thesis: 30 · Total: 120</p><p className="rounded-xl bg-[#f1f4ee] p-3 text-xs leading-5">Add courses and run the degree check to see how VVZ classifies each one.</p></div>}</section><p className="px-1 text-xs leading-5 text-[#748278]">Unofficial planning aid. VVZ API is community-maintained; confirm course allocation and graduation eligibility in myStudies or with D-INFK Studies Administration.</p></aside>
    </div>
  </div>;
}
