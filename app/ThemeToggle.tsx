'use client';

/**
 * Light/dark toggle.
 *
 * Deliberately holds no React state. Which icon shows is decided by CSS
 * (app/globals.css, the .theme-icon-* rules) from the same selectors that
 * decide the palette — so the icon cannot disagree with the colours on
 * screen, and it is correct on the very first paint, before any JavaScript
 * runs. A useState here would start out not knowing the OS preference and
 * either render the wrong icon or render nothing until it caught up.
 *
 * The choice is saved as a cookie rather than in localStorage because the
 * SERVER needs it: app/layout.tsx reads it to put data-theme on <html>
 * before anything is sent, which is what prevents a flash of the wrong
 * theme on every page load.
 */
export default function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const chosen = root.dataset.theme;
    const isDark =
      chosen === 'dark' ||
      (!chosen && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const next = isDark ? 'light' : 'dark';

    root.dataset.theme = next;
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  const cls =
    'h-8 w-8 items-center justify-center rounded-full border border-[var(--rule)] ' +
    'text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors';

  return (
    <button type="button" onClick={toggle} title="Switch between light and dark" className="shrink-0">
      {/* Shown in dark mode: a sun, meaning "switch to light". */}
      <span className={`theme-icon-to-light ${cls}`} aria-label="Switch to light mode">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      </span>
      {/* Shown in light mode: a moon, meaning "switch to dark". */}
      <span className={`theme-icon-to-dark ${cls}`} aria-label="Switch to dark mode">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      </span>
    </button>
  );
}
