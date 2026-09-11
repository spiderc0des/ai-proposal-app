import { redirect } from 'next/navigation';
import { currentUser, sessionEmail } from '@/lib/auth';
import NameForm from './NameForm';

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const [email, user] = await Promise.all([sessionEmail(), currentUser()]);

  // Profile makes no sense with no session at all — unlike other pages,
  // there is no "not authorized" story here worth showing, just sign in.
  if (!email) redirect('/login');

  const capabilities = user
    ? [
        user.is_sales && { label: 'Sales', hint: 'Creates proposals; sees only your own' },
        user.is_approver && { label: 'Approver', hint: 'Sees the approval queue; can approve or reject' },
        user.is_admin && { label: 'Admin', hint: 'Sees every proposal and log, regardless of author' },
      ].filter((c): c is { label: string; hint: string } => Boolean(c))
    : [];

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-semibold mb-1">Profile</h1>
      <p className="text-sm text-[var(--ink-faint)] mb-6">Your account and how to sign out.</p>

      <div className="card flex items-center gap-4 mb-4">
        <span
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
          style={{ background: 'var(--accent)' }}
        >
          {email[0].toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="font-medium truncate">{user?.full_name || email}</p>
          <p className="text-sm text-[var(--ink-faint)] truncate">{email}</p>
        </div>
      </div>

      {/* Landing here from an invitation link (app/auth/confirm). */}
      {welcome && !user && (
        <div className="panel panel-success mb-4">
          <p className="font-medium mb-1">Invitation accepted</p>
          <p>
            You&apos;re signed in. An admin now needs to activate your account — you&apos;ll
            have access as soon as they do. There&apos;s nothing else you need to do.
          </p>
        </div>
      )}

      {user && <NameForm initial={user.full_name} />}

      {user ? (
        <div className="card mb-4">
          <p className="label mb-2">Capabilities</p>
          {capabilities.length === 0 ? (
            <p className="text-sm text-[var(--ink-faint)]">None assigned — ask an admin.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {capabilities.map((c) => (
                <div key={c.label} className="flex items-start gap-2">
                  <span className="badge" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                    {c.label}
                  </span>
                  <span className="text-xs text-[var(--ink-faint)] pt-0.5">{c.hint}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="panel panel-warning mb-4">
          <p className="font-medium mb-1">Pending activation</p>
          <p>
            You&apos;re signed in, but this account isn&apos;t on the approved list yet. Ask an
            admin to activate you.
          </p>
        </div>
      )}

      <form action="/auth/signout" method="post">
        <button type="submit" className="btn btn-ghost">Sign out</button>
      </form>
    </div>
  );
}
