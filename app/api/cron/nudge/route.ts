import { NextRequest, NextResponse } from 'next/server';
import { env, cronEnabled, emailEnabled } from '@/lib/env';
import {
  listProposalsNeedingNudge, recordNudge, attachNudgeProviderId, logEvent,
} from '@/lib/queries';
import { sendClientNudge } from '@/lib/email';
import { isAuthorisedCronRequest } from '@/lib/cron-auth';
import { NUDGE_AFTER_DAYS } from '@/lib/permissions';

/**
 * GET /api/cron/nudge — the scheduled follow-up.
 *
 * Two days after a proposal reaches a client, if they have neither accepted
 * nor declined, they get one reminder. Before this existed, a proposal
 * nobody got round to answering simply expired: the most avoidable way a
 * pipeline leaks, because the client hasn't said no, they've said nothing.
 *
 * GET rather than POST because that is what Vercel Cron issues. That makes
 * this the only endpoint in the app where a GET sends email, which is why
 * the auth below is stricter than anywhere else rather than looser.
 *
 * There is no session here — a scheduler has no user. The bearer secret is
 * the entire credential, so: no secret configured means the route refuses
 * to run at all (503) rather than running open, and the comparison is
 * timing-safe.
 */
export const runtime = 'nodejs';           // nodemailer + postgres, not edge
export const maxDuration = 60;             // a batch of SMTP round trips
export const dynamic = 'force-dynamic';    // never cached

/** Runaway valve. Today's eligible set is ~1; this is for the day it isn't. */
const BATCH_LIMIT = 25;

export async function GET(request: NextRequest) {
  if (!cronEnabled) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not set — this endpoint will not run unsecured.' },
      { status: 503 },
    );
  }
  if (!isAuthorisedCronRequest(request.headers.get('authorization'), env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Checked up front, not per proposal: without a provider every send would
  // come back `skipped`, and we would have claimed nudges we never attempted.
  if (!emailEnabled) {
    await logEvent({
      proposalId: null,
      actor: 'system',
      step: 'cron:nudge:run',
      ok: false,
      detail: { reason: 'No email provider configured — nothing attempted.' },
    });
    return NextResponse.json({ ok: false, reason: 'email_not_configured' }, { status: 503 });
  }

  const started = Date.now();
  const due = await listProposalsNeedingNudge({
    afterDays: NUDGE_AFTER_DAYS,
    limit: BATCH_LIMIT,
  });

  let nudged = 0;
  let failed = 0;

  for (const proposal of due) {
    // Claim FIRST, send second — the opposite of the send route's ordering,
    // because the risk profile inverts. For a reminder, at-most-once beats
    // at-least-once: a crash between these two lines costs one client a
    // nudge, where the other order could send the same client two. The
    // primary key on nudges.proposal_id is what makes the claim atomic
    // against a concurrent or retried run.
    const claim = await recordNudge({
      proposalId: proposal.id,
      toEmail: proposal.client_email,
      providerId: null,
    });
    if (claim.alreadyNudged) continue;

    const outcome = await sendClientNudge({
      toEmail: proposal.client_email,
      clientName: proposal.client_name,
      companyName: proposal.company_name,
      salespersonName: proposal.salesperson_name,
      proposalLink: `${env.APP_URL}/p/share/${proposal.share_token}`,
    });

    if (outcome.sent) {
      nudged += 1;
      // The claim above had nothing to write here yet; fill it in now so the
      // row matches a deliveries row and can be traced back to the mailbox.
      if (outcome.providerId) await attachNudgeProviderId(proposal.id, outcome.providerId);
    } else {
      failed += 1;
    }

    // The claim stands either way. A failed send is logged loudly rather
    // than retried, because a reminder that retries itself into a loop is
    // worse for the client than one that never arrives.
    await logEvent({
      proposalId: proposal.id,
      actor: 'system',
      step: 'cron:nudge',
      ok: outcome.sent,
      detail: outcome.sent
        ? {
            to: proposal.client_email,
            provider_id: outcome.providerId,
            sent_at: proposal.sent_at,
            days_waited: NUDGE_AFTER_DAYS,
          }
        : { to: proposal.client_email, error: outcome.reason },
    });
  }

  await logEvent({
    proposalId: null,
    actor: 'system',
    step: 'cron:nudge:run',
    ok: true,
    durationMs: Date.now() - started,
    detail: { considered: due.length, nudged, failed, after_days: NUDGE_AFTER_DAYS },
  });

  return NextResponse.json({ ok: true, considered: due.length, nudged, failed });
}
