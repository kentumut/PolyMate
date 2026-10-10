'use client';

import { useSyncExternalStore } from 'react';

export type CollapsiblePanel = 'sidebar' | 'chats';

const changeEvent = (panel: CollapsiblePanel) => `polymate-${panel}-change`;

/**
 * Desktop collapse state for a side panel. It lives on <html data-{panel}="collapsed"> so the
 * inline script in the root layout can restore it before first paint, like the theme.
 */
export function useCollapsedPanel(panel: CollapsiblePanel) {
  const collapsed = useSyncExternalStore(
    callback => {
      document.documentElement.addEventListener(changeEvent(panel), callback);
      return () => document.documentElement.removeEventListener(changeEvent(panel), callback);
    },
    () => document.documentElement.dataset[panel] === 'collapsed',
    () => false,
  );

  function toggle() {
    const root = document.documentElement;
    const nextCollapsed = root.dataset[panel] !== 'collapsed';
    if (nextCollapsed) root.dataset[panel] = 'collapsed';
    else delete root.dataset[panel];
    root.dispatchEvent(new Event(changeEvent(panel)));
    try { localStorage.setItem(`polymate-${panel}`, nextCollapsed ? 'collapsed' : 'expanded'); } catch { /* Layout still works for this session. */ }
  }

  return [collapsed, toggle] as const;
}
