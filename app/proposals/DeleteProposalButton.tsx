'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Inline delete with a reveal-on-click confirmation — no native
 * `window.confirm()`, matching the rest of the app (see ProposalEditor's
 * reject flow). Only rendered by the caller for a status other than
 * `sent`; the DELETE route re-checks that itself regardless.
 */
export default function DeleteProposalButton({ id, companyName }: { id: string; companyName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleDelete() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/proposals/${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.preventDefault()}>
        <span className="text-xs text-[var(--ink-faint)]">Delete {companyName}?</span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          className="btn btn-danger text-xs px-2 py-1"
        >
          {busy ? 'Deleting…' : 'Confirm'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="btn btn-ghost text-xs px-2 py-1"
        >
          Cancel
        </button>
        {error && <span className="text-xs text-[var(--red)]">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        setConfirming(true);
      }}
      className="btn-link text-xs shrink-0"
      style={{ color: 'var(--red)' }}
    >
      Delete
    </button>
  );
}
