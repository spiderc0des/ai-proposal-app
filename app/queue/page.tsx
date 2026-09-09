import { redirect } from 'next/navigation';
import { requireUser, AuthError } from '@/lib/auth';
import { listProposals } from '@/lib/queries';
import StatusPill from '../StatusPill';
import NotAuthorized from '../NotAuthorized';

export default async function QueuePage() {
  let user;
  try {
    // Only the is_approver capability grants entry here — someone who is
    // ALSO is_sales still gets in fine (both is not either/or), but a
    // sales-only user is turned away below without ever reaching the list.
    user = await requireUser('approver');
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    // A sales-only user visiting /queue is signed in fine — requireUser('approver')
    // 403s on missing capability, not on session. Redirecting to /login here
    // would sign them straight back in and land them right back on this
    // same 403.
    if (err.status === 401) redirect('/login');
    return <NotAuthorized message={err.message} />;
  }

  const proposals = await listProposals({ status: ['pending_approval'] });

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-1">Approval queue</h1>
      <p className="text-sm text-[var(--ink-faint)] mb-6 max-w-prose">
        Everything pending approval, from every salesperson, shows up here —
        including your own, if you also hold the sales capability. Open a
        proposal to review it in full before approving or rejecting — that
        happens on its own page, not here.
      </p>

      {proposals.length === 0 && (
        <div className="card text-sm text-[var(--ink-soft)]">Nothing waiting.</div>
      )}

      <div className="flex flex-col gap-2">
        {proposals.map((p) => (
          <a key={p.id} href={`/p/${p.id}`} className="card-link">
            <div className="min-w-0">
              <p className="font-medium truncate">
                {p.company_name}
                {p.author_id === user.id && (
                  <span className="chip ml-2 align-middle">yours</span>
                )}
              </p>
              <p className="text-xs text-[var(--ink-faint)] truncate">
                {p.client_name} · by {p.salesperson_name}
              </p>
            </div>
            <StatusPill status={p.status} />
          </a>
        ))}
      </div>
    </div>
  );
}
