import { redirect } from 'next/navigation';
import { requireUser, AuthError } from '@/lib/auth';
import { listProposals } from '@/lib/queries';
import StatusPill from '../StatusPill';
import NotAuthorized from '../NotAuthorized';
import DeleteProposalButton from './DeleteProposalButton';

/**
 * Every proposal a salesperson has started, at every status — including
 * ones never submitted (draft/blocked/in_review), and the outcome of ones
 * that were (approved/rejected/sent). Without this, a proposal that isn't
 * bookmarked is effectively lost the moment you navigate away from it.
 *
 * Visibility matches GET /api/proposals: a plain is_sales user sees only
 * what they authored; is_admin sees everything, regardless of author.
 */
export default async function ProposalsPage() {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    if (err.status === 401) redirect('/login');
    return <NotAuthorized message={err.message} />;
  }

  const proposals = await listProposals(user.is_admin ? {} : { authorId: user.id });

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
      <p className="text-sm text-[var(--ink-faint)] mb-6 max-w-prose">
        {user.is_admin
          ? 'Every proposal in the system, from every salesperson, regardless of status.'
          : 'Every proposal you’ve started, at whatever stage it’s at — drafts you haven’t submitted included.'}
      </p>

      {proposals.length === 0 && (
        <div className="card text-sm text-[var(--ink-soft)]">
          {user.is_sales || user.is_admin ? (
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
                <p className="text-xs text-[var(--ink-faint)] truncate">
                  {p.client_name}
                  {user.is_admin && ` · by ${p.salesperson_name}`}
                  {' · updated '}
                  {new Date(p.updated_at).toLocaleDateString()}
                </p>
              </div>
              <StatusPill status={p.status} />
            </a>
            {/* A sent proposal is the delivered record — never deletable, by
                anyone. Every other status is, by its author or an admin. */}
            {p.status !== 'sent' && <DeleteProposalButton id={p.id} companyName={p.company_name} />}
          </div>
        ))}
      </div>
    </div>
  );
}
