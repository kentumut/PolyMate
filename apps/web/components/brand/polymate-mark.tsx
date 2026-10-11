export function PolyMateMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
    <path d="M16 2.5v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="16" cy="2.5" r="1.4" fill="currentColor" />
    <path d="M7 10H5.5v5H7m18-5h1.5v5H25" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <rect x="7" y="6" width="18" height="15" rx="5" fill="#08407E" opacity=".45" />
    <rect x="7" y="5" width="18" height="15" rx="5" fill="currentColor" />
    <path d="M11 7.2h10" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" opacity=".55" />
    <circle cx="12.5" cy="11.5" r="1.5" fill="#215CAF" />
    <circle cx="19.5" cy="11.5" r="1.5" fill="#215CAF" />
    <path d="M12.5 15.5c2.3 1.5 4.7 1.5 7 0" stroke="#215CAF" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M3.5 17c5.1 0 9.2 1.5 12.5 4.6v8.4c-3.3-2.1-7.4-3.2-12.5-3.2V17Zm25 0c-5.1 0-9.2 1.5-12.5 4.6v8.4c3.3-2.1 7.4-3.2 12.5-3.2V17Z" fill="#08407E" opacity=".5" />
    <path d="M3.5 16c5.1 0 9.2 1.5 12.5 4.6v8.8c-3.3-2.4-7.4-3.6-12.5-3.6V16Z" fill="#fff" stroke="#215CAF" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M28.5 16c-5.1 0-9.2 1.5-12.5 4.6v8.8c3.3-2.4 7.4-3.6 12.5-3.6V16Z" fill="#fff" stroke="#215CAF" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M7.5 20.5c2.4.2 4.3.8 5.9 1.8m11.1-1.8c-2.4.2-4.3.8-5.9 1.8" stroke="#215CAF" strokeWidth="1.2" strokeLinecap="round" />
  </svg>;
}
