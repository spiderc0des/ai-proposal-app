export const runtime = 'nodejs'; // @react-pdf/renderer needs Node APIs — not optional, not the Edge runtime

import { NextResponse } from 'next/server';
import { getProposalByShareToken, getSections } from '@/lib/queries';
import { renderProposalPdf } from '@/lib/pdf';

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const proposal = await getProposalByShareToken(token);
  if (!proposal) return NextResponse.json({ error: 'Not found or link expired.' }, { status: 404 });

  const sections = await getSections(proposal.id);
  const buffer = await renderProposalPdf(
    {
      client_name: proposal.client_name,
      company_name: proposal.company_name,
      salesperson_name: proposal.salesperson_name,
      date_of_call: proposal.date_of_call?.toISOString().slice(0, 10),
    },
    sections,
  );

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="proposal-${proposal.company_name.replace(/\W+/g, '-')}.pdf"`,
    },
  });
}
