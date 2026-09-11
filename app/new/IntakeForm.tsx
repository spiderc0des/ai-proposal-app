'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const CONTACT_FIELDS: { key: string; label: string; type?: string; required?: boolean }[] = [
  { key: 'client_name', label: 'Client name', required: true },
  { key: 'client_email', label: 'Client email', type: 'email', required: true },
  { key: 'company_name', label: 'Company name', required: true },
  { key: 'date_of_call', label: 'Date of call', type: 'date' },
  { key: 'salesperson_name', label: 'Salesperson name', required: true },
];

const PROJECT_FIELDS: { key: string; label: string; hint?: string; long?: boolean }[] = [
  { key: 'client_needs_summary', label: "Summary of client's needs", hint: 'The problem the client wants to solve.', long: true },
  { key: 'project_scope', label: 'Project scope', hint: 'What the client wants built or delivered.', long: true },
  { key: 'goals_and_objectives', label: 'Goals and objectives', long: true },
  { key: 'recommended_services', label: 'Recommended services or deliverables', long: true },
  { key: 'proposed_timeline', label: 'Proposed timeline' },
  { key: 'estimated_pricing', label: 'Estimated pricing' },
];

/** Fields the form shows but the server decides. Rendered disabled. */
const LOCKED = new Set(['salesperson_name']);

export default function IntakeForm({ salespersonName }: { salespersonName: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({ salesperson_name: salespersonName });
  const hasName = salespersonName.trim().length > 0;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [audit, setAudit] = useState<{
    id: string;
    readiness: string;
    blocking_reason: string | null;
    clarifying_questions: string[];
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setAudit(null);
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong.');
        return;
      }
      if (data.readiness === 'blocked') {
        setAudit(data);
        return;
      }
      router.push(`/p/${data.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  function field(key: string) {
    return values[key] ?? '';
  }
  function setField(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">New proposal</h1>
      <p className="text-sm text-[var(--ink-soft)] mb-6 max-w-prose">
        These fields match the intake form the sales team already uses. Leave anything
        blank you don&apos;t have yet — the next step tells you what&apos;s missing rather
        than guessing.
      </p>

      {audit && (
        <div className="panel panel-danger mb-6">
          <p className="font-medium mb-2">Not enough to write from: {audit.blocking_reason}</p>
          <p className="mb-1">Answer these before trying again:</p>
          <ul className="list-disc pl-5">
            {audit.clarifying_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="card">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)] mb-4">
            Contact
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            {CONTACT_FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1.5">
                <span className="label">
                  {f.label} {f.required && <span className="text-[var(--red)]">*</span>}
                </span>
                <input
                  type={f.type ?? 'text'}
                  required={f.required && !LOCKED.has(f.key)}
                  value={field(f.key)}
                  onChange={(e) => setField(f.key, e.target.value)}
                  disabled={LOCKED.has(f.key)}
                  title={LOCKED.has(f.key) ? 'Set from your profile — this is the name clients see' : undefined}
                  className="field disabled:opacity-70 disabled:cursor-not-allowed"
                />
                {LOCKED.has(f.key) && (
                  <span className="label-hint">
                    {hasName ? (
                      <>From your <Link href="/profile" className="underline">profile</Link>.</>
                    ) : (
                      <span style={{ color: 'var(--amber)' }}>
                        No name set — <Link href="/profile" className="underline">add yours</Link> first.
                      </span>
                    )}
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)] mb-4">
            Project details
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            {PROJECT_FIELDS.map((f) => (
              <label key={f.key} className={`flex flex-col gap-1.5 ${f.long ? 'sm:col-span-2' : ''}`}>
                <span className="label">{f.label}</span>
                {f.hint && <span className="label-hint">{f.hint}</span>}
                {f.long ? (
                  <textarea
                    rows={3}
                    value={field(f.key)}
                    onChange={(e) => setField(f.key, e.target.value)}
                    className="field resize-y"
                  />
                ) : (
                  <input
                    type="text"
                    value={field(f.key)}
                    onChange={(e) => setField(f.key, e.target.value)}
                    className="field"
                  />
                )}
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-[var(--red)]">{error}</p>}

        {!hasName && (
          <div className="panel panel-warning text-sm">
            Add your name on your <Link href="/profile" className="underline font-medium">profile</Link>{' '}
            before creating a proposal — it&apos;s what the client sees as &ldquo;Prepared by&rdquo;, and
            without it every proposal would be signed with your email address.
          </div>
        )}

        <button type="submit" disabled={submitting || !hasName} className="btn btn-primary self-start">
          {submitting ? 'Checking…' : 'Check readiness'}
        </button>
      </form>
    </div>
  );
}
