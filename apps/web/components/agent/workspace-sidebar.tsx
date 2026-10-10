'use client';

import type { MouseEvent } from 'react';
import { useSyncExternalStore } from 'react';
import { BookOpen, CalendarDays, MessageSquare, Moon, Settings, Sun } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type WorkspaceView = 'calendar' | 'courses' | 'chat' | 'settings';

const destinations = [
  { view: 'chat', label: 'Chat', icon: MessageSquare },
  { view: 'calendar', label: 'Calendar', icon: CalendarDays },
  { view: 'courses', label: 'Courses', icon: BookOpen },
  { view: 'settings', label: 'Settings', icon: Settings },
] satisfies { view: WorkspaceView; label: string; icon: typeof MessageSquare }[];

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
  const initials = ownerName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'S';

  function toggleTheme() {
    const nextDarkMode = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', nextDarkMode);
    document.documentElement.dispatchEvent(new Event('polymate-theme-change'));
    try { localStorage.setItem('polymate-theme', nextDarkMode ? 'dark' : 'light'); } catch { /* Theme still works for this session. */ }
  }

  return <aside className="sticky top-0 z-30 flex border-b bg-muted/60 px-3 py-2 backdrop-blur md:h-dvh md:w-64 md:shrink-0 md:flex-col md:border-r md:border-b-0 md:bg-muted/35 md:px-3 md:py-4">
    <a href={hrefFor('chat')} onClick={event => onNavigate(event, 'chat')} className="flex h-10 shrink-0 items-center gap-2 rounded-lg px-2 text-sm font-semibold tracking-tight" aria-label="PolyMate chat">
      <span className="grid size-7 place-items-center rounded-md bg-foreground text-xs font-semibold text-background" aria-hidden="true">P</span>
      <span className="hidden sm:inline">PolyMate</span>
    </a>

    <nav aria-label="Study space" className="ml-auto flex items-center gap-1 md:mt-6 md:ml-0 md:flex-col md:items-stretch">
      {destinations.map(destination => {
        const Icon = destination.icon;
        return <a key={destination.view} href={hrefFor(destination.view)} onClick={event => onNavigate(event, destination.view)} aria-current={view === destination.view ? 'page' : undefined}
          className={cn('flex h-9 items-center gap-3 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:text-sm', view === destination.view && 'bg-accent text-foreground')}>
          <Icon className="size-4" strokeWidth={1.8} aria-hidden="true" />
          <span className={cn(view !== destination.view && 'hidden sm:inline', 'md:inline')}>{destination.label}</span>
        </a>;
      })}
    </nav>

    <div className="mt-auto hidden space-y-3 md:block">
      <Button type="button" variant="ghost" onClick={toggleTheme} aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={darkMode} className="w-full justify-start text-muted-foreground">
        {darkMode ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        {darkMode ? 'Light mode' : 'Dark mode'}
      </Button>
      <div className="flex items-center gap-3 border-t px-2 pt-4">
        <Avatar><AvatarFallback>{initials}</AvatarFallback></Avatar>
        <div className="min-w-0"><p className="truncate text-sm font-medium" title={ownerName}>{ownerName}</p><p className="truncate text-xs text-muted-foreground">ETH study companion</p></div>
      </div>
    </div>
  </aside>;
}
