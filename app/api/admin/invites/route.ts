import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { findAppUserByEmail, upsertInvitedUser, logEvent } from '@/lib/queries';
import { sendInvite } from '@/lib/email';
import { env } from '@/lib/env';
import { errorResponse } from '@/lib/api-helpers';

/**
 * POST /api/admin/invites — invite a person by email.
 *
 * Why generateLink() and not Supabase's own inviteUserByEmail(): the SDK is
 * explicit that "PKCE is not supported when using inviteUserByEmail", and
 * this app's sign-in is PKCE (app/auth/callback exchanges a `code`). Their
 * invite email would land the person with tokens in a URL fragment that no
 * route here reads. generateLink() instead creates the account and HANDS
 * BACK the link without sending anything — so we send our own email, from
 * our own provider, in our own layout, and it gets logged like every other
 * send.
 *
 * The link we build points at /auth/confirm on this app's own domain, not
 * at Supabase's /verify endpoint. The token is verified by our server
 * calling verifyOtp(). Nothing depends on Supabase's redirect-URL
 * allowlist — the setting that sent production magic links to localhost.
 *
 * The invited person is PENDING. An invite is permission to sign in, never
 * access itself; an admin activates them afterwards.
 */
const Body = z
  .object({
    email: z.string().trim().toLowerCase().email('That does not look like an email address.'),
    full_name: z.string().trim().min(1, 'Add their name — it is what clients see as "Prepared by".').max(120),
    is_sales: z.boolean(),
    is_approver: z.boolean(),
    is_admin: z.boolean(),
  })
  .refine((b) => b.is_sales || b.is_approver || b.is_admin, {
    message: 'Choose at least one capability — an account with none can sign in and reach nothing.',
    path: ['is_sales'],
  });

function alreadyRegistered(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === 'email_exists' ||
    err.code === 'user_already_exists' ||
    /already (been )?registered/i.test(err.message ?? '')
  );
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireUser();
    if (!admin.is_admin) {
      return NextResponse.json({ error: 'Only an admin can invite people.' }, { status: 403 });
    }

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 });
    }
    const body = parsed.data;

    const existing = await findAppUserByEmail(body.email);
    if (existing?.active) {
      return NextResponse.json(
        { error: `${body.email} already has access. Change their capabilities in the list below instead.` },
        { status: 409 },
      );
    }

    // 'invite' creates the account. If one already exists — a pending row
    // being re-invited, or someone who started signing in once and never
    // finished — Supabase refuses 'invite', and 'magiclink' produces an
    // equivalent sign-in link for the account that is already there.
    let result = await supabaseAdmin.auth.admin.generateLink({ type: 'invite', email: body.email });
    if (alreadyRegistered(result.error)) {
      result = await supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email: body.email });
    }
    if (result.error || !result.data.user || !result.data.properties) {
      return NextResponse.json(
        { error: `Could not create the invitation: ${result.error?.message ?? 'no link returned'}` },
        { status: 502 },
      );
    }

    const { user, properties } = result.data;
    const link =
      `${env.APP_URL}/auth/confirm` +
      `?token_hash=${encodeURIComponent(properties.hashed_token)}` +
      `&type=${encodeURIComponent(properties.verification_type)}`;

    const row = await upsertInvitedUser({
      id: user.id,
      email: body.email,
      fullName: body.full_name,
      isSales: body.is_sales,
      isApprover: body.is_approver,
      isAdmin: body.is_admin,
      invitedBy: admin.email,
    });
    if (!row) {
      // Became active between the check above and this write.
      return NextResponse.json({ error: `${body.email} already has access.` }, { status: 409 });
    }

    const outcome = await sendInvite({
      toEmail: body.email,
      fullName: body.full_name,
      invitedBy: admin.full_name || admin.email,
      link,
    });

    // The link is deliberately absent from this row. It signs a person in,
    // and the events table is append-only — a credential written here could
    // never be removed again.
    await logEvent({
      proposalId: null,
      actor: admin.email,
      step: existing ? 'admin:reinvite' : 'admin:invite',
      ok: outcome.sent || ('skipped' in outcome && outcome.skipped),
      detail: {
        target_email: body.email,
        full_name: body.full_name,
        is_sales: body.is_sales,
        is_approver: body.is_approver,
        is_admin: body.is_admin,
        email: outcome.sent
          ? { sent: true, provider_id: outcome.providerId }
          : { sent: false, reason: outcome.reason },
      },
    });

    return NextResponse.json({
      ok: true,
      user: row,
      resent: Boolean(existing),
      email: outcome,
      // Returned ONLY when the email did not go out, so the admin still has
      // a way to get the person in — sent privately, by hand. When the email
      // did send, the link stays in the recipient's inbox and nowhere else.
      link: outcome.sent ? undefined : link,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
