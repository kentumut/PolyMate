import { headers } from 'next/headers';
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
  return <StudyCompanion key={owner.userId} sample={sample} ownerName={owner.displayName} />;
}
