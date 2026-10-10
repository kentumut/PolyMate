import { headers } from 'next/headers';
import Link from 'next/link';
import { IdentityError, resolveOwner, type OwnerContext } from '@polymate/core/identity';
import { StudyCompanion } from '@/components/agent/study-companion';

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
            <p className="mt-4 max-w-xl text-sm leading-6 text-[#617269]">Connect your Moodle calendar, choose what needs work, then shape a study timeline and add the blocks you approve.</p></div>
          <span className="rounded-full bg-[#e8ede5] px-4 py-2 text-xs font-medium">Study companion</span>
        </div>
        <div className="mt-9"><StudyCompanion key={owner.userId} sample={sample} ownerName={owner.displayName} /></div>
      </section>
    </main>;
}
