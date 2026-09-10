'use client';
import { useState } from 'react';
import type { SectionRow } from '@/lib/db-schemas';
import { daysUntilNudge } from '@/lib/permissions';
import StatusPill from '../../StatusPill';
import MarkdownBody from '../../MarkdownBody';
import ProposalClose from '../../ProposalClose';

type SerializedProposal = {
  id: string;
  status: string;
  version: number;
  client_name: string;
  client_email: string;
  company_name: string;
  date_of_call: string | null;
  salesperson_name: string;
  readiness: string | null;
  approver_id: string | null;
  rejected_reason: string | null;
  share_token: string | null;
  share_revoked: boolean;
  sent_at: string | null;
  nudge_paused: boolean;
  client_decision_at: string | null;
  client_decision_by: string | null;
  client_decline_reason: string | null;
};

type SerializedSection = Omit<SectionRow, 'generated_at' | 'edited_at'> & {
  generated_at: string | null;
  edited_at: string | null;
};

type SerializedMaterial = { id: string; filename: string; status: string; digest_md: string | null; created_at: string };

async function api(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export default function ProposalEditor({
  proposal,
  sections: initialSections,
  materials,
  nudge,
  canEdit,
  canEditContent,
  canApprove,
}: {
  proposal: SerializedProposal;
  sections: SerializedSection[];
  materials: SerializedMaterial[];
  /** The follow-up reminder, if one has already gone out. Read from the
   *  nudges table rather than inferred from a date, because that table is
   *  the only record of what was actually sent. */
  nudge: { sent_at: string } | null;
  /** False for an approver/admin reviewing someone else's proposal — they
   *  can read everything below, but every mutating control is hidden. The
   *  API routes enforce this too; this only keeps the UI from offering a
   *  button that would just come back as a 403. Gates Generate, Submit and
   *  material upload — actions that only ever make sense pre-content or
   *  are already status-gated by their own render condition. */
  canEdit: boolean;
  /** canEdit AND the proposal hasn't been sent yet. Gates Edit and
   *  Regenerate specifically — narrower than canEdit, because a sent
   *  proposal is a delivered document that must not be silently rewritten,
   *  while `approved`/`pending_approval`/`send_failed` must STAY editable
   *  so the database trigger that revokes a stale approval on edit
   *  (sql/02-triggers.sql) can actually run. */
  canEditContent: boolean;
  /** True for is_approver / is_admin. Approve/Reject live here, on the full
   *  proposal, not on the queue's list row — an approver should see what
   *  they're signing off on, not click blind from a summary line. */
  canApprove: boolean;
}) {
  const [status, setStatus] = useState(proposal.status);
  const [version, setVersion] = useState(proposal.version);
  const [rejectedReason, setRejectedReason] = useState(proposal.rejected_reason);
  // Whether the inline "why are you rejecting this" field is showing, and
  // its draft value — replaces a window.prompt() confirmation.
  const [rejecting, setRejecting] = useState(false);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [shareToken, setShareToken] = useState(proposal.share_token);
  const [shareRevoked, setShareRevoked] = useState(proposal.share_revoked);
  // Whether the inline "really revoke this?" confirmation is showing.
  const [revokingShare, setRevokingShare] = useState(false);
  const [nudgePaused, setNudgePaused] = useState(proposal.nudge_paused);
  // Only set right after a send THIS session — email delivery detail isn't
  // persisted for display on a later page load, only in the event log.
  const [sendEmailInfo, setSendEmailInfo] = useState<{ sent: boolean; skipped?: boolean; reason?: string } | null>(
    null,
  );
  const [sections, setSections] = useState(initialSections);
  const [materialsList, setMaterialsList] = useState(materials);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const hasContent = sections.some((s) => s.body_md.trim().length > 0);
  // Gates the Resubmit button on a rejected proposal — compared against
  // `initialSections` (the prop, never mutated), i.e. content as it stood
  // when this page loaded. Good enough for the common case (open a
  // rejected proposal, edit it, resubmit in the same visit) without
  // needing to separately track "content at the moment of rejection."
  const contentChangedSinceLoad = sections.some((s, i) => s.body_md !== initialSections[i]?.body_md);

  async function handleUploadMaterial(file: File) {
    setBusy('material');
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      // Deliberately not the shared api() helper — that always sets
      // Content-Type: application/json, which would strip the multipart
      // boundary a file upload needs. The browser sets that header itself
      // when the body is a FormData object.
      const res = await fetch(`/api/proposals/${proposal.id}/materials`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status})`);
      setMaterialsList((prev) => [
        ...prev,
        {
          id: data.material_id,
          filename: file.name,
          status: 'digested',
          digest_md: data.digest_md,
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerate() {
    setBusy('generate');
    setError('');
    try {
      const data = await api(`/api/proposals/${proposal.id}/generate`, { method: 'POST' });
      setSections((prev) =>
        prev.map((s) => {
          const match = data.sections.find((d: SectionRow) => d.section_key === s.section_key);
          return match ? { ...s, ...match, generated_at: new Date().toISOString() } : s;
        }),
      );
      setStatus('in_review');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRegenerate(sectionKey: string, instruction: string) {
    setBusy(`regen:${sectionKey}`);
    setError('');
    try {
      const data = await api(`/api/proposals/${proposal.id}/sections/${sectionKey}/regenerate`, {
        method: 'POST',
        body: JSON.stringify({ instruction: instruction.trim() || undefined, version }),
      });
      setSections((prev) => prev.map((s) => (s.section_key === sectionKey ? { ...s, ...data.section } : s)));
      setVersion((v) => v + 1);
      // The database trigger (revoke_approval_on_edit, sql/02-triggers.sql)
      // may have just bounced this proposal's status to in_review — e.g.
      // regenerating a section on an approved or rejected proposal. Without
      // reflecting that here, the Submit button wouldn't appear until a
      // manual page reload, even though the write already went through.
      if (data.status) setStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleEdit(sectionKey: string, body_md: string) {
    setBusy(`edit:${sectionKey}`);
    setError('');
    try {
      const data = await api(`/api/proposals/${proposal.id}/sections/${sectionKey}`, {
        method: 'PATCH',
        body: JSON.stringify({ body_md, version }),
      });
      setSections((prev) => prev.map((s) => (s.section_key === sectionKey ? { ...s, body_md, status: 'edited' } : s)));
      setVersion((v) => v + 1);
      // Same reasoning as handleRegenerate above.
      if (data.status) setStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSubmit() {
    setBusy('submit');
    setError('');
    try {
      const data = await api(`/api/proposals/${proposal.id}/submit`, {
        method: 'POST',
        body: JSON.stringify({ version }),
      });
      setStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleApprove() {
    setBusy('approve');
    setError('');
    try {
      const data = await api(`/api/proposals/${proposal.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'approve', version }),
      });
      setStatus(data.status);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleReject(reason: string) {
    setBusy('reject');
    setError('');
    try {
      const data = await api(`/api/proposals/${proposal.id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ decision: 'reject', reason, version }),
      });
      setStatus(data.status);
      setVersion((v) => v + 1);
      setRejectedReason(reason);
      setRejecting(false);
      setRejectReasonInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSend() {
    setBusy('send');
    setError('');
    try {
      const data = await api(`/api/proposals/${proposal.id}/send`, { method: 'POST' });
      setStatus(data.status); // 'sent'
      // The route mints the token on the first successful send and returns
      // it as proposal_link. The already-sent idempotent path omits it —
      // that only fires if this proposal was sent from elsewhere
      // between page load and this click, so fall back to whatever token
      // was already on the row rather than assume the field is present.
      if (data.proposal_link) {
        const token = new URL(data.proposal_link).pathname.split('/').pop() ?? null;
        setShareToken(token);
      }
      setSendEmailInfo(data.email ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRevokeShare() {
    setBusy('revoke-share');
    setError('');
    try {
      await api(`/api/proposals/${proposal.id}/revoke-share`, { method: 'POST' });
      setShareRevoked(true);
      setRevokingShare(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleNudgePause(paused: boolean) {
    setBusy('nudge-pause');
    setError('');
    try {
      await api(`/api/proposals/${proposal.id}/nudge-pause`, {
        method: 'POST',
        body: JSON.stringify({ paused }),
      });
      setNudgePaused(paused);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-1">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold truncate">{proposal.company_name}</h1>
          <p className="text-sm text-[var(--ink-faint)]">
            {proposal.client_name} · {proposal.salesperson_name}
          </p>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="flex items-center gap-3 mb-4">
        <a href={`/p/${proposal.id}/log`} className="btn-link text-xs">
          View event log →
        </a>
        {!canEdit && <span className="chip">Read-only — approve/review only</span>}
        {/* Tied to the specific status it describes, not the general
            "content isn't editable right now" condition — draft/blocked/
            generating are also !canEditContent, but for a different reason
            (nothing generated yet), and saying "Sent" for those would be
            just as wrong as it was for a rejected proposal. */}
        {canEdit && status === 'sent' && (
          <span className="chip">Sent — content can no longer be changed</span>
        )}
      </div>

      {error && <div className="panel panel-danger mb-4">{error}</div>}

      {!hasContent && status !== 'blocked' && canEdit && (
        <div className="card mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)] mb-2">
            Supporting material (optional)
          </h2>
          <p className="label-hint mb-3">
            PDF, .txt or .md, up to 20MB. Upload before generating — the draft only sees
            material that was digested first.
          </p>
          {materialsList.map((m) => (
            <div key={m.id} className="rounded-md border border-[var(--rule)] p-3 mb-2 text-sm">
              <p className="font-medium">{m.filename} — {m.status}</p>
              {m.digest_md && <p className="text-[var(--ink-soft)] mt-1 whitespace-pre-wrap">{m.digest_md}</p>}
            </div>
          ))}
          <label className="btn btn-ghost cursor-pointer text-xs">
            {busy === 'material' ? 'Uploading and reading…' : 'Choose a file'}
            <input
              type="file"
              accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              disabled={busy !== null}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUploadMaterial(file);
                e.target.value = '';
              }}
              className="sr-only"
            />
          </label>
        </div>
      )}

      {hasContent && materialsList.length > 0 && (
        <div className="card mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-faint)] mb-2">
            Supporting material
          </h2>
          {materialsList.map((m) => (
            <div key={m.id} className="rounded-md border border-[var(--rule)] p-3 mb-2 text-sm last:mb-0">
              <p className="font-medium">{m.filename} — {m.status}</p>
              {m.digest_md && <p className="text-[var(--ink-soft)] mt-1 whitespace-pre-wrap">{m.digest_md}</p>}
            </div>
          ))}
        </div>
      )}

      {!hasContent && status !== 'blocked' && canEdit && (
        <button onClick={handleGenerate} disabled={busy !== null} className="btn btn-primary mb-6">
          {busy === 'generate' ? 'Generating…' : 'Generate proposal'}
        </button>
      )}
      {!hasContent && status !== 'blocked' && !canEdit && (
        <p className="text-sm text-[var(--ink-faint)] mb-6">Nothing generated yet.</p>
      )}

      {hasContent && (
        <div className="flex flex-col gap-4 mb-6">
          {sections.map((s) => (
            <SectionCard
              key={s.section_key}
              section={s}
              busy={busy}
              canEdit={canEditContent}
              onRegenerate={(instruction) => handleRegenerate(s.section_key, instruction)}
              onSave={(body) => handleEdit(s.section_key, body)}
            />
          ))}

          {/* Shown read-only so the salesperson sees the same ending the
              client will. Without it the proposal appears to stop mid-letter
              in review, and the natural fix — typing a sign-off into
              next_steps by hand — would put two in the delivered document. */}
          <div className="card">
            <p className="label-hint mb-2">
              Added automatically to the client&apos;s copy and the PDF — not editable
            </p>
            <ProposalClose salespersonName={proposal.salesperson_name} />
          </div>
        </div>
      )}

      {hasContent && status === 'in_review' && canEdit && (
        <button
          onClick={handleSubmit}
          disabled={busy !== null}
          className="btn btn-success"
        >
          {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
        </button>
      )}

      {status === 'pending_approval' && canApprove && (
        <div>
          <div className="flex gap-2 items-center">
            <button onClick={handleApprove} disabled={busy !== null || rejecting} className="btn btn-success">
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </button>
            {!rejecting && (
              <button onClick={() => setRejecting(true)} disabled={busy !== null} className="btn btn-danger">
                Reject
              </button>
            )}
          </div>

          {rejecting && (
            <div className="mt-3 flex flex-col gap-2 max-w-md">
              <label className="flex flex-col gap-1.5">
                <span className="label-hint">Reason for rejecting (required)</span>
                <textarea
                  value={rejectReasonInput}
                  onChange={(e) => setRejectReasonInput(e.target.value)}
                  rows={2}
                  placeholder="What needs to change before this can be approved?"
                  disabled={busy !== null}
                  className="field text-sm resize-y"
                  autoFocus
                />
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => handleReject(rejectReasonInput.trim())}
                  disabled={busy !== null || !rejectReasonInput.trim()}
                  className="btn btn-danger"
                >
                  {busy === 'reject' ? 'Rejecting…' : 'Confirm reject'}
                </button>
                <button
                  onClick={() => {
                    setRejecting(false);
                    setRejectReasonInput('');
                  }}
                  disabled={busy !== null}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {status === 'pending_approval' && !canApprove && (
        <p className="text-sm text-[var(--ink-faint)]">
          Waiting on approval before this can be sent to the client.
        </p>
      )}
      {status === 'rejected' && (
        <div>
          <div className="panel panel-danger mb-3">
            Rejected{rejectedReason ? `: ${rejectedReason}` : '.'}
          </div>
          {canEdit && (
            <div>
              <button
                onClick={handleSubmit}
                disabled={busy !== null || !contentChangedSinceLoad}
                className="btn btn-success"
              >
                {busy === 'submit' ? 'Resubmitting…' : 'Resubmit for approval'}
              </button>
              {!contentChangedSinceLoad && (
                <p className="label-hint mt-2">
                  Edit or regenerate a section above to address the rejection — Resubmit unlocks once something's changed.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {status === 'approved' && (
        <div>
          <button onClick={handleSend} disabled={busy !== null} className="btn btn-success">
            {busy === 'send' ? 'Sending…' : 'Send to client'}
          </button>
          <p className="label-hint mt-2">
            Renders the PDF, mints the client link, and emails it — or records why not.
          </p>
        </div>
      )}

      {status === 'send_failed' && (
        <div className="panel panel-danger">
          <p className="font-semibold mb-2">
            Sending failed. See the event log for exactly which step and why.
          </p>
          <button onClick={handleSend} disabled={busy !== null} className="btn btn-danger">
            {busy === 'send' ? 'Retrying…' : 'Retry send'}
          </button>
        </div>
      )}

      {/* The client's own answer. Distinct from the 'rejected' panel above,
          which is the internal approver's — both can appear in one
          proposal's history and they mean different things. */}
      {status === 'accepted' && (
        <div className="panel panel-success">
          <p className="font-semibold mb-1">
            The client accepted this proposal
            {proposal.client_decision_at
              ? ` on ${new Date(proposal.client_decision_at).toLocaleDateString()}`
              : ''}
            .
          </p>
          {proposal.client_decision_by && <p>Confirmed by {proposal.client_decision_by}.</p>}
        </div>
      )}

      {status === 'declined' && (
        <div className="panel panel-danger">
          <p className="font-semibold mb-1">
            The client declined this proposal
            {proposal.client_decision_at
              ? ` on ${new Date(proposal.client_decision_at).toLocaleDateString()}`
              : ''}
            .
          </p>
          {proposal.client_decline_reason && (
            <p className="mb-1">
              Their reason: &ldquo;{proposal.client_decline_reason}&rdquo;
            </p>
          )}
          {proposal.client_decision_by && (
            <p className="text-[var(--ink-soft)]">Declined by {proposal.client_decision_by}.</p>
          )}
        </div>
      )}

      {status === 'sent' && shareToken && (
        <div className={shareRevoked ? 'panel panel-warning' : 'panel panel-success'}>
          <p className="font-semibold mb-2">Sent to the client.</p>

          {shareRevoked ? (
            /* Not just hiding the links — showing a live-looking link that
               now 404s would be worse than saying plainly that it's off. */
            <p>Client link revoked — that link and its PDF no longer open for anyone.</p>
          ) : (
            <>
              <p className="mb-1">
                Client link:{' '}
                <a href={`/p/share/${shareToken}`} target="_blank" rel="noreferrer" className="underline break-all">
                  {typeof window !== 'undefined' ? `${window.location.origin}/p/share/${shareToken}` : `/p/share/${shareToken}`}
                </a>
              </p>
              <p>
                <a href={`/p/share/${shareToken}/pdf`} target="_blank" rel="noreferrer" className="underline">
                  Download the PDF
                </a>
              </p>
            </>
          )}

          {sendEmailInfo?.skipped && !shareRevoked && (
            <p className="text-[var(--ink-soft)] mt-2">
              Client email was skipped: {sendEmailInfo.reason} — the link above still works.
            </p>
          )}
          {sendEmailInfo && !sendEmailInfo.sent && !sendEmailInfo.skipped && (
            <p className="text-[var(--red)] mt-2">Client email failed: {sendEmailInfo.reason}</p>
          )}

          {!shareRevoked && (
            <div className="mt-3 pt-3 border-t border-[var(--rule)]">
              {nudge ? (
                <p className="text-[var(--ink-soft)]">
                  Follow-up reminder sent on {new Date(nudge.sent_at).toLocaleDateString()}. Only
                  one is ever sent.
                </p>
              ) : nudgePaused ? (
                <p className="text-[var(--ink-soft)]">
                  Follow-ups paused — the client won&apos;t be reminded about this one.
                </p>
              ) : proposal.sent_at ? (
                <p className="text-[var(--ink-soft)]">
                  {daysUntilNudge(new Date(proposal.sent_at)) === 0
                    ? 'Follow-up reminder due — it will go out on the next scheduled run.'
                    : `Follow-up reminder in ${daysUntilNudge(new Date(proposal.sent_at))} day${
                        daysUntilNudge(new Date(proposal.sent_at)) === 1 ? '' : 's'
                      }, unless the client answers first.`}
                </p>
              ) : null}

              {/* Only worth offering while a reminder is still pending —
                  once one has been sent there is nothing left to pause. */}
              {canEdit && !nudge && (
                <button
                  onClick={() => handleNudgePause(!nudgePaused)}
                  disabled={busy !== null}
                  className="btn-link text-xs mt-1"
                >
                  {busy === 'nudge-pause'
                    ? 'Saving…'
                    : nudgePaused
                      ? 'Resume follow-ups'
                      : 'Pause follow-ups (already heard back another way)'}
                </button>
              )}
            </div>
          )}

          {!shareRevoked && canEdit && (
            <div className="mt-3">
              {revokingShare ? (
                <div className="flex flex-col gap-2">
                  <p className="label-hint">
                    Revoke this link? The client can no longer open the proposal or its PDF, and
                    this can&apos;t be undone — a new link would mean sending a fresh proposal.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleRevokeShare}
                      disabled={busy !== null}
                      className="btn btn-danger text-xs"
                    >
                      {busy === 'revoke-share' ? 'Revoking…' : 'Confirm revoke'}
                    </button>
                    <button
                      onClick={() => setRevokingShare(false)}
                      disabled={busy !== null}
                      className="btn btn-ghost text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setRevokingShare(true)}
                  disabled={busy !== null}
                  className="btn-link text-xs"
                  style={{ color: 'var(--red)' }}
                >
                  Revoke client link
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SectionCard({
  section,
  busy,
  canEdit,
  onRegenerate,
  onSave,
}: {
  section: SerializedSection;
  busy: string | null;
  canEdit: boolean;
  onRegenerate: (instruction: string) => void;
  onSave: (body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.body_md);
  const [instruction, setInstruction] = useState('');

  const assumptions = section.assumptions as string[];
  const gaps = section.gaps as string[];
  const isRegenerating = busy === `regen:${section.section_key}`;

  function submitRegenerate() {
    onRegenerate(instruction);
    setInstruction(''); // a one-off instruction for this rewrite, not meant to linger
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">{section.title}</h3>
        {canEdit && (
          <button onClick={() => setEditing((e) => !e)} className="btn-link text-xs">
            {editing ? 'Cancel' : 'Edit'}
          </button>
        )}
      </div>

      {(assumptions.length > 0 || gaps.length > 0) && (
        <div className="panel panel-warning mb-3 text-xs">
          {assumptions.length > 0 && <p className="mb-1"><b>Assumed:</b> {assumptions.join('; ')}</p>}
          {gaps.length > 0 && <p><b>Gaps:</b> {gaps.join('; ')}</p>}
        </div>
      )}

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            className="field font-mono text-xs resize-y"
          />
          <button
            onClick={() => {
              onSave(draft);
              setEditing(false);
            }}
            className="btn btn-primary self-start"
          >
            Save
          </button>
        </div>
      ) : section.body_md ? (
        <MarkdownBody body={section.body_md} />
      ) : (
        <p className="text-sm text-[var(--ink-faint)] italic">Not yet generated.</p>
      )}

      {!editing && canEdit && (
        <div className="mt-4 pt-4 divider">
          <label className="flex flex-col gap-1.5">
            <span className="label-hint">Regenerate this section — optional instruction</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && busy === null) submitRegenerate();
                }}
                placeholder="e.g. make this more concise"
                disabled={busy !== null}
                className="field text-sm flex-1"
              />
              <button onClick={submitRegenerate} disabled={busy !== null} className="btn btn-ghost text-xs shrink-0">
                {isRegenerating ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
          </label>
        </div>
      )}
    </div>
  );
}
