import { NextRequest, NextResponse } from 'next/server';
import { requireUser, canEditProposal } from '@/lib/auth';
import { proposalToIntake } from '@/lib/schemas';
import { getProposal, getMaterials, saveDraftSections, markGenerationFailed } from '@/lib/queries';
import { draftProposal } from '@/lib/claude';
import { errorResponse, withEventLog } from '@/lib/api-helpers';

/**
 * POST /api/proposals/:id/generate — the full draft (lib/claude.ts §5.3),
 * one call, all six sections. Refused when readiness is 'blocked' (PRD
 * test 2b): there is no proposal to write, so no call is made.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser('sales');
    const proposal = await getProposal(id);
    if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canEditProposal(user, proposal)) {
      return NextResponse.json({ error: 'Only the author (or an admin) can generate this proposal.' }, { status: 403 });
    }
    if (proposal.status === 'blocked') {
      return NextResponse.json(
        { error: 'This proposal is blocked pending more information. See the clarifying questions.' },
        { status: 409 },
      );
    }
    if (proposal.status !== 'generating' && proposal.status !== 'in_review') {
      return NextResponse.json({ error: `Cannot generate from status '${proposal.status}'.` }, { status: 409 });
    }

    const intake = proposalToIntake(proposal);
    const materials = await getMaterials(id);
    const digests = materials.map((m) => m.digest_md).filter((d): d is string => Boolean(d));

    const draft = await withEventLog(id, user.email, 'draft', async () => {
      const outcome = await draftProposal(intake, digests);
      if (!outcome.ok) throw new Error(`Draft generation failed (${outcome.reason}): ${outcome.message}`);
      return { sections: outcome.data.sections, model: outcome.model, requestId: outcome.requestId };
    });

    await saveDraftSections(id, draft.sections, draft.model, draft.requestId);

    return NextResponse.json({ status: 'in_review', sections: draft.sections });
  } catch (err) {
    await markGenerationFailed(id, err instanceof Error ? err.message : String(err)).catch(() => {});
    return errorResponse(err);
  }
}
