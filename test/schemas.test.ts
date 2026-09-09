import { describe, it, expect } from 'vitest';
import { proposalToIntake } from '../lib/schemas';
import type { ProposalRow } from '../lib/db-schemas';

/**
 * Regression test for a real bug: IntakeSchema.parse(proposal) was called
 * directly on a ProposalRow in three routes (generate, regenerate,
 * materials). ProposalRow.date_of_call is `Date | null`
 * (z.coerce.date().nullable()); IntakeSchema expects a plain
 * 'YYYY-MM-DD' string or undefined. A Date object satisfies neither
 * `.optional()` nor `.or(z.literal(''))`, so every live call with a
 * date_of_call set (or even null) threw a ZodError, surfaced to the UI as
 * a bare "Invalid request." with no indication of which field. None of the
 * existing mock-based tests caught this because they construct an Intake
 * by hand and never round-trip it through a ProposalRow.
 */
function fakeProposalRow(overrides: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: 'p1',
    created_at: new Date('2026-08-20'),
    updated_at: new Date('2026-08-20'),
    status: 'in_review',
    version: 1,
    client_name: 'Priya Nandakumar',
    client_email: 'priya@northbridge-logistics.com',
    company_name: 'Northbridge Logistics',
    date_of_call: new Date('2026-08-20T00:00:00.000Z'),
    salesperson_name: 'Marcus Webb',
    client_needs_summary: 'Needs a dispatch system.',
    project_scope: 'Build a dispatch dashboard.',
    goals_and_objectives: 'Cut dispatch time.',
    recommended_services: 'A dispatch web app.',
    proposed_timeline: '8 weeks.',
    estimated_pricing: '$42,000.',
    intake_hash: 'abc123',
    author_id: 'u1',
    readiness: 'ready',
    audit_json: null,
    approver_id: null,
    approved_at: null,
    approved_content_hash: null,
    rejected_reason: null,
    share_token: null,
    share_expires_at: null,
    share_revoked: false,
    pdf_path: null,
    sent_at: null,
    deleted_at: null,
    client_decision_at: null,
    client_decision_by: null,
    client_decline_reason: null,
    nudge_paused: false,
    ...overrides,
  };
}

describe('proposalToIntake', () => {
  it('does not throw on a proposal with a real date_of_call — the exact bug this regresses', () => {
    expect(() => proposalToIntake(fakeProposalRow())).not.toThrow();
  });

  it('converts the Date object to the YYYY-MM-DD string IntakeSchema expects', () => {
    const intake = proposalToIntake(fakeProposalRow({ date_of_call: new Date('2026-08-20T00:00:00.000Z') }));
    expect(intake.date_of_call).toBe('2026-08-20');
  });

  it('converts a null date_of_call to an empty string, not null', () => {
    const intake = proposalToIntake(fakeProposalRow({ date_of_call: null }));
    expect(intake.date_of_call).toBe('');
  });

  it('passes every other field through unchanged', () => {
    const intake = proposalToIntake(fakeProposalRow());
    expect(intake.client_name).toBe('Priya Nandakumar');
    expect(intake.estimated_pricing).toBe('$42,000.');
  });
});
