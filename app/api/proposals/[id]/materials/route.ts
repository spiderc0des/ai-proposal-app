import { NextRequest, NextResponse } from 'next/server';
import { requireUser, canEditProposal } from '@/lib/auth';
import { getProposal, insertMaterial, saveDigest, markMaterialFailed } from '@/lib/queries';
import { uploadMaterial, digestMaterial } from '@/lib/claude';
import { proposalToIntake } from '@/lib/schemas';
import { errorResponse, withEventLog } from '@/lib/api-helpers';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — generous for a proposal brief, small enough not to blow past a route body limit
const ALLOWED_MIME = new Set(['application/pdf', 'text/plain', 'text/markdown']);

/**
 * POST /api/proposals/:id/materials — supporting material upload.
 *
 * Two Claude calls, not one, and in this order:
 *   1. uploadMaterial()  — Files API, one-time upload
 *   2. digestMaterial()  — citations ON, structured output OFF
 *
 * Citations and output_config.format return a 400 if combined in a single
 * call, so the document is read HERE, with citations, and handed to the
 * draft/regenerate calls as plain text — never as the document itself
 * (see lib/claude.ts §5.2).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireUser('sales');
    const proposal = await getProposal(id);
    if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!canEditProposal(user, proposal)) {
      return NextResponse.json({ error: 'Only the author (or an admin) can upload material to this proposal.' }, { status: 403 });
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large (${(file.size / 1e6).toFixed(1)}MB). Limit is ${MAX_BYTES / 1e6}MB.` },
        { status: 400 },
      );
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: `Unsupported file type: ${file.type || 'unknown'}.` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const uploaded = await withEventLog(id, user.email, 'material:upload', async () =>
      uploadMaterial(buffer, file.name, file.type),
    );

    const material = await insertMaterial({
      proposalId: id,
      filename: file.name,
      mime: file.type,
      bytes: file.size,
      anthropicFileId: uploaded.id,
    });

    const intake = proposalToIntake(proposal);
    const intakeContext = `${intake.company_name}: ${intake.client_needs_summary}\n${intake.project_scope}`;

    try {
      const digest = await withEventLog(id, user.email, 'material:digest', async () => {
        const outcome = await digestMaterial(uploaded.id, intakeContext);
        if (!outcome.ok) throw new Error(`Digest failed (${outcome.reason}): ${outcome.message}`);
        return outcome.data;
      });
      await saveDigest(material.id, digest.digest_md, digest.citations);
      return NextResponse.json({ material_id: material.id, digest_md: digest.digest_md, citations: digest.citations });
    } catch (err) {
      await markMaterialFailed(material.id, err instanceof Error ? err.message : String(err));
      throw err;
    }
  } catch (err) {
    return errorResponse(err);
  }
}
