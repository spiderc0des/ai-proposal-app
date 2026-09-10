'use client';
import { useState } from 'react';

type Row = {
  id: string;
  email: string;
  full_name: string;
  is_sales: boolean;
  is_approver: boolean;
  is_admin: boolean;
  active: boolean;
};

const CAPS = [
  { key: 'is_sales', label: 'Sales' },
  { key: 'is_approver', label: 'Approver' },
  { key: 'is_admin', label: 'Admin' },
] as const;

/**
 * Edits are staged, not live.
 *
 * Toggling a checkbox changes local state only; nothing is written until
 * Save on that row. Three reasons this is not fussiness:
 *
 *   • An active person must hold at least one capability. Clearing the last
 *     one to swap it for a different one would, with live writes, be
 *     rejected halfway through a legitimate change.
 *   • Removing your own admin is a real decision. Staging gives it a
 *     confirm step instead of making it a single stray click.
 *   • A row that failed to save keeps what you typed, so you can fix the
 *     one thing that was wrong rather than re-entering all four.
 */
export default function UserAccessTable({
  users,
  currentUserId,
}: {
  users: Row[];
  currentUserId: string;
}) {
  const [rows, setRows] = useState(users);
  const [draft, setDraft] = useState<Record<string, Partial<Row>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  /** The row as it would be saved: stored values with any staged edits over them. */
  function pending(row: Row): Row {
    return { ...row, ...draft[row.id] };
  }
  function isDirty(row: Row): boolean {
    const d = pending(row);
    return (
      d.is_sales !== row.is_sales ||
      d.is_approver !== row.is_approver ||
      d.is_admin !== row.is_admin ||
      d.active !== row.active
    );
  }
  function stage(id: string, patch: Partial<Row>) {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    setErrors((prev) => ({ ...prev, [id]: '' }));
    setSaved(null);
  }

  async function save(row: Row) {
    const next = pending(row);

    // Dropping your own admin is the one change that can take away your
    // access to this page. Confirmed rather than blocked: with another
    // active admin it is a legitimate thing to do, and the database refuses
    // it outright when you are the last one.
    if (row.id === currentUserId && row.is_admin && !next.is_admin && confirming !== row.id) {
      setConfirming(row.id);
      return;
    }
    setConfirming(null);
    setBusy(row.id);
    setErrors((prev) => ({ ...prev, [row.id]: '' }));
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: row.id,
          is_sales: next.is_sales,
          is_approver: next.is_approver,
          is_admin: next.is_admin,
          active: next.active,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);

      // Take the saved row back from the server rather than assuming the
      // draft landed as sent.
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...data.user } : r)));
      setDraft((prev) => {
        const { [row.id]: _dropped, ...rest } = prev;
        return rest;
      });
      setSaved(row.id);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [row.id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setBusy(null);
    }
  }

  function reset(id: string) {
    setDraft((prev) => {
      const { [id]: _dropped, ...rest } = prev;
      return rest;
    });
    setErrors((prev) => ({ ...prev, [id]: '' }));
    setConfirming(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const next = pending(row);
        const dirty = isDirty(row);
        const noCapability = next.active && !next.is_sales && !next.is_approver && !next.is_admin;

        return (
          <div key={row.id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">
                  {row.full_name || row.email}
                  {row.id === currentUserId && (
                    <span className="ml-2 chip">you</span>
                  )}
                </p>
                {row.full_name && (
                  <p className="text-xs text-[var(--ink-faint)] truncate">{row.email}</p>
                )}
              </div>
              {row.active ? (
                <span className="chip" style={{ color: 'var(--green)', background: 'var(--green-bg)' }}>
                  Active
                </span>
              ) : (
                <span className="chip" style={{ color: 'var(--amber)', background: 'var(--amber-bg)' }}>
                  Pending — no access
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={next.active}
                  onChange={(e) => stage(row.id, { active: e.target.checked })}
                  disabled={busy !== null}
                />
                <span className="font-medium">Active</span>
              </label>
              <span className="text-[var(--rule)]">|</span>
              {CAPS.map((cap) => (
                <label key={cap.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={next[cap.key]}
                    onChange={(e) => stage(row.id, { [cap.key]: e.target.checked })}
                    disabled={busy !== null}
                  />
                  <span>{cap.label}</span>
                </label>
              ))}
            </div>

            {noCapability && (
              <p className="label-hint mt-2" style={{ color: 'var(--amber)' }}>
                An active person needs at least one capability — otherwise they can sign
                in and reach nothing.
              </p>
            )}

            {confirming === row.id && (
              <div className="panel panel-warning mt-3 text-sm">
                <p className="mb-2">
                  This removes <b>your own</b> admin access. You will lose this page
                  immediately, and only another admin can give it back.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => save(row)} className="btn btn-danger text-xs" disabled={busy !== null}>
                    Yes, remove my admin
                  </button>
                  <button onClick={() => reset(row.id)} className="btn btn-ghost text-xs">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {errors[row.id] && (
              <p className="mt-2 text-sm" style={{ color: 'var(--red)' }}>
                {errors[row.id]}
              </p>
            )}

            {dirty && confirming !== row.id && (
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => save(row)}
                  disabled={busy !== null || noCapability}
                  className="btn btn-primary text-xs"
                >
                  {busy === row.id ? 'Saving…' : 'Save changes'}
                </button>
                <button onClick={() => reset(row.id)} disabled={busy !== null} className="btn btn-ghost text-xs">
                  Discard
                </button>
              </div>
            )}

            {saved === row.id && !dirty && (
              <p className="label-hint mt-2" style={{ color: 'var(--green)' }}>
                Saved.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
