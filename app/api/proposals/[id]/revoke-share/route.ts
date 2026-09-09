import { NextResponse } from 'next/server';
import { requireUser, canEditProposal } from '@/lib/auth';
import { getProposal, revokeShare, logEvent } from '@/lib/queries';
import { errorResponse } from '@/lib/api-helpers';

/**
 * POST /api/proposals/:id/revoke-share — switch off a sent proposal's
 * client-facing link.
 *
 * Until this existed, a sent proposal's tokenised link was live for its full
 * 90 days with no way to turn it off short of editing the database by hand —
 * no recourse for a wrong client email, a send by mistake, or content that
 * shouldn't stay reachable. Nothing else changes: the share page and its PDF
 * route already refuse a revoked proposal, because
 * getProposalByShareToken() has always filtered on the flag this sets.
 *
 * Gated on canEditProposal (author or admin), deliberately narrower than the
 * send route's canViewProposal: killing a client-facing artifact is closer to
 * deleting than to sending, so it matches who can delete.
 *
 * One-way — see lib/queries.ts revokeShare() for why there is no un-revoke.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser();
    const proposal = await getProposal(id);
    if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canEditProposal(user, proposal)) {
      return NextResponse.json(
        { error: 'Only the author (or an admin) can revoke this proposal’s client link.' },
        { status: 403 },
      );
    }

    const result = await revokeShare(id);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }

    await logEvent({
      proposalId: id,
      actor: user.email,
      step: 'share:revoke',
      ok: true,
      detail: { company_name: proposal.company_name, client_email: proposal.client_email },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
