'use client';

import type { Assignment } from '@polymate/contracts/assignments';
import type { BlockAssignmentLink, ProgressReceipt, ProgressReport } from '@polymate/contracts/study-progress';
import type { ProgressDraftCard } from '@/lib/agent-progress';
import { useState } from 'react';

type ProgressCard = ProgressDraftCard | { phase: 'state'; assignments: Assignment[]; sessions: BlockAssignmentLink[]; reports: ProgressReport[]; truncated: boolean; refresh?: { status: string; message?: string } }
  | { phase: 'saved'; kind: 'link'; link: BlockAssignmentLink } | { phase: 'saved'; kind: 'report'; receipt: ProgressReceipt };
const labels: Record<string, string> = { done: 'Done', partly_done: 'Partly done', missed: 'Missed', stuck: 'Stuck' };
const label = (action?: string) => labels[action ?? ''] ?? action;
const time = (value: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function ProgressCardView({ data, busy, confirmed, onConfirm }: {
  data: unknown; busy: boolean; confirmed: ReadonlySet<string>; onConfirm: (token: string, wholeAssignment: boolean) => void;
}) {
  const [wholeAssignment, setWholeAssignment] = useState(false);
  if (!data || typeof data !== 'object') return null;
  const card = data as ProgressCard;
  if (card.phase === 'state') return <section className="mt-3 rounded-xl border border-[#dce3db] bg-white p-4" aria-label="Study progress">
    <h3 className="text-sm font-semibold">Your local study progress</h3>
    {card.refresh?.status === 'unavailable' && <p className="mt-2 text-sm text-[#8a5a26]">{card.refresh.message} The session details below are cached.</p>}
    {card.refresh?.status === 'cached' && card.sessions.length > 0 && <p className="mt-2 text-xs text-[#617269]">Cached session history. Ask about a specific session to refresh Google details before reporting.</p>}
    {!card.assignments.length && <p className="mt-2 text-sm">No matching local assignments. Add one in Calendar → Assignments.</p>}
    <ul className="mt-2 space-y-2 text-sm">{card.assignments.slice(0, 10).map(assignment => <li key={assignment.id}>
      <strong>{assignment.title}</strong> · {assignment.remainingMinutes} min remaining · {assignment.status.replaceAll('_', ' ')}
    </li>)}</ul>
    <ul className="mt-3 space-y-1 text-xs text-[#617269]">{card.sessions.slice(0, 10).map(session => <li key={session.eventId}>
      {time(session.startAt)} · revision {session.sessionRevision} · {session.deleted ? 'deleted — history retained' : session.completion}
    </li>)}</ul>
    <ul className="mt-3 space-y-2 text-xs">{card.reports.slice(-5).map(report => <li key={report.id}>
      {time(report.reportedAt)} · {label(report.action)} · session revision {report.sessionRevision}
      {report.note && <p className="mt-1 whitespace-pre-wrap">{report.note}</p>}
    </li>)}</ul>
    {(card.truncated || card.assignments.length > 10 || card.sessions.length > 10 || card.reports.length > 5) && <p className="mt-2 text-xs">Showing a summary. Ask about a specific assignment or session for more detail.</p>}
  </section>;
  if (card.phase === 'draft') {
    const saved = confirmed.has(card.draftToken);
    return <section className="mt-3 rounded-xl border border-[#b9cbbd] bg-[#f5f8f2] p-4" aria-label="Confirm study progress">
      <h3 className="text-sm font-semibold">{card.kind === 'link' ? 'Link this session' : card.recovery ? 'Recover Google completion' : 'Review progress report'} · {card.assignmentTitle}</h3>
      <p className="mt-2 break-all text-xs text-[#617269]">Session: {card.eventId}</p>
      <p className="mt-1 text-sm">{time(card.startAt)}–{time(card.endAt)}</p>
      {card.sessionRevision && <p className="mt-1 text-xs">Report session revision: {card.sessionRevision}.{card.recovery && ' This is the original saved report; a moved session may now have different times or a newer revision.'}</p>}
      {card.kind === 'report' && <div className="mt-2 space-y-1 text-sm">
        <p>Report: <strong>{label(card.action)}</strong></p>
        <p>{card.assignmentFinished ? 'Mark the entire assignment completed (0 minutes remaining).' : card.remainingMinutes !== undefined ? `${card.remainingMinutes} minutes remain for the whole assignment.` : 'Remaining assignment effort stays unchanged.'}</p>
        {card.action === 'done' && <p>{card.assignmentFinished ? 'Moodle submission remains separate.' : 'Mark this session done; the whole assignment stays open.'}</p>}
        {card.note && <p className="whitespace-pre-wrap">Difficulty / note: {card.note}</p>}
      </div>}
      <p className="mt-2 text-xs text-[#617269]">{saved ? 'Confirmed.' : card.recovery ? 'Progress is already saved. Confirm to check Google completion using the original report and operation ID.' : `Not saved until you confirm. New reports expire ${time(card.expiresAt)}. Repeating confirmation retries the same request.`}</p>
      {card.assignmentFinished && !saved && <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={wholeAssignment} onChange={event => setWholeAssignment(event.target.checked)} disabled={busy} />I confirm the entire assignment is finished, not just this session.</label>}
      <button type="button" disabled={busy || saved || (card.assignmentFinished === true && !wholeAssignment)} onClick={() => onConfirm(card.draftToken, wholeAssignment)} className="mt-3 rounded-xl bg-[#173b32] px-4 py-2 text-sm text-white disabled:opacity-50">{saved ? 'Confirmed' : card.kind === 'link' ? 'Confirm link' : 'Confirm / retry this report'}</button>
      {!saved && <p className="mt-2 text-xs">If the details are wrong, ask PolyMate to revise them before confirming.</p>}
    </section>;
  }
  if (card.phase === 'saved') return <section className="mt-3 rounded-xl border border-[#dce3db] bg-white p-4" aria-label="Saved progress result">
    {card.kind === 'link' ? <p className="text-sm">Assignment link saved.</p> : <>
      <p className="text-sm"><strong>{label(card.receipt.report.action)} report saved.</strong> This report recorded {card.receipt.assignment.remainingMinutes} min remaining.</p>
      <p className="mt-2 text-xs">{card.receipt.report.assignmentFinished ? 'Assignment completed; Moodle submission is separate.' : 'Whole-assignment completion was not reported.'}</p>
      {card.receipt.calendarOperation && <p className="mt-2 text-sm">Google session completion: <strong>{card.receipt.calendarOperation.status}</strong>{card.receipt.calendarOperation.error?.message ? ` — ${card.receipt.calendarOperation.error.message}` : ''}.
        {['pending', 'unknown'].includes(card.receipt.calendarOperation.status) && ' Use the original confirmation card to check again.'}</p>}
    </>}
  </section>;
  return null;
}
