import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, canEditProposal } from '@/lib/auth';
import { submitForApproval, getProposal } from '@/lib/queries';
import { sendApprovalRequest } from '@/lib/email';
import { env } from '@/lib/env';
import { errorResponse, withEventLog } from '@/lib/api-helpers';
import { sql } from '@/lib/db';

const Body = z.object({ version: z.coerce.number().int().positive() });

/**
 * POST /api/proposals/:id/submit — moves in_review -> pending_approval.
 * Guarded by the database itself (lib/queries.ts submitForApproval): the
 * UPDATE's WHERE clause only matches a proposal that is actually
 * `in_review` at the expected version — a stale or already-submitted
 * proposal is refused there, not by a UI opinion.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser('sales');
    const body = Body.parse(await request.json());

    const existing = await getProposal(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canEditProposal(user, existing)) {
      return NextResponse.json({ error: 'Only the author (or an admin) can submit this proposal.' }, { status: 403 });
    }

    const proposal = await submitForApproval(id, body.version);

    // Best-effort notification. A failed email must not undo the submit —
    // it is a real, separate step and gets its own events row either way.
    await withEventLog(id, user.email, 'notify-approver', async () => {
      const [approver] = await sql`select email from app_users where is_approver and active limit 1`;
      const to = approver?.email ?? env.DEFAULT_APPROVER_EMAIL;
      if (!to) return { skipped: true, reason: 'No approver configured.' };
      return sendApprovalRequest({
        approverEmail: to,
        authorName: user.full_name || user.email,
        companyName: proposal.company_name,
        reviewLink: `${env.APP_URL}/p/${id}`,
      });
    }).catch(() => {
      // logged by withEventLog already; submission itself already succeeded
    });

    // The version is returned on every mutating route, and the client
    // ASSIGNS it rather than incrementing its own copy. Submit is why: it
    // bumps the version server-side, the client used to ignore that, and the
    // very next action (Approve) then failed the optimistic-lock check with
    // "Someone else changed this proposal first" — in one session, one tab,
    // with nobody else involved.
    return NextResponse.json({ status: proposal.status, version: proposal.version });
  } catch (err) {
    return errorResponse(err);
  }
}
