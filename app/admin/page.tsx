import { redirect } from 'next/navigation';
import { requireUser, AuthError } from '@/lib/auth';
import { listAppUsers } from '@/lib/queries';
import NotAuthorized from '../NotAuthorized';
import UserAccessTable from './UserAccessTable';
import InviteForm from './InviteForm';

/**
 * /admin — who can get in, and what they can do once they are in.
 *
 * This closes the last workflow that still required editing SQL by hand.
 * Signing in creates a pending `app_users` row (active = false); before
 * this page, activating that row meant opening sql/03-seed-users.sql,
 * editing an email into it, and running it against the database. Which is
 * fine for the person who built the app and impossible for anyone else.
 *
 * Gated on is_admin directly rather than through requireUser's capability
 * argument, which only knows 'sales' and 'approver'. That is deliberate:
 * is_admin is not a peer of those two — it bypasses per-proposal ownership
 * everywhere ownership is checked — so it is never something a route asks
 * for by passing a string.
 */
export default async function AdminPage() {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    if (err.status === 401) redirect('/login');
    return <NotAuthorized message={err.message} />;
  }

  if (!user.is_admin) {
    return (
      <NotAuthorized message="This page is for admins. You can still use everything your own capabilities allow." />
    );
  }

  const users = await listAppUsers();
  const pending = users.filter((u) => !u.active);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold mb-1">People &amp; access</h1>
      <p className="text-sm text-[var(--ink-faint)] mb-6 max-w-prose">
        Anyone who signs in appears here as pending until you activate them.
        The three capabilities are independent, not a single role — someone
        can hold any combination, and holding both sales and approver is how
        self-approval works.
      </p>

      <InviteForm />

      {pending.length > 0 && (
        <div className="panel panel-warning mb-6 text-sm">
          <p className="font-semibold mb-1">
            {pending.length === 1
              ? 'One person is waiting to be let in'
              : `${pending.length} people are waiting to be let in`}
          </p>
          <p>
            Pending people are listed first below. Someone marked{' '}
            <b>signed in</b> is waiting on you; someone marked <b>invited</b>{' '}
            hasn&apos;t clicked their link yet, so you can resend it.
          </p>
        </div>
      )}

      <UserAccessTable users={users.map(serialize)} currentUserId={user.id} />

      <div className="card mt-6 text-sm text-[var(--ink-soft)]">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)] mb-2">
          What each capability means
        </h2>
        <ul className="flex flex-col gap-1.5">
          <li>
            <b className="text-[var(--ink)]">Sales</b> — create proposals, generate and
            edit them, and send an approved one to the client. Sees only their own.
          </li>
          <li>
            <b className="text-[var(--ink)]">Approver</b> — reach the approval queue and
            approve or reject anyone&apos;s proposal. Nothing reaches a client without
            this.
          </li>
          <li>
            <b className="text-[var(--ink)]">Admin</b> — everything above on every
            proposal regardless of who wrote it, plus this page. Grant it sparingly.
          </li>
          <li>
            <b className="text-[var(--ink)]">Active</b> — off means they can sign in but
            reach nothing. An active person must hold at least one capability, so the
            database refuses to save an active user with none.
          </li>
        </ul>
      </div>
    </div>
  );
}

function serialize(u: Awaited<ReturnType<typeof listAppUsers>>[number]) {
  return {
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    is_sales: u.is_sales,
    is_approver: u.is_approver,
    is_admin: u.is_admin,
    active: u.active,
    // Dates cross the Server→Client boundary as strings; see app/p/[id]/page.tsx.
    invited_at: u.invited_at?.toISOString() ?? null,
    invited_by: u.invited_by ?? null,
    first_signed_in_at: u.first_signed_in_at?.toISOString() ?? null,
  };
}
