'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const CAPS = [
  { key: 'is_sales', label: 'Sales' },
  { key: 'is_approver', label: 'Approver' },
  { key: 'is_admin', label: 'Admin' },
] as const;

type Result =
  | { kind: 'sent'; email: string; resent: boolean }
  | { kind: 'manual'; email: string; link: string; reason: string };

/**
 * Invite someone by email. Capabilities are chosen now and stored on the
 * pending account, so activating them later is one tick rather than a second
 * round of decisions.
 */
export default function InviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [caps, setCaps] = useState({ is_sales: true, is_approver: false, is_admin: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  const noCapability = !caps.is_sales && !caps.is_approver && !caps.is_admin;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    setCopied(false);
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, full_name: fullName, ...caps }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);

      setResult(
        data.email?.sent
          ? { kind: 'sent', email, resent: Boolean(data.resent) }
          : { kind: 'manual', email, link: data.link, reason: data.email?.reason ?? 'The email was not sent.' },
      );
      setEmail('');
      setFullName('');
      setCaps({ is_sales: true, is_approver: false, is_admin: false });
      router.refresh(); // the new pending row appears in the list below
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="card mb-6">
      <h2 className="text-sm font-semibold mb-1">Invite someone</h2>
      <p className="text-xs text-[var(--ink-faint)] mb-4">
        They get an email with a sign-in link. Their account stays pending until you activate it
        below — the invite lets them in the door, not into the app.
      </p>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="label">Full name <span className="text-[var(--red)]">*</span></span>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="field"
              disabled={busy}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Email <span className="text-[var(--red)]">*</span></span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
              disabled={busy}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <span className="label">Capabilities</span>
          {CAPS.map((c) => (
            <label key={c.key} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={caps[c.key]}
                onChange={(e) => setCaps((prev) => ({ ...prev, [c.key]: e.target.checked }))}
                disabled={busy}
              />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
        <p className="label-hint">
          Their name is what clients see as &ldquo;Prepared by&rdquo; on every proposal they write.
        </p>
        {noCapability && (
          <p className="label-hint" style={{ color: 'var(--amber)' }}>
            Choose at least one — an account with none can sign in and reach nothing.
          </p>
        )}

        <div>
          <button type="submit" disabled={busy || noCapability} className="btn btn-primary text-sm">
            {busy ? 'Sending invite…' : 'Send invite'}
          </button>
        </div>
      </form>

      {error && <p className="mt-3 text-sm" style={{ color: 'var(--red)' }}>{error}</p>}

      {result?.kind === 'sent' && (
        <div className="panel panel-success mt-4 text-sm">
          {result.resent ? 'Invite re-sent to ' : 'Invite sent to '}
          <b>{result.email}</b>. They appear below as invited; activate them once they have accepted.
        </div>
      )}

      {result?.kind === 'manual' && (
        <div className="panel panel-warning mt-4 text-sm">
          <p className="mb-2">
            The account for <b>{result.email}</b> was created, but the email did not go out:{' '}
            {result.reason}
          </p>
          <p className="mb-2">
            Send them this link yourself, privately — <b>it signs them in</b>, so treat it like a
            password. It expires soon.
          </p>
          <div className="flex gap-2 items-start">
            <code className="text-xs break-all flex-1 p-2 rounded" style={{ background: 'var(--surface)' }}>
              {result.link}
            </code>
            <button type="button" onClick={() => copy(result.link)} className="btn btn-ghost text-xs shrink-0">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
