import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, canEditProposal } from '@/lib/auth';
import { getProposal, setNudgePaused, logEvent } from '@/lib/queries';
import { errorResponse } from '@/lib/api-helpers';

/**
 * POST /api/proposals/:id/nudge-pause — turn the scheduled follow-up on or
 * off for one proposal.
 *
 * The app can see the client open the share link and answer on it; it cannot
 * see them reply to the salesperson by email, or say yes on a call. This is
 * the switch for exactly that case — without it the only honest options
 * would be to nudge someone who has already responded, or not to nudge at
 * all.
 *
 * Gated on canEditProposal (author or admin), matching revoke-share: both
 * change what the client receives.
 *
 * Reversible, unlike revoking a link, so it takes the desired state rather
 * than being a one-way toggle — a mis-click costs nothing.
 */
const Body = z.object({ paused: z.boolean() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser();
    const proposal = await getProposal(id);
    if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canEditProposal(user, proposal)) {
      return NextResponse.json(
        { error: 'Only the author (or an admin) can change follow-ups on this proposal.' },
        { status: 403 },
      );
    }

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Expected { paused: boolean }.' }, { status: 400 });
    }

    const result = await setNudgePaused(id, parsed.data.paused);
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

    await logEvent({
      proposalId: id,
      actor: user.email,
      step: parsed.data.paused ? 'nudge:pause' : 'nudge:resume',
      ok: true,
      detail: { company_name: proposal.company_name },
    });

    return NextResponse.json({ ok: true, paused: parsed.data.paused });
  } catch (err) {
    return errorResponse(err);
  }
}
