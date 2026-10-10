'use client';

import type { MouseEvent } from 'react';
import { useSyncExternalStore } from 'react';
import { BookOpen, CalendarDays, LogOut, MessageSquare, Moon, PanelLeftClose, PanelLeftOpen, Settings, Sparkles, Sun } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCollapsedPanel } from './collapsible-panel';

export type WorkspaceView = 'calendar' | 'planner' | 'courses' | 'chat' | 'settings';

const destinations = [
  { view: 'chat', label: 'Chat', icon: MessageSquare },
  { view: 'calendar', label: 'Calendar', icon: CalendarDays },
  { view: 'courses', label: 'Courses', icon: BookOpen },
  { view: 'settings', label: 'Settings', icon: Settings },
] satisfies { view: WorkspaceView; label: string; icon: typeof MessageSquare }[];

export function WorkspaceSidebar({ view, ownerName, demo = false, hrefFor, onNavigate }: {
  view: WorkspaceView;
  ownerName: string;
  demo?: boolean;
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
  const [collapsed, toggleCollapsed] = useCollapsedPanel('sidebar');
  const initials = ownerName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'S';

  function toggleTheme() {
    const nextDarkMode = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', nextDarkMode);
    document.documentElement.dispatchEvent(new Event('polymate-theme-change'));
    try { localStorage.setItem('polymate-theme', nextDarkMode ? 'dark' : 'light'); } catch { /* Theme still works for this session. */ }
  }

  return <aside className={cn('sticky top-0 z-30 flex border-b bg-muted/60 px-3 py-2 backdrop-blur md:h-dvh md:shrink-0 md:flex-col md:border-r md:border-b-0 md:bg-muted/35 md:px-3 md:py-4', collapsed ? 'md:w-16 md:px-2' : 'md:w-64')}>
    <div className={cn('flex shrink-0 items-center', collapsed && 'md:flex-col md:gap-2')}>
      <a href={hrefFor('chat')} onClick={event => onNavigate(event, 'chat')} className={cn('flex h-10 shrink-0 items-center rounded-lg px-2 text-base font-semibold tracking-tight', collapsed && 'md:hidden')} aria-label="PolyMate chat">PolyMate</a>
      <Button type="button" variant="ghost" size="icon" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className={cn('hidden text-muted-foreground md:inline-flex', !collapsed && 'ml-auto')}>
        {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
      </Button>
    </div>

    {/* Full page loads: the server decides demo mode from the query, so leaving needs a fresh render without it. */}
    <a href={demo ? '/calendar?view=chat' : '/demo'} title={collapsed ? (demo ? 'Exit demo' : 'Mentor demo') : undefined} className={cn('ml-1 flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border bg-background px-2.5 text-xs font-medium shadow-sm transition-colors hover:bg-accent md:mt-3 md:ml-0', collapsed ? 'md:size-9 md:self-center md:px-0' : 'md:justify-start md:px-3')} aria-label={demo ? 'Exit mentor demo' : 'Open mentor demo'}>
      {demo ? <LogOut className="size-3.5" aria-hidden="true" /> : <Sparkles className="size-3.5" aria-hidden="true" />}
      <span className={cn('hidden sm:inline', collapsed && 'md:hidden')}>{demo ? 'Exit demo' : 'Mentor demo'}</span>
    </a>

    <nav aria-label="Study space" className="ml-auto flex items-center gap-1 md:mt-6 md:ml-0 md:flex-col md:items-stretch">
      {destinations.map(destination => {
        const Icon = destination.icon;
        const active = view === destination.view || (view === 'planner' && destination.view === 'courses');
        return <a key={destination.view} href={hrefFor(destination.view)} onClick={event => onNavigate(event, destination.view)} aria-label={destination.label} aria-current={active ? 'page' : undefined} title={collapsed ? destination.label : undefined}
          className={cn('flex h-10 min-w-10 items-center justify-center gap-2 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:min-w-0 sm:justify-start sm:gap-3 sm:px-3 md:h-9 md:text-sm', collapsed && 'md:justify-center md:px-0', active && 'bg-accent text-foreground')}>
          <Icon className="size-4" strokeWidth={1.8} aria-hidden="true" />
          <span className={cn(!active && 'hidden sm:inline', collapsed ? 'md:hidden' : 'md:inline')}>{destination.label}</span>
        </a>;
      })}
    </nav>

    <div className="mt-auto hidden space-y-3 md:block">
      <Button type="button" variant="ghost" onClick={toggleTheme} aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={darkMode} title={collapsed ? (darkMode ? 'Light mode' : 'Dark mode') : undefined} className={cn('w-full text-muted-foreground', collapsed ? 'justify-center px-0' : 'justify-start')}>
        {darkMode ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
        {!collapsed && (darkMode ? 'Light mode' : 'Dark mode')}
      </Button>
      <div className={cn('flex items-center gap-3 border-t pt-4', collapsed ? 'justify-center' : 'px-2')} title={collapsed ? ownerName : undefined}>
        <Avatar><AvatarFallback>{initials}</AvatarFallback></Avatar>
        <div className={cn('min-w-0', collapsed && 'hidden')}><p className="truncate text-sm font-medium" title={ownerName}>{ownerName}</p><p className="truncate text-xs text-muted-foreground">ETH study companion</p></div>
      </div>
    </div>
  </aside>;
}
