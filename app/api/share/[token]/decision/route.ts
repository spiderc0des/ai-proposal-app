import { NextRequest, NextResponse } from 'next/server';
import { ClientDecisionSchema } from '@/lib/schemas';
import { recordClientDecision, logEvent } from '@/lib/queries';
import { sendClientDecision } from '@/lib/email';
import { sql } from '@/lib/db';
import { env } from '@/lib/env';
import { errorResponse } from '@/lib/api-helpers';

/**
 * POST /api/share/:token/decision — the client accepts or declines.
 *
 * THE ONLY UNAUTHENTICATED WRITE IN THIS APP. Every route under
 * /api/proposals/ opens with requireUser(); this one deliberately cannot,
 * because the person acting is a client with no account, who holds nothing
 * but the link. The token IS the credential, exactly as it already is for
 * reading the proposal and downloading its PDF.
 *
 * That means the authority check cannot live here as an `if` — it lives in
 * recordClientDecision()'s WHERE clause, which matches on the token itself
 * along with the same not-revoked / not-expired / not-deleted conditions the
 * read path enforces. A caller without a valid token matches no row and
 * learns nothing.
 *
 * Not under /api/proposals/[id]/ on purpose: a client never sees a proposal
 * id, and shouldn't need one to answer.
 *
 * A repeat POST is harmless — `status = 'sent'` in that WHERE clause means
 * the second one matches nothing and comes back 409, so there is no separate
 * idempotency handling here or anywhere above it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const body = ClientDecisionSchema.parse(await request.json());

    const result = await recordClientDecision({
      token,
      decision: body.decision,
      name: body.name,
      reason: body.decision === 'decline' ? body.reason : undefined,
    });

    if (!result.ok) {
      // 'not_found' covers every case where the link itself isn't valid —
      // unknown, revoked, expired, deleted. Same opaque 404 the PDF route
      // gives, so none of them can be told apart from outside.
      if (result.reason === 'not_found') {
        return NextResponse.json({ error: 'Not found or link expired.' }, { status: 404 });
      }
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }

    const proposal = result.proposal;

    // The first events row in this app's history whose actor is not a staff
    // email or 'system'. That's the point: the log can finally show both
    // sides of the conversation, not just our own.
    await logEvent({
      proposalId: proposal.id,
      actor: 'client',
      step: body.decision === 'accept' ? 'client:accept' : 'client:decline',
      ok: true,
      detail: {
        decided_by: body.name,
        ...(body.decision === 'decline' ? { reason: body.reason } : {}),
      },
    });

    // Best-effort notification. The decision is already committed; a mail
    // failure must not undo it or fail the client's request, so this is
    // logged as its own step and swallowed.
    await logEvent({
      proposalId: proposal.id,
      actor: 'client',
      step: 'client:notify-author',
      ok: true,
      detail: await notifyAuthor(proposal.author_id, {
        decision: body.decision,
        clientName: body.name,
        companyName: proposal.company_name,
        reason: body.decision === 'decline' ? body.reason : undefined,
        proposalLink: `${env.APP_URL}/p/${proposal.id}`,
      }),
    }).catch(() => {});

    return NextResponse.json({ ok: true, status: proposal.status });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Resolves the author's email and sends, returning what happened for the log. */
async function notifyAuthor(
  authorId: string,
  params: {
    decision: 'accept' | 'decline';
    clientName: string;
    companyName: string;
    reason?: string;
    proposalLink: string;
  },
): Promise<Record<string, unknown>> {
  try {
    const [author] = await sql`select email from app_users where id = ${authorId}`;
    if (!author?.email) return { skipped: true, reason: 'Author has no email on record.' };

    const outcome = await sendClientDecision({ toEmail: author.email, ...params });
    return { ...outcome, to: author.email };
  } catch (err) {
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
