'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { MSC_CS_MAJORS, type MscCsMajor, type MscCsMinor } from '@polymate/core/vvz';
import { MSC_CS_MAJOR_MINOR_COMBINATIONS } from '@polymate/core/vvz/graduation';
import { creditsForSemester, currentSemester, semesterRange, semesterSequence, workloadLabel, type CourseStatus, type PlannedCourse, type SemesterPlan } from './semester-plan-model';
import { RefreshCw, Search as SearchIcon, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

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

export function readSemesterPlan(): SemesterPlan {
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
  const plan = useSyncExternalStore(subscribePlan, readSemesterPlan, () => initialPlan);
  return [plan, (update: (current: SemesterPlan) => SemesterPlan) => savePlan(update(readSemesterPlan()))] as const;
}

export function SemesterPlanner({ sample }: { sample: boolean }) {
  const [plan, updatePlan] = useSemesterPlan();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Course[]>([]);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [busy, setBusy] = useState<'search' | 'audit' | 'recommend' | ''>('');
  const [error, setError] = useState('');
  const [agentResult, setAgentResult] = useState<{ summary: string; courses: Array<Course & { reason: string }>; cautions: string[] } | null>(null);
  const [alternativeBusyId, setAlternativeBusyId] = useState<number | null>(null);
  const [alternative, setAlternative] = useState<{ forCourseId: number; course: Course; removeCourseIds: number[]; category: string; reason: string } | null>(null);
  const validMinors = MSC_CS_MAJOR_MINOR_COMBINATIONS[plan.major];
  const semesters = useMemo(() => {
    const current = currentSemester();
    const defaultEnd = semesterSequence(current).at(-1)!;
    const anchors = [current, defaultEnd, plan.activeSemester, ...plan.courses.map(course => course.semester)].sort();
    return semesterRange(anchors[0], anchors.at(-1)!);
  }, [plan.activeSemester, plan.courses]);
  const activeCredits = creditsForSemester(plan.courses, plan.activeSemester);
  const assignments = new Map(audit?.projected.assignments.map(item => [item.unitId, item.assignedCategory]) ?? []);
  const groupedCourses = semesters.map(semester => ({ semester, courses: plan.courses.filter(course => course.semester === semester), credits: creditsForSemester(plan.courses, semester) }));

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

  async function improvePlan() {
    if (busy || sample) return;
    setBusy('recommend'); setError(''); setAgentResult(null);
    try {
      const response = await fetch('/api/vvz/plan', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(plan),
      });
      const body = await response.json() as { proposal?: { summary: string; courses: Array<Course & { status: 'planned'; reason: string }>; cautions: string[] }; audit?: Audit | null; error?: { message?: string } };
      if (!response.ok || !body.proposal) throw new Error(body.error?.message ?? 'PolyMate could not improve this plan.');
      const additions = body.proposal.courses;
      updatePlan(current => {
        const existing = new Set(current.courses.map(course => course.id));
        return { ...current, courses: [...current.courses, ...additions.filter(course => !existing.has(course.id))] };
      });
      setAudit(body.audit ?? null);
      setAgentResult({ summary: body.proposal.summary, courses: additions, cautions: body.proposal.cautions });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'PolyMate could not improve this plan.'); }
    finally { setBusy(''); }
  }

  async function suggestAlternative(course: PlannedCourse) {
    if (busy || alternativeBusyId !== null || sample) return;
    setAlternativeBusyId(course.id); setAlternative(null); setError('');
    try {
      const response = await fetch('/api/vvz/alternative', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, courseId: course.id }),
      });
      const body = await response.json() as { course?: Course; removeCourseIds?: number[]; category?: string; reason?: string; error?: { message?: string } };
      if (!response.ok || !body.course || !body.removeCourseIds?.length || !body.category || !body.reason) throw new Error(body.error?.message ?? 'PolyMate could not find an alternative course.');
      setAlternative({ forCourseId: course.id, course: body.course, removeCourseIds: body.removeCourseIds, category: body.category, reason: body.reason });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'PolyMate could not find an alternative course.'); }
    finally { setAlternativeBusyId(null); }
  }

  function replaceWithAlternative() {
    if (!alternative) return;
    const removeCourseIds = alternative.removeCourseIds ?? [alternative.forCourseId];
    changePlan(current => ({ ...current, courses: [...current.courses.filter(course => !removeCourseIds.includes(course.id)), { ...alternative.course, status: 'planned' }] }));
    setAlternative(null);
  }

  function alternativeSuggestion(course: PlannedCourse) {
    if (!alternative || alternative.forCourseId !== course.id) return null;
    const removeCourseIds = alternative.removeCourseIds ?? [alternative.forCourseId];
    return <div className="mx-3 mb-3 rounded-lg border border-sky-300/60 bg-sky-50/70 p-4 text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100" aria-live="polite">
      <p className="text-sm font-semibold">Suggested change for {course.title}</p>
      {removeCourseIds.length > 1 && <div className="mt-2 text-xs leading-5 opacity-80"><span className="font-medium">Remove:</span> {plan.courses.filter(item => removeCourseIds.includes(item.id)).map(item => item.title).join(', ')}</div>}
      <a href={alternative.course.officialVvzUrl} target="_blank" rel="noreferrer" className="mt-2 block text-sm font-medium underline underline-offset-2"><span className="no-underline">Add: </span>{alternative.course.number} · {alternative.course.title}</a>
      <p className="mt-1 text-xs leading-5 opacity-80">{alternative.course.semester} · {alternative.course.credits ?? '?'} ECTS · {categoryLabels[alternative.category] ?? alternative.category}</p>
      <p className="mt-2 text-xs leading-5 opacity-80">{alternative.reason}</p>
      <div className="mt-3 flex gap-2"><Button type="button" size="sm" onClick={replaceWithAlternative}>{removeCourseIds.length > 1 ? 'Apply changes' : 'Replace course'}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setAlternative(null)}>Keep current</Button></div>
    </div>;
  }

  const totalCredits = plan.courses.reduce((sum, course) => sum + (course.credits ?? 0), 0);
  const inputClass = 'mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/30';

  return <div className="space-y-5">
    <section className="rounded-xl border bg-card shadow-sm">
      <div className="grid gap-px overflow-hidden rounded-xl bg-border sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-card p-4"><p className="text-xs text-muted-foreground">Degree path</p><p className="mt-1 font-semibold">{plan.major}</p><p className="mt-0.5 text-xs text-muted-foreground">Minor: {plan.minor}</p></div>
        <div className="bg-card p-4"><p className="text-xs text-muted-foreground">Active semester</p><p className="mt-1 text-2xl font-semibold">{plan.activeSemester}</p></div>
        <div className="bg-card p-4"><p className="text-xs text-muted-foreground">Semester workload</p><p className="mt-1 text-2xl font-semibold">{activeCredits}<span className="ml-1 text-sm font-normal text-muted-foreground">/ {plan.targetCredits} ECTS</span></p></div>
        <div className="bg-card p-4"><p className="text-xs text-muted-foreground">Whole plan</p><p className="mt-1 text-2xl font-semibold">{totalCredits}<span className="ml-1 text-sm font-normal text-muted-foreground">ECTS</span></p></div>
      </div>
      <details className="group border-t">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden"><span>Degree settings</span><span className="text-xs text-muted-foreground group-open:hidden">Change major, minor, or target</span><span className="hidden text-xs text-muted-foreground group-open:inline">Close</span></summary>
        <div className="grid gap-4 border-t bg-muted/30 p-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_12rem]">
          <label className="text-xs font-medium">Major<select value={plan.major} onChange={event => { const major = event.target.value as MscCsMajor; changePlan(current => ({ ...current, major, minor: MSC_CS_MAJOR_MINOR_COMBINATIONS[major].includes(current.minor) ? current.minor : MSC_CS_MAJOR_MINOR_COMBINATIONS[major][0] })); }} className={inputClass}>{MSC_CS_MAJORS.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs font-medium">Minor<select value={plan.minor} onChange={event => changePlan(current => ({ ...current, minor: event.target.value as MscCsMinor }))} className={inputClass}>{validMinors.map(value => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs font-medium">ECTS target<input type="number" min={10} max={45} value={plan.targetCredits} onChange={event => { const targetCredits = Number(event.target.value); if (targetCredits >= 10 && targetCredits <= 45) updatePlan(current => ({ ...current, targetCredits })); }} className={inputClass} /></label>
        </div>
      </details>
    </section>

    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,.55fr)]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Find courses</h2><p className="mt-1 text-sm text-muted-foreground">Search the ETH course catalogue for one semester at a time.</p></div><p className="text-xs text-muted-foreground">Saved in this browser</p></div>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Semesters">{semesters.map(semester => <button key={semester} type="button" onClick={() => { updatePlan(current => ({ ...current, activeSemester: semester })); setResults([]); }} className={`shrink-0 rounded-md px-3 py-2 text-xs font-medium transition-colors ${plan.activeSemester === semester ? 'bg-primary text-primary-foreground' : 'border bg-background text-muted-foreground hover:bg-accent'}`}>{semester}<span className="ml-1.5 opacity-70">{creditsForSemester(plan.courses, semester)} ECTS</span></button>)}</div>
          <div className="mt-4 grid gap-4 rounded-lg bg-muted p-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><div className="flex justify-between gap-3 text-sm"><span>{plan.activeSemester} workload</span><span className="font-medium">{activeCredits}/{plan.targetCredits} ECTS</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background"><div className={`h-full rounded-full ${activeCredits > plan.targetCredits ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${Math.min(100, activeCredits / plan.targetCredits * 100)}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">{workloadLabel(activeCredits, plan.targetCredits)}</p></div></div>
          <form onSubmit={event => { event.preventDefault(); void search(); }} className="mt-4 flex flex-col gap-2 sm:flex-row"><label className="relative min-w-0 flex-1"><span className="sr-only">Search VVZ</span><SearchIcon className="absolute left-3 top-3 size-4 text-muted-foreground" /><input value={query} onChange={event => setQuery(event.target.value)} disabled={sample} placeholder="Course title or number" className="w-full rounded-md border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/30" /></label><Button disabled={sample || busy !== '' || !query.trim()}>{busy === 'search' ? 'Searching…' : `Search ${plan.activeSemester}`}</Button></form>
          {results.length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-2">{results.map(course => { const selected = plan.courses.some(item => item.id === course.id); return <article key={course.id} className="flex min-h-32 flex-col rounded-lg border p-4"><p className="text-xs text-muted-foreground">{course.number} · {course.credits ?? '?'} ECTS</p><h3 className="mt-1 line-clamp-2 text-sm font-medium">{course.title}</h3><div className="mt-auto flex items-center justify-between pt-4"><a href={course.officialVvzUrl} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2">VVZ details</a><Button type="button" size="sm" variant="outline" disabled={selected} onClick={() => addCourse(course)}>{selected ? 'Added' : 'Add course'}</Button></div></article>; })}</div>}
          {!busy && query && results.length === 0 && !error && <p className="mt-4 text-sm text-muted-foreground">Search VVZ to see course options for this semester.</p>}
        </section>

        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Your plan</h2><p className="mt-1 text-sm text-muted-foreground">Review courses by semester and keep their status current.</p></div><span className="rounded-md bg-muted px-2.5 py-1 text-xs">{totalCredits} ECTS planned</span></div>
          {plan.courses.length === 0 ? <div className="mt-5 rounded-lg border border-dashed p-8 text-center"><p className="text-sm font-medium">No planned courses yet</p><p className="mt-2 text-sm text-muted-foreground">Search above, then add courses to a semester.</p></div> : <div className="mt-5 space-y-5">{groupedCourses.map(group => <section key={group.semester}><div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">{group.semester}</h3><span className="text-xs text-muted-foreground">{group.credits} ECTS</span></div><div className="divide-y rounded-lg border">{group.courses.length === 0 && <p className="p-3 text-sm text-amber-700 dark:text-amber-300">No course planned yet. Fill this semester before graduation.</p>}{group.courses.map(course => <div key={course.id}><div className="flex flex-wrap items-center gap-3 p-3"><div className="min-w-48 flex-1"><a href={course.officialVvzUrl} target="_blank" rel="noreferrer" className="text-sm font-medium hover:underline">{course.title}</a><p className="mt-1 text-xs text-muted-foreground">{course.number} · {course.credits ?? '?'} ECTS {assignments.get(course.id) && <>· {categoryLabels[assignments.get(course.id)!] ?? assignments.get(course.id)}</>}{course.sourceSemester && course.sourceSemester !== course.semester && <> · tentative recurrence from {course.sourceSemester}</>}</p></div><Button type="button" size="icon" variant="ghost" aria-label={`Suggest an alternative to ${course.title}`} title="Suggest alternative" disabled={sample || course.status !== 'planned' || busy !== '' || alternativeBusyId !== null} onClick={() => void suggestAlternative(course)} className="size-8 text-muted-foreground"><RefreshCw aria-hidden="true" className={alternativeBusyId === course.id ? 'animate-spin' : ''} /></Button><select aria-label={`Status for ${course.title}`} value={course.status} onChange={event => changePlan(current => ({ ...current, courses: current.courses.map(item => item.id === course.id ? { ...item, status: event.target.value as CourseStatus } : item) }))} className="rounded-md border bg-background px-2 py-1.5 text-xs"><option value="passed">Passed</option><option value="in_progress">In progress</option><option value="planned">Planned</option></select><Button type="button" size="icon" variant="ghost" aria-label={`Remove ${course.title}`} onClick={() => changePlan(current => ({ ...current, courses: current.courses.filter(item => item.id !== course.id) }))} className="size-8 text-muted-foreground"><X aria-hidden="true" /></Button></div>{alternativeSuggestion(course)}</div>)}</div></section>)}</div>}
          {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          {busy === 'recommend' && <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4" role="status"><p className="flex items-center gap-2 text-sm font-medium"><Sparkles className="size-4 animate-pulse" aria-hidden="true" /> PolyMate is improving the plan</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Auditing the existing courses, searching VVZ, and comparing curriculum gaps. Your current plan stays intact.</p></div>}
          {agentResult && <div className="mt-4 rounded-lg border border-emerald-300/60 bg-emerald-50/70 p-4 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100" aria-live="polite"><p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4" aria-hidden="true" /> {agentResult.courses.length ? `${agentResult.courses.length} course${agentResult.courses.length === 1 ? '' : 's'} added to your plan` : 'Plan reviewed'}</p><p className="mt-2 text-sm leading-6">{agentResult.summary}</p>{agentResult.courses.length > 0 && <ul className="mt-3 space-y-2">{agentResult.courses.map(course => <li key={course.id} className="rounded-md bg-background/70 p-3 text-sm"><a href={course.officialVvzUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">{course.number} · {course.title}</a><span className="ml-2 text-xs opacity-75">{course.semester} · {course.credits ?? '?'} ECTS{course.sourceSemester && course.sourceSemester !== course.semester ? ` · source ${course.sourceSemester}` : ''}</span><p className="mt-1 text-xs leading-5 opacity-80">{course.reason}</p></li>)}</ul>}{agentResult.cautions.length > 0 && <p className="mt-3 text-xs leading-5 opacity-80">{agentResult.cautions.join(' ')}</p>}</div>}
          <div className="mt-5 flex flex-wrap gap-2"><Button type="button" disabled={sample || !plan.courses.length || busy !== ''} onClick={() => void checkRequirements()}>{busy === 'audit' ? 'Checking…' : audit ? 'Refresh degree check' : 'Check degree progress'}</Button><Button type="button" variant="outline" disabled={sample || busy !== ''} onClick={() => void improvePlan()}><Sparkles aria-hidden="true" /> {busy === 'recommend' ? 'Improving plan…' : 'Improve plan with PolyMate'}</Button></div>
        </section>
      </div>

      <aside className="sticky top-5 space-y-3"><section className="rounded-xl border bg-card p-5 shadow-sm"><h2 className="font-semibold">Degree progress</h2><p className="mt-1 text-xs text-muted-foreground">MSc Computer Science · Regulations 2020</p>{audit ? <><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">Completed</p><p className="mt-1 text-2xl font-semibold">{audit.completed.creditedCredits}</p></div><div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground">Projected</p><p className="mt-1 text-2xl font-semibold">{audit.projected.creditedCredits}</p></div></div><div className="mt-5 space-y-3">{audit.projected.requirements.map(item => <div key={item.key}><div className="flex justify-between text-xs"><span>{requirementLabels[item.key] ?? item.key}</span><span>{item.earned}/{item.required}</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, item.earned / item.required * 100)}%` }} /></div></div>)}</div><p className={`mt-5 rounded-lg p-3 text-sm ${audit.projected.graduationReady ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}`}>{audit.projected.graduationReady ? 'Your projected plan satisfies the encoded graduation requirements.' : 'Your projected plan still has requirement gaps.'}</p></> : <div className="mt-5 space-y-3 text-sm text-muted-foreground"><p>Major: 26 ECTS, including 16 core</p><p>Minor: 18 ECTS</p><p>Inter Focus: 2 courses / 16 ECTS</p><p>Seminar: 2 · Practical work: 8</p><p>Science in Perspective: 2</p><p>Master’s thesis: 30 · Total: 120</p><p className="rounded-lg bg-muted p-3 text-xs leading-5">Add courses and run the degree check to see their allocation.</p></div>}</section><p className="px-1 text-xs leading-5 text-muted-foreground">Unofficial planning aid. Confirm course allocation and graduation eligibility in myStudies or with D-INFK Studies Administration.</p></aside>
    </div>
  </div>;
}
