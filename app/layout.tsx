import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import "./globals.css";
import { currentUser, sessionEmail } from '@/lib/auth';
import MobileNav from './MobileNav';

const font = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Koya Proposal Engine',
  description: 'Turn a discovery call into a client-ready proposal.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Two different questions: is there a session at all (sessionEmail), and
  // is that session an activated app_users row (currentUser). A pending
  // user has a session but no row — they still need the nav (to reach
  // Profile > Sign out), so gating is on sessionEmail, not on currentUser.
  const [email, user] = await Promise.all([sessionEmail(), currentUser()]);
  const initial = email ? email[0].toUpperCase() : '?';

  return (
    <html lang="en" className={font.variable}>
      <body className="min-h-screen">
        <header className="relative sticky top-0 z-10 border-b border-[var(--rule)] bg-[var(--paper)]/95 backdrop-blur px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <a href={email ? '/proposals' : '/login'} className="flex items-center gap-2 font-semibold tracking-tight text-[var(--ink)] shrink-0">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-white text-sm font-bold"
              style={{ background: 'var(--accent)' }}
            >
              K
            </span>
            <span className="hidden sm:inline">Koya Proposal Engine</span>
          </a>

          {email ? (
            <div className="flex items-center gap-1">
              <nav className="hidden md:flex items-center gap-1 text-sm">
                <a href="/new" className="px-3 py-1.5 rounded-md text-[var(--ink-soft)] hover:text-[var(--accent)] hover:bg-[var(--accent-bg)] transition-colors">
                  New proposal
                </a>
                <a href="/proposals" className="px-3 py-1.5 rounded-md text-[var(--ink-soft)] hover:text-[var(--accent)] hover:bg-[var(--accent-bg)] transition-colors">
                  {user?.is_admin ? 'All proposals' : 'My proposals'}
                </a>
                <a href="/queue" className="px-3 py-1.5 rounded-md text-[var(--ink-soft)] hover:text-[var(--accent)] hover:bg-[var(--accent-bg)] transition-colors">
                  Approval queue
                </a>
              </nav>
              <MobileNav isAdmin={Boolean(user?.is_admin)} />
              <a
                href="/profile"
                title={email}
                className="ml-2 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold border border-[var(--rule)] text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
              >
                {initial}
              </a>
            </div>
          ) : (
            <a href="/login" className="btn btn-primary">Sign in</a>
          )}
        </header>
        {/* Widened from max-w-3xl so /new can lay its fields out in real
            columns; every other page re-narrows itself back to max-w-3xl
            (see each page's root element) so nothing else changes width. */}
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
