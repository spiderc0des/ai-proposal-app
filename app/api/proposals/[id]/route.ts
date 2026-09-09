import { NextResponse } from 'next/server';
import { requireUser, canEditProposal } from '@/lib/auth';
import { getProposal, deleteProposal, logEvent } from '@/lib/queries';
import { errorResponse } from '@/lib/api-helpers';

/**
 * DELETE /api/proposals/:id — remove a proposal that never needs to be
 * sent, or that was created by mistake (an empty draft, wrong client, a
 * `blocked` proposal with nothing worth keeping).
 *
 * A `sent` proposal can never be deleted, by anyone, including an admin —
 * it is the delivered record and the audit trail depends on it still
 * existing. Every other status is deletable by its author or an admin.
 * This is a SOFT delete (lib/queries.ts deleteProposal) — see that
 * function for why a real DELETE isn't possible here at all.
 *
 * Logged with `proposalId: null`: once deleted, the proposal is excluded
 * from every lookup (including the one canViewProposal's page would use to
 * show its own event log), so a row tied to its id would be orphaned from
 * anything that could ever display it. The detail blob carries what was
 * deleted instead.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser();
    const proposal = await getProposal(id);
    if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canEditProposal(user, proposal)) {
      return NextResponse.json({ error: 'Only the author (or an admin) can delete this proposal.' }, { status: 403 });
    }

    const result = await deleteProposal(id);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }

    await logEvent({
      proposalId: null,
      actor: user.email,
      step: 'delete',
      ok: true,
      detail: { proposal_id: id, company_name: proposal.company_name, was_status: proposal.status },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
