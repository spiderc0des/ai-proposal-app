import { notFound, redirect } from 'next/navigation';
import { requireUser, AuthError, canViewProposal, canEditProposal } from '@/lib/auth';
import { getProposal, getSections, getMaterials, getNudge } from '@/lib/queries';
import ProposalEditor from './ProposalEditor';
import NotAuthorized from '../../NotAuthorized';

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    // 401: no session at all — /login makes sense.
    // 403: signed in, just not on the allowlist — redirecting to /login
    // would send them in a circle, since they'd sign in again and land
    // right back here. Show why instead.
    if (err.status === 401) redirect('/login');
    return <NotAuthorized message={err.message} />;
  }

  const proposal = await getProposal(id);
  if (!proposal) notFound();

  // Only the author sees their own proposal, except an approver reviewing
  // it (the queue links straight here) or an admin, who sees everything.
  if (!canViewProposal(user, proposal)) {
    return <NotAuthorized message="This proposal belongs to someone else." />;
  }
  // Only the WHO half is decided here. The WHEN half (is this status one
  // whose content may still change?) is derived inside ProposalEditor from
  // its live status state — a value computed here would be frozen at the
  // status this page happened to render with, which for a proposal that is
  // about to be generated is `generating`, and wrong one second later.
  const canEdit = canEditProposal(user, proposal);
  // Approve/Reject live on this page, not on the queue's list row — an
  // approver should see the full generated content before signing off,
  // not click blind from a summary line.
  const canApprove = user.is_approver || user.is_admin;

  // The nudge row only ever exists for a sent proposal, so it isn't worth a
  // round trip on the other statuses.
  const [sections, materials, nudge] = await Promise.all([
    getSections(id),
    getMaterials(id),
    proposal.status === 'sent' ? getNudge(id) : Promise.resolve(null),
  ]);

  // Client Components need JSON-serialisable props — Date objects survive
  // the RSC boundary in some React versions but not reliably across all of
  // them, so they are turned into ISO strings here rather than relied on.
  return (
    <div className="max-w-3xl mx-auto">
      <ProposalEditor
        proposal={{
          ...proposal,
          date_of_call: proposal.date_of_call?.toISOString().slice(0, 10) ?? null,
          sent_at: proposal.sent_at?.toISOString() ?? null,
          client_decision_at: proposal.client_decision_at?.toISOString() ?? null,
        }}
        sections={sections.map((s) => ({
          ...s,
          generated_at: s.generated_at?.toISOString() ?? null,
          edited_at: s.edited_at?.toISOString() ?? null,
        }))}
        materials={materials.map((m) => ({ ...m, created_at: m.created_at.toISOString() }))}
        nudge={nudge ? { sent_at: nudge.sent_at.toISOString() } : null}
        canEdit={canEdit}
        canApprove={canApprove}
      />
    </div>
  );
}

