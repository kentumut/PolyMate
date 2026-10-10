'use client';

import type { MouseEvent } from 'react';
import { useSyncExternalStore } from 'react';

export type WorkspaceView = 'calendar' | 'planner' | 'chat' | 'settings';

const destinations: { view: WorkspaceView; label: string }[] = [
  { view: 'calendar', label: 'Calendar' },
  { view: 'planner', label: 'Semester plan' },
  { view: 'chat', label: 'Chat' },
  { view: 'settings', label: 'Settings' },
];

function NavigationIcon({ view }: { view: WorkspaceView }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {view === 'calendar' && <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2M8 18h2" /></>}
    {view === 'planner' && <><path d="M4 5.5h16M6 3v5M18 3v5M4 10h16v10H4z" /><path d="m8 15 2 2 5-5" /></>}
    {view === 'chat' && <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" />}
    {view === 'settings' && <><path d="m9 3-.5 2-2 1-2-.5-2 3 1.5 1.5v3L2.5 15l2 3 2-.5 2 1 .5 2h4l.5-2 2-1 2 .5 2-3-1.5-2v-3L20.5 8l-2-3-2 .5-2-1-.5-2z" /><circle cx="11.5" cy="12" r="3" /></>}
  </svg>;
}

export function WorkspaceSidebar({ view, ownerName, hrefFor, onNavigate }: {
  view: WorkspaceView;
  ownerName: string;
  hrefFor: (view: WorkspaceView) => string;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, view: WorkspaceView) => void;
}) {
  const darkMode = useSyncExternalStore(
    callback => {
      document.documentElement.addEventListener('polymate-theme-change', callback);
      return () => document.documentElement.removeEventListener('polymate-theme-change', callback);
    },
    () => document.documentElement.classList.contains('dark'),
    () => false,
  );
  const initials = ownerName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  function toggleTheme() {
    const nextDarkMode = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', nextDarkMode);
    document.documentElement.dispatchEvent(new Event('polymate-theme-change'));
    try { localStorage.setItem('polymate-theme', nextDarkMode ? 'dark' : 'light'); } catch { /* Theme still works for this session. */ }
  }

  return <aside className="sticky top-0 z-10 flex border-b border-[#dce3db] bg-[#eef2eb] px-4 py-3 md:h-dvh md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:px-5 md:py-8">
    <a href={hrefFor('calendar')} onClick={event => onNavigate(event, 'calendar')} className="flex shrink-0 items-center gap-3 font-semibold tracking-tight md:px-2 md:text-xl" aria-label="PolyMate calendar">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#173b32] text-lg text-white" aria-hidden="true">p.</span>
      <span className="hidden sm:inline">PolyMate</span>
    </a>
    <div className="ml-auto md:mt-12 md:ml-0">
      <p className="mb-3 hidden px-3 text-[10px] font-semibold tracking-[0.18em] text-[#748278] md:block">YOUR SPACE</p>
      <nav aria-label="Study space" className="flex gap-1 md:flex-col md:gap-2">
        {destinations.map(destination => <a key={destination.view} href={hrefFor(destination.view)} onClick={event => onNavigate(event, destination.view)} aria-current={view === destination.view ? 'page' : undefined}
          className={`flex items-center gap-2 rounded-xl px-3 py-3 text-xs font-medium transition-colors md:gap-3 md:px-4 md:text-sm ${view === destination.view ? 'bg-[#173b32] text-white shadow-sm' : 'text-[#617269] hover:bg-[#e1e8dc] hover:text-[#173b32]'}`}>
          <span className="hidden sm:block"><NavigationIcon view={destination.view} /></span>
          {destination.label}
        </a>)}
      </nav>
      <button type="button" onClick={toggleTheme} aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={darkMode}
        className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-medium text-[#617269] transition-colors hover:bg-[#e1e8dc] hover:text-[#173b32] md:w-full md:px-4 md:text-sm">
        <span aria-hidden="true">{darkMode ? '☀' : '☾'}</span>{darkMode ? 'Light mode' : 'Dark mode'}
      </button>
    </div>
    <div className="mt-auto hidden border-t border-[#d6dfd1] pt-5 md:block">
      <div className="flex items-center gap-3 px-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#d6dfd1] bg-white text-xs font-semibold" aria-hidden="true">{initials}</span>
        <div className="min-w-0"><p className="truncate text-sm font-medium" title={ownerName}>{ownerName}</p><p className="mt-0.5 text-xs text-[#748278]">ETH study companion</p></div>
      </div>
    </div>
  </aside>;
}
