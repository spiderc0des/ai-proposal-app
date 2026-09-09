import { NextResponse } from 'next/server';
import { requireUser, canViewProposal } from '@/lib/auth';
import { getEvents, getProposal } from '@/lib/queries';
import { errorResponse } from '@/lib/api-helpers';

/**
 * GET /api/proposals/:id/events — the answer to "make failures clear
 * enough to debug." Every step, ok or not, in order.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser();
    const proposal = await getProposal(id);
    if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canViewProposal(user, proposal)) {
      return NextResponse.json({ error: "This proposal belongs to someone else." }, { status: 403 });
    }
    const events = await getEvents(id);
    return NextResponse.json({ events });
  } catch (err) {
    return errorResponse(err);
  }
}
