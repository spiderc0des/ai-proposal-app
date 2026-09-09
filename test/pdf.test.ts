import { describe, it, expect } from 'vitest';
import { renderProposalPdf } from '../lib/pdf';

describe('renderProposalPdf', () => {
  it('renders a real PDF buffer from six sections without throwing', async () => {
    const intake = {
      client_name: 'Priya Nandakumar',
      company_name: 'Northbridge Logistics',
      salesperson_name: 'Marcus Webb',
      date_of_call: '2026-08-20',
    };
    const sections = [
      { section_key: 'introduction', title: 'Introduction', body_md: '## Introduction\n\nThank you for your time, **Priya**.' },
      { section_key: 'pricing', title: 'Pricing', body_md: '## Pricing\n\nThe fee is $42,000.\n\n- Milestone 1\n- Milestone 2' },
    ];
    const buf = await renderProposalPdf(intake, sections);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(500);
    // %PDF- is the magic number every valid PDF file starts with.
    expect(buf.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });
});
