import { headers } from 'next/headers';
import Link from 'next/link';
import { IdentityError, resolveOwner, type OwnerContext } from '@polymate/core/identity';
import { CalendarStudyWorkflow } from '@/components/study/calendar-study-workflow';
import { GoogleConnection } from '@/components/connections/google-connection';
import { AssignmentsPanel } from '@/components/study/assignments-panel';
import { StudyWorkspaceProvider } from '@/components/study/study-workspace-context';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({ searchParams }: PageProps<'/calendar'>) {
  // Sample data is a local development aid only; production always reads Google.
  const sample = process.env.NODE_ENV === 'development' && (await searchParams).calendar === 'sample';
  let owner: OwnerContext | undefined;
  try {
    owner = resolveOwner(await headers());
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
  }
  if (!owner) {
    return <main className="mx-auto max-w-xl px-6 py-24"><p className="text-sm font-semibold">PolyMate</p><h1 className="mt-5 text-3xl font-medium">Sign in to your study space</h1><p className="mt-4 leading-7 text-[#617269]">Open PolyMate through the managed hackathon address. If this message persists, ask the release owner to check the proxy identity configuration.</p></main>;
  }
  return <main className="min-h-screen px-5 py-7 md:px-12">
      <header className="mx-auto flex max-w-7xl items-center justify-between border-b border-[#dce3db] pb-6">
        <Link href="/calendar" className="flex items-center gap-3 text-xl font-semibold tracking-tight">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#173b32] text-white" aria-hidden="true">p.</span> PolyMate
        </Link>
        <span className="rounded-full border border-[#dce3db] bg-white px-4 py-2 text-xs">ETH study companion</span>
      </header>
      <section className="mx-auto max-w-7xl pt-10 md:pt-14">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[#658071]">A little structure. More room to learn.</p>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div><h1 className="text-4xl font-medium tracking-tight md:text-5xl">Make space for your week.</h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-[#617269]">Your lectures, plans, and study blocks, together in one calm place.</p></div>
          <span className="rounded-full bg-[#e8ede5] px-4 py-2 text-xs font-medium">{sample ? 'Sample calendar' : 'Study calendar'}</span>
        </div>
        <StudyWorkspaceProvider key={`${owner.userId}:workspace:${sample}`} sample={sample}>
        <div className="mt-9 grid gap-5 lg:grid-cols-[1fr_290px]">
          <CalendarStudyWorkflow key={`${owner.userId}:${sample}`} sample={sample} />
          <aside className="space-y-5">
            <AssignmentsPanel key={`${owner.userId}:assignments:${sample}`} sample={sample} />
            <section className="rounded-2xl border border-[#dce3db] bg-white p-6 text-center"><h2 className="text-sm font-semibold">Google Calendar</h2><GoogleConnection /></section>
            <section className="rounded-2xl bg-[#173b32] p-6 text-white"><p className="text-[11px] uppercase tracking-widest text-[#c2d5c5]">Start small</p><h2 className="mt-3 text-xl font-medium leading-7">One good study block<br />is a good start.</h2><p className="mt-4 text-sm leading-6 text-[#c2d5c5]">Once connected, your study plans will live alongside your existing commitments.</p></section>
            <section className="rounded-2xl border border-[#dce3db] bg-[#edf0e7] p-6"><h2 className="text-sm font-semibold">A week with breathing room</h2><p className="mt-3 text-sm leading-6 text-[#617269]">Keep time for friends, fresh air, and everything beyond your exercise sheets.</p></section>
            <p className="px-1 text-xs text-[#748278]">Signed in as {owner.displayName}</p>
          </aside>
        </div>
        </StudyWorkspaceProvider>
        <p className="mt-6 text-xs text-[#7a877e]">Create, move, complete, or delete PolyMate study blocks. Your personal Google events remain read-only.</p>
      </section>
    </main>;
}
