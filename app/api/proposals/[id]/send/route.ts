import { NextRequest, NextResponse } from 'next/server';
import { requireUser, canViewProposal } from '@/lib/auth';
import {
  checkSendPreconditions, getSections, recordDelivery, markSent, markSendFailed, getProposal,
} from '@/lib/queries';
import { renderProposalPdf } from '@/lib/pdf';
import { sendClientProposal, EMAIL_PROVIDER, NO_EMAIL_PROVIDER } from '@/lib/email';
import { shareToken } from '@/lib/hash';
import { sql } from '@/lib/db';
import { env } from '@/lib/env';
import { errorResponse, withEventLog } from '@/lib/api-helpers';

/**
 * POST /api/proposals/:id/send.
 *
 * This is the approval gate itself, not a check in front of it: calling
 * this route directly, with curl, on a proposal that isn't approved gets
 * exactly the same refusal a button in the UI would produce, because the
 * precondition lives here and in checkSendPreconditions — not in whether a
 * button happened to be disabled.
 *
 * Order matters: PDF and share token exist BEFORE the email is sent, so an
 * email is never dispatched pointing at a document that doesn't exist yet.
 * The delivery row is inserted last and is what makes a second call to this
 * same route return the ORIGINAL result instead of sending twice — its
 * primary key is proposal_id (sql/01-schema.sql).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser(); // either capability may trigger a send once approved

    // Checked before checkSendPreconditions runs, not after — someone with
    // no business seeing this proposal at all shouldn't learn anything
    // about its state, including why it can't be sent yet.
    const existing = await getProposal(id);
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canViewProposal(user, existing)) {
      return NextResponse.json({ error: 'This proposal belongs to someone else.' }, { status: 403 });
    }

    const check = await withEventLog(id, user.email, 'send:precondition', async () => {
      const result = await checkSendPreconditions(id);
      if (!result.ok) throw new Error(result.reason);
      return result;
    });

    if (check.proposal.status === 'sent') {
      // Idempotent read: a second click, or a retry, on an already-sent
      // proposal is a 200 with the original result — not an error.
      const [existing] = await sql`select * from deliveries where proposal_id = ${id}`;
      return NextResponse.json({ status: 'sent', already_sent: true, sent_at: existing?.sent_at });
    }

    const sections = await getSections(id);

    let pdfPath: string;
    try {
      const pdfBuffer = await withEventLog(id, user.email, 'send:pdf', async () =>
        renderProposalPdf(
          {
            client_name: check.proposal.client_name,
            company_name: check.proposal.company_name,
            salesperson_name: check.proposal.salesperson_name,
            date_of_call: check.proposal.date_of_call
              ? check.proposal.date_of_call.toISOString().slice(0, 10)
              : undefined,
          },
          sections,
        ),
      );
      // A label, not a real file location — by design, nothing is ever
      // uploaded anywhere. The client's actual PDF is rendered fresh from
      // the live section rows on every request to the share route
      // (lib/pdf.tsx); rendering it here too is only to confirm it *can*
      // render before the client ever gets a link.
      pdfPath = `proposals/${id}.pdf`;
      void pdfBuffer;
    } catch (err) {
      await markSendFailed(id);
      throw err;
    }

    const token = shareToken();
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const proposalLink = `${env.APP_URL}/p/share/${token}`;

    let emailResult;
    try {
      emailResult = await withEventLog(id, user.email, 'send:email', async () =>
        sendClientProposal({
          clientName: check.proposal.client_name,
          clientEmail: check.proposal.client_email,
          companyName: check.proposal.company_name,
          salespersonName: check.proposal.salesperson_name,
          proposalLink,
        }),
      );
      if (!emailResult.sent && !('skipped' in emailResult && emailResult.skipped)) {
        throw new Error(emailResult.reason);
      }
    } catch (err) {
      await markSendFailed(id);
      throw err;
    }

    // A delivery row is written even when the email was SKIPPED, because the
    // tokenised link and PDF already satisfy the brief's "exported or sent" —
    // so the provider recorded here is whatever actually carried it, which in
    // that case is nothing.
    const { alreadySent } = await recordDelivery({
      proposalId: id,
      toEmail: check.proposal.client_email,
      provider: emailResult.sent ? EMAIL_PROVIDER : NO_EMAIL_PROVIDER,
      providerId: 'providerId' in emailResult ? emailResult.providerId : null,
    });

    await markSent(id, pdfPath, token, expiresAt);

    return NextResponse.json({
      status: 'sent',
      already_sent: alreadySent,
      proposal_link: proposalLink,
      email: emailResult,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
