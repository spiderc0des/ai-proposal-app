import { describe, it, expect } from 'vitest';
import { canEditProposal, canEditSectionContent, canViewProposal, capabilityLabel, hasCapability } from '../lib/permissions';

const salesOnly = { id: 'u-sales', is_sales: true, is_approver: false, is_admin: false };
const approverOnly = { id: 'u-approver', is_sales: false, is_approver: true, is_admin: false };
const both = { id: 'u-both', is_sales: true, is_approver: true, is_admin: false };
const admin = { id: 'u-admin', is_sales: false, is_approver: false, is_admin: true };
const nobody = { id: 'u-none', is_sales: false, is_approver: false, is_admin: false };

const ownProposal = { author_id: 'u-sales' };
const othersProposal = { author_id: 'someone-else' };

describe('capabilityLabel', () => {
  it('names every combination', () => {
    expect(capabilityLabel(salesOnly)).toBe('sales');
    expect(capabilityLabel(approverOnly)).toBe('approver');
    expect(capabilityLabel(both)).toBe('sales + approver');
    expect(capabilityLabel(admin)).toBe('admin');
    expect(capabilityLabel(nobody)).toBe('no capabilities');
  });

  it('puts admin first when combined with other capabilities', () => {
    expect(capabilityLabel({ is_sales: true, is_approver: true, is_admin: true })).toBe(
      'admin + sales + approver',
    );
  });
});

describe('hasCapability — requireUser()\'s gate', () => {
  it('sales-only passes the sales check, fails the approver check', () => {
    expect(hasCapability(salesOnly, 'sales')).toBe(true);
    expect(hasCapability(salesOnly, 'approver')).toBe(false);
  });

  it('approver-only passes the approver check, fails the sales check', () => {
    expect(hasCapability(approverOnly, 'approver')).toBe(true);
    expect(hasCapability(approverOnly, 'sales')).toBe(false);
  });

  it('holding both passes both checks', () => {
    expect(hasCapability(both, 'sales')).toBe(true);
    expect(hasCapability(both, 'approver')).toBe(true);
  });

  it('admin passes every capability check without holding it directly', () => {
    expect(hasCapability(admin, 'sales')).toBe(true);
    expect(hasCapability(admin, 'approver')).toBe(true);
  });

  it('no capability requested always passes (session-only check)', () => {
    expect(hasCapability(nobody, undefined)).toBe(true);
  });

  it('nobody with no capabilities fails both specific checks', () => {
    expect(hasCapability(nobody, 'sales')).toBe(false);
    expect(hasCapability(nobody, 'approver')).toBe(false);
  });
});

describe('canViewProposal — "only the author sees their own"', () => {
  it('the author can always view their own proposal', () => {
    expect(canViewProposal(salesOnly, ownProposal)).toBe(true);
  });

  it('a plain sales user cannot view someone else\'s proposal', () => {
    expect(canViewProposal(salesOnly, othersProposal)).toBe(false);
  });

  it('an approver CAN view a proposal they did not author — they review it before approving', () => {
    expect(canViewProposal(approverOnly, othersProposal)).toBe(true);
  });

  it('an admin can view any proposal', () => {
    expect(canViewProposal(admin, othersProposal)).toBe(true);
  });

  it('someone with no capabilities and not the author cannot view it', () => {
    expect(canViewProposal(nobody, othersProposal)).toBe(false);
  });
});

describe('canEditProposal — narrower than canViewProposal', () => {
  it('the author can edit their own proposal', () => {
    expect(canEditProposal(salesOnly, ownProposal)).toBe(true);
  });

  it('an approver who did NOT author it cannot edit it — reviewing is not co-authoring', () => {
    expect(canEditProposal(approverOnly, othersProposal)).toBe(false);
  });

  it('an admin can edit any proposal', () => {
    expect(canEditProposal(admin, othersProposal)).toBe(true);
  });

  it('a plain sales user cannot edit a proposal they did not author', () => {
    expect(canEditProposal(salesOnly, othersProposal)).toBe(false);
  });
});

describe('self-approval is a capability question now, not an identity question', () => {
  // The thing this whole file exists to pin down: the brief asks for A
  // human to verify Claude's output before delivery, not specifically a
  // DIFFERENT human than the author. So whether someone may approve is
  // entirely about hasCapability('approver') — canEditProposal/
  // canViewProposal never even enter into the approve route, and nothing
  // here compares author_id to the approver's id.
  it('a person with is_sales + is_approver passes the approver capability check for ANY proposal, including their own', () => {
    expect(hasCapability(both, 'approver')).toBe(true);
    // and there is no ownership check for approval at all — decideApproval()
    // (lib/queries.ts) no longer compares author_id to approver_id.
  });
});

describe('canEditSectionContent — a delivered document must not be silently rewritten', () => {
  it('blocks the one state that matters: sent', () => {
    expect(canEditSectionContent({ status: 'sent' })).toBe(false);
  });

  it('blocks pre-content states — nothing to edit yet', () => {
    expect(canEditSectionContent({ status: 'draft' })).toBe(false);
    expect(canEditSectionContent({ status: 'blocked' })).toBe(false);
    expect(canEditSectionContent({ status: 'generating' })).toBe(false);
  });

  it('allows in_review — the ordinary editing window', () => {
    expect(canEditSectionContent({ status: 'in_review' })).toBe(true);
  });

  // The four statuses below are deliberately editable — see the long
  // comment on canEditSectionContent. Editing here is exactly what makes
  // "an edit after approval invalidates it" true: the database trigger
  // (sql/02-triggers.sql revoke_approval_on_edit) only has a body_md
  // change to react to if the write is allowed to happen at all.
  it('allows approved — so the revoke-on-edit trigger can fire', () => {
    expect(canEditSectionContent({ status: 'approved' })).toBe(true);
  });

  it('allows pending_approval — the same trigger covers this status too', () => {
    expect(canEditSectionContent({ status: 'pending_approval' })).toBe(true);
  });

  it('allows send_failed — approval succeeded, only delivery failed', () => {
    expect(canEditSectionContent({ status: 'send_failed' })).toBe(true);
  });

  it('allows rejected — editing a section is how a rejection gets addressed, and resubmitted', () => {
    expect(canEditSectionContent({ status: 'rejected' })).toBe(true);
  });
});
