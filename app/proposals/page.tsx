import { redirect } from 'next/navigation';
import { requireUser, AuthError } from '@/lib/auth';
import { listProposals, countProposalsByStatus } from '@/lib/queries';
import StatusPill from '../StatusPill';
import NotAuthorized from '../NotAuthorized';
import DeleteProposalButton from './DeleteProposalButton';

/**
 * Every proposal a salesperson has started, at every status — including
 * ones never submitted (draft/blocked/in_review), and the outcome of ones
 * that were (approved/rejected/sent/accepted/declined). Without this, a
 * proposal that isn't bookmarked is effectively lost the moment you
 * navigate away from it.
 *
 * Visibility matches GET /api/proposals: a plain is_sales user sees only
 * what they authored; is_admin sees everything, regardless of author.
 */

/**
 * Once a proposal reaches a client it stays on the record — mirrors the
 * guard in lib/queries.ts deleteProposal, so this page never offers a
 * delete button the route would only refuse.
 */
const UNDELETABLE = new Set(['sent', 'accepted', 'declined']);

/**
 * Workflow order, not alphabetical — the filter reads as the journey a
 * proposal actually takes, so the one you want is where you'd expect it.
 * Statuses with no proposals are dropped at render time.
 */
const STATUS_ORDER = [
  'draft',
  'blocked',
  'generating',
  'in_review',
  'pending_approval',
  'approved',
  'rejected',
  'sent',
  'accepted',
  'declined',
  'send_failed',
] as const;

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  blocked: 'Blocked',
  generating: 'Generating',
  in_review: 'In review',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  send_failed: 'Send failed',
};

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    if (err.status === 401) redirect('/login');
    return <NotAuthorized message={err.message} />;
  }

  // The filter lives in the URL rather than component state: it survives a
  // reload, it can be linked to and bookmarked, and the page stays a plain
  // Server Component with no client-side JS behind it.
  const { status: requested } = await searchParams;
  const active = requested && STATUS_ORDER.includes(requested as (typeof STATUS_ORDER)[number])
    ? requested
    : null;

  const scope = user.is_admin ? {} : { authorId: user.id };
  const [proposals, counts] = await Promise.all([
    listProposals(active ? { ...scope, status: [active] } : scope),
    countProposalsByStatus(scope),
  ]);

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const present = STATUS_ORDER.filter((s) => (counts[s] ?? 0) > 0);

  function chipClass(isActive: boolean) {
    return isActive
      ? 'chip'
      : 'chip hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors';
  }
  const activeStyle = { background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'var(--accent)' };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-baseline justify-between mb-1 gap-4 flex-wrap">
        <h1 className="text-xl font-semibold">
          {user.is_admin ? 'All proposals' : 'My proposals'}
        </h1>
        {(user.is_sales || user.is_admin) && (
          <a href="/new" className="btn btn-primary">
            + New proposal
          </a>
        )}
      </div>
      <p className="text-sm text-[var(--ink-faint)] mb-4 max-w-prose">
        {user.is_admin
          ? 'Every proposal in the system, from every salesperson, regardless of status.'
          : 'Every proposal you’ve started, at whatever stage it’s at — drafts you haven’t submitted included.'}
      </p>

      {total > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <a href="/proposals" className={chipClass(!active)} style={!active ? activeStyle : undefined}>
            All ({total})
          </a>
          {present.map((s) => (
            <a
              key={s}
              href={`/proposals?status=${s}`}
              className={chipClass(active === s)}
              style={active === s ? activeStyle : undefined}
            >
              {STATUS_LABELS[s]} ({counts[s]})
            </a>
          ))}
        </div>
      )}

      {proposals.length === 0 && (
        <div className="card text-sm text-[var(--ink-soft)]">
          {active ? (
            <>
              Nothing at <span className="font-medium">{STATUS_LABELS[active] ?? active}</span>.{' '}
              <a href="/proposals" className="btn-link">Show all</a>.
            </>
          ) : user.is_sales || user.is_admin ? (
            <>Nothing yet. <a href="/new" className="btn-link">Start a proposal</a>.</>
          ) : (
            'Nothing yet — nothing here is authored by you.'
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {proposals.map((p) => (
          <div key={p.id} className="card-link">
            <a href={`/p/${p.id}`} className="flex items-center justify-between gap-4 flex-1 min-w-0">
              <div className="min-w-0">
                <p className="font-medium truncate">{p.company_name}</p>
                <p className="text-xs text-[var(--ink-soft)] truncate">{p.client_name}</p>
                {/* Plain text, not a mailto: link — this whole row is already
                    an <a> to the proposal, and a link nested inside a link
                    is invalid HTML that browsers resolve unpredictably. */}
                <p className="text-xs text-[var(--ink-faint)] truncate">{p.client_email}</p>
                <p className="text-xs text-[var(--ink-faint)] truncate mt-0.5">
                  {user.is_admin && `by ${p.salesperson_name} · `}
                  {'updated '}
                  {new Date(p.updated_at).toLocaleDateString()}
                </p>
              </div>
              <StatusPill status={p.status} />
            </a>
            {!UNDELETABLE.has(p.status) && (
              <DeleteProposalButton id={p.id} companyName={p.company_name} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
