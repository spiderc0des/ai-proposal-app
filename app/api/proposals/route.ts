import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { IntakeSchema } from '@/lib/schemas';
import { createProposal, recordAudit, listProposals } from '@/lib/queries';
import { auditIntake } from '@/lib/claude';
import { errorResponse, withEventLog } from '@/lib/api-helpers';

/**
 * POST /api/proposals — create a proposal from the intake form, then run
 * the pre-flight audit (lib/claude.ts §5.1). If the audit blocks, NO
 * draft-generation call is made — the caller sees the clarifying questions
 * and the Generate action is unavailable.
 */
export async function POST(request: NextRequest) {
  let proposalId: string | null = null;
  try {
    const user = await requireUser('sales');
    const body = await request.json();

    // The salesperson is the signed-in user, full stop. Whatever the request
    // body says for this field is discarded — the form renders it disabled,
    // but a disabled input is only a suggestion to anyone with dev tools or
    // curl, and this value is printed on the client's copy as "Prepared by".
    if (!user.full_name.trim()) {
      return NextResponse.json(
        { error: 'Add your name on your profile first — it is what the client sees as "Prepared by".' },
        { status: 409 },
      );
    }
    const intake = IntakeSchema.parse({ ...body, salesperson_name: user.full_name });

    const proposal = await withEventLog(null, user.email, 'create', async () =>
      createProposal(intake, user.id),
    );
    proposalId = proposal.id;

    const audit = await withEventLog(proposal.id, user.email, 'audit', async () => {
      const outcome = await auditIntake(intake);
      if (!outcome.ok) throw new Error(`Audit failed: ${outcome.message}`);
      return outcome.data;
    });

    const updated = await recordAudit(proposal.id, audit.readiness, audit);

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      readiness: audit.readiness,
      blocking_reason: audit.blocking_reason,
      clarifying_questions: audit.clarifying_questions,
      fields: audit.fields,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    // "Only the author should see the proposal they create" is the
    // general rule; admin is the one exception that sees everything here.
    // An approver (without admin) still sees only their own via this
    // general listing — they see everyone else's pending work specifically
    // through /queue, which is a separate, purpose-built listing.
    const proposals = await listProposals(user.is_admin ? {} : { authorId: user.id });
    return NextResponse.json({ proposals });
  } catch (err) {
    return errorResponse(err);
  }
}
