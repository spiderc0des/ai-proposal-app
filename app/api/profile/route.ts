import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { setOwnName, logEvent } from '@/lib/queries';
import { errorResponse } from '@/lib/api-helpers';

/**
 * PATCH /api/profile — set your own display name.
 *
 * The name is what clients read as "Prepared by" on every proposal you write
 * and how every client email signs off, and the intake form now fills the
 * salesperson field from it rather than letting it be typed. So it has to be
 * settable by the person themselves — including the two users who existed
 * before this, neither of whom had one.
 */
const Body = z.object({
  full_name: z.string().trim().min(1, 'Your name cannot be empty.').max(120),
});

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' }, { status: 400 });
    }

    const updated = await setOwnName(user.id, parsed.data.full_name);
    if (!updated) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });

    await logEvent({
      proposalId: null,
      actor: user.email,
      step: 'profile:name',
      ok: true,
      detail: { before: user.full_name, after: updated.full_name },
    });

    return NextResponse.json({ ok: true, full_name: updated.full_name });
  } catch (err) {
    return errorResponse(err);
  }
}
