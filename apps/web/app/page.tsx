import Link from 'next/link';
import { ArrowRight, Brain, CalendarDays, Check, MessageSquareText } from 'lucide-react';

const features = [
  { icon: MessageSquareText, title: 'Plan through conversation', body: 'Ask what to study next, review deadlines, and shape a realistic week in one chat.' },
  { icon: CalendarDays, title: 'Turn work into time', body: 'Draft focused study blocks around lectures and commitments, then approve before anything changes.' },
  { icon: Brain, title: 'Keep useful context', body: 'PolyMate remembers your goals, preferred focus rhythm, courses, and plans for the weeks ahead.' },
] as const;

export default function Home() {
  return <main className="min-h-dvh bg-background text-foreground">
    <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8" aria-label="Primary navigation">
      <Link href="/" className="text-xl font-semibold tracking-tight">PolyMate</Link>
      <div className="flex items-center gap-2"><Link href="/demo" className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">View demo</Link><Link href="/calendar" className="rounded-lg bg-foreground px-3.5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85">Open study space</Link></div>
    </nav>

    <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-20 sm:px-8 sm:pt-28 lg:grid-cols-[1.1fr_.9fr] lg:pb-28">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Your ETH study companion</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.04em] sm:text-6xl sm:leading-[1.04]">A clear plan for what to study, and when.</h1>
        <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">PolyMate brings your courses, deadlines, calendar, and weekly context into one conversation. It proposes the plan; you stay in control of every calendar change.</p>
        <div className="mt-8 flex flex-wrap gap-3"><Link href="/calendar" className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85">Start planning <ArrowRight className="size-4" aria-hidden="true" /></Link><Link href="/demo" className="inline-flex items-center rounded-xl border px-5 py-3 text-sm font-medium transition-colors hover:bg-muted">Try the interactive demo</Link></div>
        <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><li className="flex items-center gap-1.5"><Check className="size-3.5" />Built for ETH workflows</li><li className="flex items-center gap-1.5"><Check className="size-3.5" />Calendar changes require approval</li><li className="flex items-center gap-1.5"><Check className="size-3.5" />Works without Google Calendar</li></ul>
      </div>

      <div className="rounded-3xl border bg-card p-3 shadow-[0_24px_80px_-40px_rgba(0,0,0,.35)] sm:p-5" aria-label="Example PolyMate conversation">
        <div className="rounded-2xl bg-muted/65 p-5 sm:p-7">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">This week</p>
          <div className="mt-6 space-y-5">
            <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-foreground px-4 py-3 text-sm leading-6 text-background">I need to finish Algorithms by Friday, but Wednesday evening is unavailable.</div>
            <div className="max-w-[92%] text-sm leading-6"><p className="font-medium">I found three focused sessions before the deadline.</p><p className="mt-1 text-muted-foreground">The draft protects Wednesday evening and keeps Thursday light. Nothing has been added yet.</p></div>
            <div className="grid gap-2 sm:grid-cols-3">{['Mon · 16:00', 'Tue · 10:00', 'Fri · 14:00'].map((time, index) => <div key={time} className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">Session {index + 1}</p><p className="mt-1 text-sm font-medium">{time}</p><p className="mt-0.5 text-xs text-muted-foreground">50 minutes</p></div>)}</div>
            <span className="inline-block rounded-lg bg-foreground px-4 py-2 text-xs font-medium text-background">Approve study blocks</span>
          </div>
        </div>
      </div>
    </section>

    <section className="border-t bg-muted/35"><div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20"><p className="max-w-xl text-sm leading-6 text-muted-foreground">One place for the planning work that usually gets scattered across tabs, calendars, and mental notes.</p><div className="mt-10 grid gap-8 sm:grid-cols-3">{features.map(feature => <article key={feature.title}><feature.icon className="size-5" aria-hidden="true" /><h2 className="mt-4 font-semibold">{feature.title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{feature.body}</p></article>)}</div></div></section>
  </main>;
}
