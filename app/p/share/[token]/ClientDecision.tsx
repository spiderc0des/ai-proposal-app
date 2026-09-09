'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The client's Accept / Decline control, on the share page.
 *
 * The share page itself is a Server Component, so the interactive part lives
 * here as a child — the same split as IntakeForm under app/new/page.tsx.
 *
 * The name field is a record of who acted, not authentication: anyone
 * holding the link can decide, which is equally true of reading the proposal
 * in the first place. A token link cannot do better than that, and pretending
 * otherwise with a name box would be worse than being clear about it.
 */
export default function ClientDecision({
  token,
  status,
  decisionAt,
  decisionBy,
  declineReason,
}: {
  token: string;
  status: string;
  decisionAt: string | null;
  decisionBy: string | null;
  declineReason: string | null;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<'accept' | 'decline' | null>(null);
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(decision: 'accept' | 'decline') {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/share/${token}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          decision === 'accept'
            ? { decision, name: name.trim() }
            : { decision, name: name.trim(), reason: reason.trim() },
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Something went wrong (${res.status})`);
      // Re-render the server page so it comes back in its decided state.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const decidedOn = decisionAt ? new Date(decisionAt).toLocaleDateString() : null;

  if (status === 'accepted') {
    return (
      <div className="panel panel-success mt-8">
        <p className="font-semibold mb-1">Accepted{decidedOn ? ` on ${decidedOn}` : ''}.</p>
        <p>
          Thank you{decisionBy ? `, ${decisionBy}` : ''} — we&apos;ll be in touch shortly with next
          steps.
        </p>
      </div>
    );
  }

  if (status === 'declined') {
    return (
      <div className="panel panel-warning mt-8">
        <p className="font-semibold mb-1">Declined{decidedOn ? ` on ${decidedOn}` : ''}.</p>
        {declineReason && <p className="mb-1">You told us: &ldquo;{declineReason}&rdquo;</p>}
        <p>Thank you for letting us know{decisionBy ? `, ${decisionBy}` : ''}.</p>
      </div>
    );
  }

  // Anything other than a proposal actually awaiting a decision shows no
  // controls at all — the page is still readable, there's just nothing to do.
  if (status !== 'sent') return null;

  return (
    <div className="mt-8 pt-6 divider">
      <p className="font-semibold mb-1">Ready to go ahead?</p>
      <p className="text-sm text-[var(--ink-faint)] mb-4">
        Let us know either way — if this isn&apos;t right, telling us why helps us put it right.
      </p>

      {error && <div className="panel panel-danger mb-4">{error}</div>}

      {choice === null && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setChoice('accept')} className="btn btn-success">
            Accept proposal
          </button>
          <button onClick={() => setChoice('decline')} className="btn btn-ghost">
            Decline
          </button>
        </div>
      )}

      {choice !== null && (
        <div className="flex flex-col gap-3 max-w-md">
          <label className="flex flex-col gap-1.5">
            <span className="label">Your name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Who's confirming this?"
              disabled={busy}
              className="field"
              autoFocus
            />
          </label>

          {choice === 'decline' && (
            <label className="flex flex-col gap-1.5">
              <span className="label">What&apos;s not right?</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Pricing, timeline, scope — whatever it is, it helps to know."
                disabled={busy}
                className="field resize-y"
              />
            </label>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => submit(choice)}
              disabled={busy || !name.trim() || (choice === 'decline' && !reason.trim())}
              className={choice === 'accept' ? 'btn btn-success' : 'btn btn-danger'}
            >
              {busy
                ? 'Sending…'
                : choice === 'accept'
                  ? 'Confirm acceptance'
                  : 'Confirm decline'}
            </button>
            <button
              onClick={() => {
                setChoice(null);
                setError('');
              }}
              disabled={busy}
              className="btn btn-ghost"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
