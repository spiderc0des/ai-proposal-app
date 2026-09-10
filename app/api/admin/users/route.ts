import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { setUserAccess, logEvent } from '@/lib/queries';
import { errorResponse } from '@/lib/api-helpers';

/**
 * PATCH /api/admin/users — set one person's capabilities and active flag.
 *
 * The app's only admin-gated route. `requireUser` takes 'sales' | 'approver'
 * and has no 'admin' arm, deliberately: is_admin is not a capability in the
 * same sense — it bypasses per-proposal ownership everywhere it appears —
 * so it is checked here explicitly rather than folded into that signature.
 *
 * Every field is sent on every request, not a partial patch. Capabilities
 * are three independent booleans and `active` interacts with all three
 * (an active person must hold at least one), so a partial update would
 * make validity depend on a server-side merge the caller cannot see. The
 * client sends the whole intended state; the database judges it.
 */
const Body = z.object({
  user_id: z.string().uuid(),
  is_sales: z.boolean(),
  is_approver: z.boolean(),
  is_admin: z.boolean(),
  active: z.boolean(),
});

export async function PATCH(request: NextRequest) {
  try {
    const actor = await requireUser();
    if (!actor.is_admin) {
      return NextResponse.json(
        { error: 'Only an admin can change who has access.' },
        { status: 403 },
      );
    }

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request.', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const result = await setUserAccess({
      userId: body.user_id,
      isSales: body.is_sales,
      isApprover: body.is_approver,
      isAdmin: body.is_admin,
      active: body.active,
    });
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });

    // Logged with proposalId: null — an events row that belongs to no
    // proposal, which the table has always allowed and nothing used until
    // the cron job. Granting someone approver rights decides who can send
    // client-facing documents, so it belongs in the same append-only trail
    // as the sends themselves.
    await logEvent({
      proposalId: null,
      actor: actor.email,
      step: 'admin:access',
      ok: true,
      detail: {
        target_email: result.user.email,
        active: result.user.active,
        is_sales: result.user.is_sales,
        is_approver: result.user.is_approver,
        is_admin: result.user.is_admin,
        self: result.user.id === actor.id,
      },
    });

    return NextResponse.json({ ok: true, user: result.user });
  } catch (err) {
    return errorResponse(err);
  }
}
