import { redirect } from 'next/navigation';
import { requireUser, AuthError, canViewProposal } from '@/lib/auth';
import { getEvents, getProposal } from '@/lib/queries';
import { diffWords } from '@/lib/diff';
import NotAuthorized from '../../../NotAuthorized';

/** A `diff:*` event's detail carries before/after text — everything else doesn't. */
function hasDiff(detail: unknown): detail is { before: string; after: string; instruction?: string | null } {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    typeof (detail as Record<string, unknown>).before === 'string' &&
    typeof (detail as Record<string, unknown>).after === 'string'
  );
}

function EventDiff({ before, after, instruction }: { before: string; after: string; instruction?: string | null }) {
  const parts = diffWords(before, after);
  if (parts.every((p) => p.type === 'equal')) return null;

  return (
    <details className="mt-2">
      <summary className="text-xs font-medium text-[var(--accent)] cursor-pointer select-none">
        View diff
      </summary>
      <div className="mt-2">
        {instruction && (
          <p className="text-xs text-[var(--ink-faint)] mb-2">
            Instruction: <span className="italic">&ldquo;{instruction}&rdquo;</span>
          </p>
        )}
        <div
          className="rounded-md border border-[var(--rule)] p-3 text-xs leading-relaxed whitespace-pre-wrap"
          style={{ background: 'var(--surface)' }}
        >
          {parts.map((p, i) => {
            if (p.type === 'equal') return <span key={i}>{p.text}</span>;
            if (p.type === 'remove')
              return (
                <span key={i} style={{ background: 'var(--red-bg)', color: 'var(--red)', textDecoration: 'line-through' }}>
                  {p.text}
                </span>
              );
            return (
              <span key={i} style={{ background: 'var(--green-bg)', color: 'var(--green)' }}>
                {p.text}
              </span>
            );
          })}
        </div>
      </div>
    </details>
  );
}

export default async function EventLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    if (err.status === 401) redirect('/login');
    return <NotAuthorized message={err.message} />;
  }

  const proposal = await getProposal(id);
  if (!proposal) return <p>Not found.</p>;
  if (!canViewProposal(user, proposal)) {
    return <NotAuthorized message="This proposal belongs to someone else." />;
  }
  const events = await getEvents(id);

  return (
    <div className="max-w-3xl mx-auto">
      <a href={`/p/${id}`} className="btn-link text-xs">← Back to proposal</a>
      <h1 className="text-xl font-semibold mt-2 mb-1">Event log — {proposal.company_name}</h1>
      <p className="text-sm text-[var(--ink-faint)] mb-6 max-w-prose">
        Every external step this proposal has gone through, most recent first — the whole
        answer to &ldquo;what happened and why.&rdquo; Any edit or regeneration carries an
        optional diff, below its row.
      </p>
      <div className="flex flex-col gap-2">
        {events.length === 0 && <div className="card text-sm text-[var(--ink-soft)]">No events yet.</div>}
        {events.map((e) => (
          <div key={e.id} className={e.ok ? 'card' : 'panel panel-danger'}>
            <div className="flex justify-between items-baseline gap-4">
              <span className="font-mono text-sm font-semibold">{e.step}</span>
              <span className="text-xs text-[var(--ink-faint)] shrink-0">
                {new Date(e.at).toLocaleString()} · {e.duration_ms ?? '?'}ms
              </span>
            </div>
            <span
              className="badge mt-1"
              style={e.ok ? { background: 'var(--green-bg)', color: 'var(--green)' } : { background: 'var(--red-bg)', color: 'var(--red)' }}
            >
              {e.ok ? 'ok' : 'failed'}
            </span>
            {!e.ok && Boolean(e.detail) && !hasDiff(e.detail) && (
              <pre className="text-xs mt-2 whitespace-pre-wrap font-mono">{JSON.stringify(e.detail, null, 2)}</pre>
            )}
            {hasDiff(e.detail) && (
              <EventDiff before={e.detail.before} after={e.detail.after} instruction={e.detail.instruction} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
