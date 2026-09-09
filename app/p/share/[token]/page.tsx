import { notFound } from 'next/navigation';
import { getProposalByShareToken, getSections } from '@/lib/queries';
import MarkdownBody from '../../../MarkdownBody';

/**
 * The client-facing page. No login, no app chrome — the tokenised URL
 * (32 random bytes, expiring, revocable — see lib/hash.ts shareToken) IS
 * the access control. Nothing else that needs real protection lives behind
 * a link of this kind; this document does not, because the client is meant
 * to be able to open it without an account.
 */
export default async function SharedProposalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const proposal = await getProposalByShareToken(token);
  if (!proposal) notFound();

  const sections = await getSections(proposal.id);

  return (
    <div className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <div className="max-w-2xl mx-auto py-12 sm:py-16 px-6">
        <div className="card" style={{ padding: '2rem 2.25rem' }}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>
            Koya Talent
          </p>
          <h1 className="text-2xl font-semibold mt-1 mb-1 text-wrap-balance">
            Proposal for {proposal.client_name}
          </h1>
          <p className="text-sm text-[var(--ink-faint)] mb-6">
            Prepared by {proposal.salesperson_name}
            {proposal.date_of_call ? ` · ${proposal.date_of_call.toISOString().slice(0, 10)}` : ''}
          </p>

          <a href={`/p/share/${token}/pdf`} className="btn btn-primary mb-8">
            Download PDF
          </a>

          <div className="divider mb-6" />

          {sections.map((s) => (
            <MarkdownBody key={s.section_key} body={s.body_md} />
          ))}
        </div>
      </div>
    </div>
  );
}
