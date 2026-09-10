'use client';
import { useState } from 'react';

/**
 * The text nav links, collapsed behind a hamburger below the `md`
 * breakpoint — the same links stay a plain inline row at `md` and above
 * (see app/layout.tsx, `hidden md:flex`). The profile avatar is small
 * enough to stay visible at every width, so it isn't duplicated in here.
 */
export default function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);

  const links = [
    { href: '/new', label: 'New proposal' },
    { href: '/proposals', label: isAdmin ? 'All proposals' : 'My proposals' },
    { href: '/queue', label: 'Approval queue' },
    // Same as the desktop nav: admin-only, and the page enforces it anyway.
    ...(isAdmin ? [{ href: '/admin', label: 'People' }] : []),
  ];

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--ink-soft)] hover:bg-[var(--accent-bg)] hover:text-[var(--accent)] transition-colors"
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M4 4l12 12M16 4L4 16" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M3 5h14M3 10h14M3 15h14" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full border-b border-[var(--rule)] bg-[var(--paper)] px-4 py-2 flex flex-col shadow-[var(--shadow-md)]">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="px-2 py-2.5 rounded-md text-sm text-[var(--ink-soft)] hover:text-[var(--accent)] hover:bg-[var(--accent-bg)] transition-colors"
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
