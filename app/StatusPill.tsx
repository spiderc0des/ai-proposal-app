const STYLES: Record<string, { bg: string; fg: string }> = {
  draft: { bg: 'var(--surface-2)', fg: 'var(--ink-soft)' },
  blocked: { bg: 'var(--red-bg)', fg: 'var(--red)' },
  generating: { bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  in_review: { bg: 'var(--amber-bg)', fg: 'var(--amber)' },
  pending_approval: { bg: 'var(--amber-bg)', fg: 'var(--amber)' },
  approved: { bg: 'var(--green-bg)', fg: 'var(--green)' },
  rejected: { bg: 'var(--red-bg)', fg: 'var(--red)' },
  sent: { bg: 'var(--green-bg)', fg: 'var(--green)' },
  send_failed: { bg: 'var(--red-bg)', fg: 'var(--red)' },
  // The client's own answer — 'rejected' above is the internal approver's.
  accepted: { bg: 'var(--green-bg)', fg: 'var(--green)' },
  declined: { bg: 'var(--red-bg)', fg: 'var(--red)' },
};

/** Shared between the proposal detail page and the proposals list. */
export default function StatusPill({ status }: { status: string }) {
  const s = STYLES[status] ?? { bg: 'var(--surface-2)', fg: 'var(--ink-soft)' };
  return (
    <span className="badge" style={{ background: s.bg, color: s.fg }}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
