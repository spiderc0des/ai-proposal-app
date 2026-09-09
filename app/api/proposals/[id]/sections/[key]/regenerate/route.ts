import { NextRequest, NextResponse } from 'next/server';
import { requireUser, canEditProposal, canEditSectionContent } from '@/lib/auth';
import { RegenRequestSchema, proposalToIntake } from '@/lib/schemas';
import { getProposal, getSections, getMaterials, regenerateSectionRow, markSectionFailed } from '@/lib/queries';
import { regenerateSection } from '@/lib/claude';
import { errorResponse, withEventLog } from '@/lib/api-helpers';

/**
 * POST /api/proposals/:id/sections/:key/regenerate.
 *
 * The other five sections are read but never written by this route: they
 * go into the prompt as read-only context (lib/claude.ts §5.4) and the
 * database statement this ultimately calls (regenerateSectionRow) touches
 * exactly one row — "without losing the rest" holds by construction, not
 * by a check.
 *
 * Blocked once `sent` — see the identical note on the PATCH edit route
 * (app/api/proposals/:id/sections/:key/route.ts) for why `approved` /
 * `pending_approval` / `send_failed` / `rejected` stay regenerable
 * regardless.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; key: string }> },
) {
  const { id, key } = await params;
  try {
    const user = await requireUser('sales');
    const body = RegenRequestSchema.parse(await request.json());

    const proposal = await getProposal(id);
    if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canEditProposal(user, proposal)) {
      return NextResponse.json({ error: 'Only the author (or an admin) can regenerate this proposal.' }, { status: 403 });
    }
    if (!canEditSectionContent(proposal)) {
      return NextResponse.json(
        { error: `This proposal is '${proposal.status}' — content can no longer be regenerated.` },
        { status: 409 },
      );
    }

    const sections = await getSections(id);
    const current = sections.find((s) => s.section_key === key);
    if (!current) return NextResponse.json({ error: `Unknown section: ${key}` }, { status: 404 });

    const intake = proposalToIntake(proposal);
    const materials = await getMaterials(id);
    const digests = materials.map((m) => m.digest_md).filter((d): d is string => Boolean(d));

    // One row for this action: the Claude call AND the DB write both happen
    // inside withEventLog's callback, so `regen:<key>` only logs ok:true once
    // the section is actually saved — not just once Claude responds — and
    // its successDetail carries the diff on that same row (no separate
    // `diff:<key>` row alongside it).
    const result = await withEventLog(
      id,
      user.email,
      `regen:${key}`,
      async () => {
        const outcome = await regenerateSection({
          intake,
          digests,
          sectionKey: key,
          currentBody: current.body_md,
          siblings: sections
            .filter((s) => s.section_key !== key)
            .map((s) => ({ section_key: s.section_key, title: s.title, body_md: s.body_md })),
          instruction: body.instruction,
        });
        if (!outcome.ok) throw new Error(`Regeneration failed (${outcome.reason}): ${outcome.message}`);

        await regenerateSectionRow({
          proposalId: id,
          sectionKey: key,
          expectedVersion: body.version,
          title: outcome.data.section.title,
          body_md: outcome.data.section.body_md,
          assumptions: outcome.data.section.assumptions,
          gaps: outcome.data.section.gaps,
          model: outcome.model,
          requestId: outcome.requestId,
        });

        return { section: outcome.data.section };
      },
      (result) => ({
        section_key: key,
        before: current.body_md,
        after: result.section.body_md,
        instruction: body.instruction ?? null,
      }),
    );

    // Same reasoning as the PATCH edit route: the revoke_approval_on_edit
    // trigger may have just bounced status to in_review, and the UI needs
    // to see that without a page reload.
    const updated = await getProposal(id);
    return NextResponse.json({ section: result.section, status: updated?.status });
  } catch (err) {
    await markSectionFailed(id, key, err instanceof Error ? err.message : String(err)).catch(() => {});
    return errorResponse(err);
  }
}
