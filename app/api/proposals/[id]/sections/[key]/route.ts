import { NextRequest, NextResponse } from 'next/server';
import { requireUser, canEditProposal, canEditSectionContent } from '@/lib/auth';
import { EditSectionSchema } from '@/lib/schemas';
import { editSection, getProposal, getSections } from '@/lib/queries';
import { errorResponse, withEventLog } from '@/lib/api-helpers';

/**
 * PATCH /api/proposals/:id/sections/:key — a manual edit in the review UI.
 * Version-guarded like regeneration — the "without losing the rest"
 * guarantee applies to hand edits too, not only model output.
 *
 * Blocked once the proposal is `sent` — a delivered document must not be
 * silently rewritten after the fact. Still allowed on `approved` /
 * `pending_approval` / `send_failed`: editing there is exactly what the
 * database trigger (sql/02-triggers.sql revoke_approval_on_edit) uses to
 * bounce the proposal back to `in_review` and require a fresh approval —
 * blocking it here would prevent that mechanism from ever running. Also
 * allowed on `rejected`, though that one stays `rejected` through the edit
 * (see lib/permissions.ts canEditSectionContent) — resubmitting is an
 * explicit action, not automatic.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; key: string }> },
) {
  const { id, key } = await params;
  try {
    const user = await requireUser('sales');
    const proposal = await getProposal(id);
    if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canEditProposal(user, proposal)) {
      return NextResponse.json({ error: 'Only the author (or an admin) can edit this proposal.' }, { status: 403 });
    }
    if (!canEditSectionContent(proposal)) {
      return NextResponse.json(
        { error: `This proposal is '${proposal.status}' — content can no longer be edited.` },
        { status: 409 },
      );
    }
    const body = EditSectionSchema.parse(await request.json());

    const before = (await getSections(id)).find((s) => s.section_key === key);

    // One row for this action: the ok/fail status AND the diff live in the
    // same `edit:<key>` event, via withEventLog's successDetail callback —
    // not a second `diff:<key>` row alongside it.
    await withEventLog(
      id,
      user.email,
      `edit:${key}`,
      async () =>
        editSection({
          proposalId: id,
          sectionKey: key,
          body_md: body.body_md,
          editedBy: user.id,
          expectedVersion: body.version,
        }),
      () => (before ? { section_key: key, before: before.body_md, after: body.body_md } : {}),
    );

    // The revoke_approval_on_edit trigger (sql/02-triggers.sql) may have
    // just bounced this proposal's status to in_review — e.g. editing an
    // approved or rejected proposal. Returning the current status lets the
    // UI reflect that immediately, instead of only after a page reload.
    const updated = await getProposal(id);
    return NextResponse.json({ ok: true, status: updated?.status });
  } catch (err) {
    return errorResponse(err);
  }
}
