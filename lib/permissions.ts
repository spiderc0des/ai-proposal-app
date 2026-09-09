/**
 * Pure permission logic — no database, no Supabase, no 'server-only'.
 * Split out from lib/auth.ts specifically so it can be unit tested without
 * pulling in the whole env/db chain, since this is exactly the logic this
 * project has revised more than once already and is worth pinning down
 * with tests rather than re-reasoning about by eye.
 */
import type { AppUserRow } from './db-schemas';

/** "admin" / "sales + approver" / "sales" / "approver" / "no capabilities" — display only. */
export function capabilityLabel(user: Pick<AppUserRow, 'is_sales' | 'is_approver' | 'is_admin'>): string {
  const parts = [
    user.is_admin && 'admin',
    user.is_sales && 'sales',
    user.is_approver && 'approver',
  ].filter(Boolean);
  return parts.length ? parts.join(' + ') : 'no capabilities';
}

/**
 * "Only the author should be able to see the proposal they create" — with
 * two exceptions: an approver needs to open a proposal to review it before
 * approving (the queue links straight to /p/:id), and an admin sees
 * everything. A plain sales user who is neither the author nor an admin
 * gets turned away.
 */
export function canViewProposal(
  user: Pick<AppUserRow, 'id' | 'is_approver' | 'is_admin'>,
  proposal: { author_id: string },
): boolean {
  return user.id === proposal.author_id || user.is_approver || user.is_admin;
}

/**
 * Narrower than canViewProposal: only the author (or an admin) may change
 * a proposal's content — generate, edit, regenerate, upload material,
 * submit. An approver's job is to review, not to co-author.
 */
export function canEditProposal(
  user: Pick<AppUserRow, 'id' | 'is_admin'>,
  proposal: { author_id: string },
): boolean {
  return user.id === proposal.author_id || user.is_admin;
}

/**
 * Does `user` satisfy the given capability requirement? is_admin always
 * does, regardless of which specific capability was asked for. Used by
 * requireUser() (lib/auth.ts) for route-level gating.
 */
export function hasCapability(
  user: Pick<AppUserRow, 'is_sales' | 'is_approver' | 'is_admin'>,
  capability?: 'sales' | 'approver',
): boolean {
  if (!capability) return true;
  if (user.is_admin) return true;
  return capability === 'sales' ? user.is_sales : user.is_approver;
}

/**
 * A THIRD, independent check alongside canEditProposal — that one asks
 * "is this person allowed to edit *a* proposal's content"; this one asks
 * "is this particular proposal's content editable *at all right now*",
 * regardless of who's asking. Both must pass for an edit or regeneration
 * to go through.
 *
 * A sent proposal is a delivered document — the whole point of the
 * approval gate is that nothing changes unreviewed after that point, so
 * silently rewriting it after the fact would defeat the gate retroactively.
 * `draft` / `blocked` / `generating` have no content yet to edit.
 *
 * `approved`, `pending_approval`, and `send_failed` ARE included, on
 * purpose: editing during any of those is exactly what triggers
 * sql/02-triggers.sql's revoke_approval_on_edit(), which bounces the
 * proposal back to `in_review` and clears the approval — the mechanism
 * that makes "an edit after approval requires a fresh approval" true.
 * Blocking edits during those states here would silently prevent that
 * mechanism from ever running, not strengthen it.
 *
 * `rejected` is included too, but for a DIFFERENT reason than the three
 * above: a rejected proposal isn't a dead end, so editing a section (to
 * address the rejection) has to be allowed at all — but unlike
 * approved/pending_approval/send_failed, the database trigger deliberately
 * does NOT auto-transition it. It stays `rejected` through an edit; the UI
 * shows an explicit "Resubmit for approval" button, enabled only once the
 * content has actually changed since rejection, and clicking it is what
 * calls submitForApproval() (lib/queries.ts — it now accepts `rejected` as
 * a starting status, not only `in_review`).
 */
const EDITABLE_CONTENT_STATUSES = new Set([
  'in_review',
  'pending_approval',
  'approved',
  'send_failed',
  'rejected',
]);

export function canEditSectionContent(proposal: { status: string }): boolean {
  return EDITABLE_CONTENT_STATUSES.has(proposal.status);
}
