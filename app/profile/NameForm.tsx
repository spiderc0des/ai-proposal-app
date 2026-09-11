'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** Your display name — what clients see as "Prepared by". */
export default function NameForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const dirty = name.trim() !== initial.trim();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card mb-4">
      <label className="flex flex-col gap-1.5">
        <span className="label">Your name</span>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          className="field"
          disabled={busy}
        />
        <span className="label-hint">
          Clients see this as &ldquo;Prepared by&rdquo; on every proposal you write, and it signs off
          every proposal email. The intake form fills it in for you.
        </span>
      </label>
      {!initial && !saved && (
        <p className="label-hint mt-2" style={{ color: 'var(--amber)' }}>
          You don&apos;t have a name set yet, so you can&apos;t create a proposal until you add one.
        </p>
      )}
      {error && <p className="mt-2 text-sm" style={{ color: 'var(--red)' }}>{error}</p>}
      <div className="flex items-center gap-3 mt-3">
        <button type="submit" disabled={busy || !dirty || !name.trim()} className="btn btn-primary text-sm">
          {busy ? 'Saving…' : 'Save name'}
        </button>
        {saved && <span className="label-hint" style={{ color: 'var(--green)' }}>Saved.</span>}
      </div>
    </form>
  );
}
