import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { ApproveSchema } from '@/lib/schemas';
import { decideApproval } from '@/lib/queries';
import { errorResponse, withEventLog } from '@/lib/api-helpers';

/**
 * POST /api/proposals/:id/approve.
 *
 * Requires the approver capability (is_approver or is_admin) — no
 * ownership check. The brief asks for a human to verify Claude's output
 * before client delivery, not specifically a different human than whoever
 * authored it, so someone who holds both is_sales and is_approver may
 * approve their own proposal.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser('approver');
    const body = ApproveSchema.parse(await request.json());

    const proposal = await withEventLog(id, user.email, `approval:${body.decision}`, async () =>
      decideApproval({
        proposalId: id,
        decision: body.decision,
        approverId: user.id,
        reason: body.reason,
        expectedVersion: body.version,
      }),
    );

    return NextResponse.json({ status: proposal.status });
  } catch (err) {
    return errorResponse(err);
  }
}
