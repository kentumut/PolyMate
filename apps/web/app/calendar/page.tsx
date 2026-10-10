import { headers } from 'next/headers';
import { IdentityError, resolveOwner, type OwnerContext } from '@polymate/core/identity';
import { StudyWorkspaceProvider } from '@/components/study/study-workspace-context';
import { StudyCompanion } from '@/components/agent/study-companion';

export const dynamic = 'force-dynamic';

export default async function CalendarPage({ searchParams }: PageProps<'/calendar'>) {
  const query = await searchParams;
  const demo = query.demo === '1';
  const demoNow = demo ? new Date().toISOString() : undefined;
  // The guided demo is a labelled fixture available at /demo. The older sample query
  // remains a local development aid; production uses the standalone PolyMate calendar.
  const sample = demo || (process.env.NODE_ENV === 'development' && query.calendar === 'sample');
  let owner: OwnerContext | undefined;
  if (demo) {
    owner = { userId: 'demo-student', externalId: 'demo-student', displayName: 'Alex Meier' };
  } else {
    try {
      owner = resolveOwner(await headers());
    } catch (error) {
      if (!(error instanceof IdentityError)) throw error;
    }
  }
  if (!owner) {
    return <main className="mx-auto max-w-xl px-6 py-24"><p className="text-sm font-semibold">PolyMate</p><h1 className="mt-5 text-3xl font-medium">Sign in to your study space</h1><p className="mt-4 leading-7 text-muted-foreground">Open PolyMate through the managed hackathon address. If this message persists, ask the release owner to check the proxy identity configuration.</p><a href="/demo" className="mt-7 inline-flex items-center rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90">Open mentor demo <span className="ml-2" aria-hidden="true">→</span></a></main>;
  }
  return <StudyWorkspaceProvider key={`${owner.userId}:workspace:${sample}`} sample={sample} demoNow={demoNow}>
    <StudyCompanion key={owner.userId} sample={sample} ownerName={owner.displayName} demo={demo} demoNow={demoNow} />
  </StudyWorkspaceProvider>;
}
