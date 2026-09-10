import 'server-only';
import { sql } from './db';
import { SECTIONS } from './sections';
import { contentHash, hashObject } from './hash';
import type { Intake } from './schemas';
import {
  AppUserRow, EventRow, MaterialRow, ProposalRow, SectionRow,
} from './db-schemas';

/**
 * Every hand-written SQL statement in the app lives in this one file: the
 * load-bearing statements here are conditional writes whose WHERE clause
 * IS the business rule, and an ORM would sit between us and exactly that
 * part.
 *
 * A renamed column fails at runtime, not at compile time — that cost is
 * paid for by keeping every statement here (a rename is a one-file change)
 * and by sql/04-verify.sql asserting the schema in CI.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   People — the allowlist.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function findAppUser(authUserId: string): Promise<AppUserRow | null> {
  const rows = await sql`
    select id, email, full_name, is_sales, is_approver, is_admin, active
    from app_users
    where id = ${authUserId} and active = true
  `;
  return rows[0] ? AppUserRow.parse(rows[0]) : null;
}

/**
 * Called right after a Supabase Auth session is first established
 * (app/auth/callback/route.ts). Creates a PENDING row — active = false —
 * so a brand-new person shows up in the table for an admin to grant access
 * to, rather than needing their auth.users UUID copied out of the Supabase
 * dashboard by hand before they can even be considered.
 *
 * `on conflict (id) do nothing` is what makes this safe to call on every
 * sign-in, not just the first: an already-provisioned row — active or
 * not, whatever role it has — is never touched. This function can only
 * ever create the pending state; only an admin, editing the row directly,
 * moves someone out of it.
 */
export async function ensurePendingAppUser(id: string, email: string): Promise<void> {
  await sql`
    insert into app_users (id, email, is_sales, is_approver, is_admin, active)
    values (${id}, ${email}, true, false, false, false)
    on conflict (id) do nothing
  `;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Proposals
   ═══════════════════════════════════════════════════════════════════════════ */
export async function createProposal(intake: Intake, authorId: string): Promise<ProposalRow> {
  const intake_hash = hashObject(intake);

  const rows = await sql`
    insert into proposals (
      client_name, client_email, company_name, date_of_call, salesperson_name,
      client_needs_summary, project_scope, goals_and_objectives,
      recommended_services, proposed_timeline, estimated_pricing,
      intake_hash, author_id
    ) values (
      ${intake.client_name}, ${intake.client_email}, ${intake.company_name},
      ${intake.date_of_call || null}, ${intake.salesperson_name},
      ${intake.client_needs_summary}, ${intake.project_scope}, ${intake.goals_and_objectives},
      ${intake.recommended_services}, ${intake.proposed_timeline}, ${intake.estimated_pricing},
      ${intake_hash}, ${authorId}
    )
    returning *
  `;

  const proposal = ProposalRow.parse(rows[0]);

  // Seed the six section rows up front, empty, so regenerating one section
  // later is an UPDATE of one of these rows, never a rewrite of the whole
  // document.
  await sql`
    insert into proposal_sections (proposal_id, section_key, order_index, title)
    values ${sql(
      SECTIONS.map((s) => [proposal.id, s.key, s.order, s.title]),
    )}
  `;

  return proposal;
}

// Every read below excludes soft-deleted rows (deleted_at is null) — once
// deleteProposal() sets it, a proposal is gone everywhere in the app, not
// just off the list page. See deleteProposal() for why this is a soft
// delete rather than a real one.
export async function getProposal(id: string): Promise<ProposalRow | null> {
  const rows = await sql`select * from proposals where id = ${id} and deleted_at is null`;
  return rows[0] ? ProposalRow.parse(rows[0]) : null;
}

export async function getProposalByShareToken(token: string): Promise<ProposalRow | null> {
  const rows = await sql`
    select * from proposals
    where share_token = ${token}
      and share_revoked = false
      and deleted_at is null
      and (share_expires_at is null or share_expires_at > now())
  `;
  return rows[0] ? ProposalRow.parse(rows[0]) : null;
}

export async function listProposals(filter: {
  status?: string[];
  authorId?: string;
} = {}): Promise<ProposalRow[]> {
  const rows = await sql`
    select * from proposals
    where deleted_at is null
      ${filter.status ? sql`and status = any(${filter.status})` : sql``}
      ${filter.authorId ? sql`and author_id = ${filter.authorId}` : sql``}
    order by updated_at desc
    limit 100
  `;
  return rows.map((r) => ProposalRow.parse(r));
}

/**
 * How many proposals sit at each status, under the same visibility rule as
 * listProposals. Drives the status filter on /proposals: it's what lets the
 * page offer only the statuses that actually exist for this person, instead
 * of eleven chips where most lead to an empty list.
 */
export async function countProposalsByStatus(
  filter: { authorId?: string } = {},
): Promise<Record<string, number>> {
  const rows = await sql`
    select status, count(*)::int as count
      from proposals
     where deleted_at is null
       ${filter.authorId ? sql`and author_id = ${filter.authorId}` : sql``}
     group by status
  `;
  return Object.fromEntries(rows.map((r) => [r.status as string, r.count as number]));
}

/**
 * Soft delete — sets `deleted_at`, never a real `DELETE`. A hard delete
 * would cascade into `events` (on delete cascade, sql/01-schema.sql), and
 * events_are_immutable() (sql/02-triggers.sql) unconditionally raises on
 * any DELETE there, including one arriving via that cascade — so a real
 * delete of a proposal with any event history (i.e. any proposal past the
 * moment it's created) would fail outright. This also means the full audit
 * trail survives a "delete," which fits the append-only design already in
 * place elsewhere.
 *
 * The status guard is enforced here, in the WHERE clause, not only by the
 * route's own check above it — the same belt-and-braces pattern as every
 * other state transition in this file.
 *
 * Everything from `sent` onward is undeletable: the proposal reached a real
 * client, and what happened next — nothing yet, accepted, or declined — is a
 * fact about that engagement, not clutter. A declined proposal is arguably
 * the most valuable of the three to keep, since it's the only record of why
 * something was lost.
 */
export async function deleteProposal(id: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const rows = await sql`
    update proposals
       set deleted_at = now()
     where id = ${id}
       and deleted_at is null
       and status not in ('sent', 'accepted', 'declined')
     returning id
  `;
  if (rows[0]) return { ok: true };

  const current = await sql`select status, deleted_at from proposals where id = ${id}`;
  if (!current[0]) return { ok: false, reason: 'Proposal not found.' };
  if (current[0].deleted_at) return { ok: false, reason: 'Already deleted.' };
  return {
    ok: false,
    reason: `Cannot delete a '${current[0].status}' proposal — once it has reached a client, it stays on the record.`,
  };
}

export async function getSections(proposalId: string): Promise<SectionRow[]> {
  const rows = await sql`
    select * from proposal_sections
    where proposal_id = ${proposalId}
    order by order_index
  `;
  return rows.map((r) => SectionRow.parse(r));
}

export async function getMaterials(proposalId: string): Promise<MaterialRow[]> {
  const rows = await sql`
    select * from supporting_materials
    where proposal_id = ${proposalId}
    order by created_at
  `;
  return rows.map((r) => MaterialRow.parse(r));
}

/* ── the pre-flight audit result ─────────────────────────────────────────── */
export async function recordAudit(
  proposalId: string,
  readiness: 'ready' | 'thin' | 'blocked',
  auditJson: unknown,
): Promise<ProposalRow> {
  const rows = await sql`
    update proposals
       set readiness = ${readiness},
           audit_json = ${sql.json(auditJson as any)},
           status = ${readiness === 'blocked' ? 'blocked' : 'generating'}
     where id = ${proposalId}
       and status in ('draft', 'blocked')
     returning *
  `;
  if (!rows[0]) throw new ConflictError('Proposal is not in a state that can be audited.');
  return ProposalRow.parse(rows[0]);
}

/* ── writing the generated draft: six rows, one transaction ─────────────── */
export async function saveDraftSections(
  proposalId: string,
  sections: { section_key: string; title: string; body_md: string; assumptions: string[]; gaps: string[] }[],
  model: string,
  requestId: string | null,
): Promise<void> {
  await sql.begin(async (tx) => {
    for (const s of sections) {
      await tx`
        update proposal_sections
           set title = ${s.title},
               body_md = ${s.body_md},
               status = 'generated',
               assumptions = ${sql.json(s.assumptions)},
               gaps = ${sql.json(s.gaps)},
               model = ${model},
               request_id = ${requestId},
               generated_at = now()
         where proposal_id = ${proposalId} and section_key = ${s.section_key}
      `;
    }
    await tx`
      update proposals set status = 'in_review' where id = ${proposalId} and status = 'generating'
    `;
  });
}

export async function markGenerationFailed(proposalId: string, error: string): Promise<void> {
  await sql`
    update proposals set status = 'in_review' where id = ${proposalId} and status = 'generating'
  `;
  // there is no per-section failure yet on the very first draft — the whole
  // attempt failed, so every section is marked so the UI can say why
  await sql`
    update proposal_sections
       set status = 'failed', error = ${error}
     where proposal_id = ${proposalId} and status = 'pending'
  `;
}

/* ── the regeneration guarantee: ONE row, guarded by version ────────────── */
export class VersionConflictError extends Error {
  constructor() {
    super('Someone else changed this proposal first. Reload and try again.');
    this.name = 'VersionConflictError';
  }
}
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export async function regenerateSectionRow(params: {
  proposalId: string;
  sectionKey: string;
  expectedVersion: number;
  title: string;
  body_md: string;
  assumptions: string[];
  gaps: string[];
  model: string;
  requestId: string | null;
}): Promise<void> {
  await sql.begin(async (tx) => {
    // The optimistic lock lives on `proposals.version`, checked here before
    // the one section row is touched — a salesperson editing a sibling
    // section while this regeneration was in flight loses the race cleanly.
    const [current] = await tx`select version from proposals where id = ${params.proposalId}`;
    if (!current || current.version !== params.expectedVersion) {
      throw new VersionConflictError();
    }

    await tx`
      update proposal_sections
         set title = ${params.title},
             body_md = ${params.body_md},
             status = 'generated',
             assumptions = ${sql.json(params.assumptions)},
             gaps = ${sql.json(params.gaps)},
             model = ${params.model},
             request_id = ${params.requestId},
             generated_at = now(),
             error = null
       where proposal_id = ${params.proposalId} and section_key = ${params.sectionKey}
    `;
    // Bump the version so a concurrent editor is told about THIS change too,
    // and return what it actually became. The caller must not infer it by
    // adding one: the sections_revoke_approval trigger may ALSO have bumped
    // it during the section update above (it does, for approved /
    // pending_approval / send_failed), making the real increment two.
    await tx`update proposals set version = version + 1 where id = ${params.proposalId}`;
  });
}

export async function markSectionFailed(
  proposalId: string,
  sectionKey: string,
  error: string,
): Promise<void> {
  await sql`
    update proposal_sections
       set status = 'failed', error = ${error}
     where proposal_id = ${proposalId} and section_key = ${sectionKey}
  `;
}

/** A manual edit in the review UI — also version-guarded. */
export async function editSection(params: {
  proposalId: string;
  sectionKey: string;
  body_md: string;
  editedBy: string;
  expectedVersion: number;
}): Promise<void> {
  await sql.begin(async (tx) => {
    const [current] = await tx`select version from proposals where id = ${params.proposalId}`;
    if (!current || current.version !== params.expectedVersion) {
      throw new VersionConflictError();
    }
    await tx`
      update proposal_sections
         set body_md = ${params.body_md},
             status = 'edited',
             edited_at = now(),
             edited_by = ${params.editedBy}
       where proposal_id = ${params.proposalId} and section_key = ${params.sectionKey}
    `;
    // NB: if the proposal was 'approved', 'pending_approval' or
    // 'send_failed', the sections_revoke_approval trigger
    // (sql/02-triggers.sql) has already fired during the update above and
    // reset the status, bumping the version itself. So this is the SECOND
    // increment in those cases and the first in every other — which is
    // exactly why the new value is returned rather than left for the caller
    // to guess by adding one.
    await tx`update proposals set version = version + 1 where id = ${params.proposalId}`;
  });
}

/* ── the state machine transitions, each a guarded UPDATE ────────────────── */

/**
 * Also the resubmit path for a `rejected` proposal — not a separate
 * function, because it's the same transition (→ `pending_approval`) with
 * the same guarantees. `rejected_reason` is cleared on the way through:
 * once resubmitted, the old reason describes a state that no longer
 * exists, and would otherwise linger and read as still-current if this
 * round is rejected again for a different reason.
 *
 * `not exists (... deliveries ...)` makes delivery a one-way door,
 * independent of whatever `status` currently claims: once a proposal has
 * actually been sent, no further submit/approve/reject can ever succeed
 * again, full stop. This is stronger than trusting `status` alone — a
 * proposal was observed reaching `rejected` after already being `sent`,
 * through a sequence this file's guards should have made unreachable but
 * evidently didn't; this closes that off at the one fact that can't drift
 * independently of an actual send: whether a delivery row exists.
 */
export async function submitForApproval(
  proposalId: string,
  expectedVersion: number,
): Promise<ProposalRow> {
  const rows = await sql`
    update proposals
       set status = 'pending_approval', rejected_reason = null, version = version + 1
     where id = ${proposalId}
       and status in ('in_review', 'rejected')
       and version = ${expectedVersion}
       and not exists (select 1 from deliveries where proposal_id = proposals.id)
     returning *
  `;
  if (!rows[0]) {
    // Was it the version, the status, or an existing delivery? Tell the
    // caller which.
    const current = await getProposal(proposalId);
    if (!current) throw new ConflictError('Proposal not found.');
    if (current.version !== expectedVersion) throw new VersionConflictError();
    const [delivered] = await sql`select 1 from deliveries where proposal_id = ${proposalId}`;
    if (delivered) throw new ConflictError('This proposal has already been sent and cannot be resubmitted.');
    throw new ConflictError(`Cannot submit from status '${current.status}'.`);
  }
  return ProposalRow.parse(rows[0]);
}

export async function decideApproval(params: {
  proposalId: string;
  decision: 'approve' | 'reject';
  approverId: string;
  reason?: string;
  expectedVersion: number;
}): Promise<ProposalRow> {
  if (params.decision === 'reject') {
    const rows = await sql`
      update proposals
         set status = 'rejected',
             rejected_reason = ${params.reason ?? ''},
             -- Defensive, not load-bearing in the normal flow: reaching
             -- 'pending_approval' the ordinary way (submit) never has these
             -- set in the first place. Cleared anyway so a rejected row can
             -- never carry a stale approver_id/approved_at from some other
             -- path — a rejected proposal was never approved, and should
             -- never look like it was.
             approver_id = null,
             approved_at = null,
             approved_content_hash = null,
             version = version + 1
       where id = ${params.proposalId}
         and status = 'pending_approval'
         and version = ${params.expectedVersion}
         and not exists (select 1 from deliveries where proposal_id = proposals.id)
       returning *
    `;
    if (!rows[0]) {
      // Was it the version, the status, or an existing delivery? Tell the
      // caller which — see the identical pattern in submitForApproval(),
      // including why the delivery check exists at all.
      const current = await getProposal(params.proposalId);
      if (!current) throw new ConflictError('Proposal not found.');
      if (current.version !== params.expectedVersion) throw new VersionConflictError();
      const [delivered] = await sql`select 1 from deliveries where proposal_id = ${params.proposalId}`;
      if (delivered) throw new ConflictError('This proposal has already been sent and cannot be rejected.');
      throw new ConflictError(`Cannot reject from status '${current.status}'.`);
    }
    return ProposalRow.parse(rows[0]);
  }

  // The hash is computed HERE, from the sections as they stand right now —
  // never accepted as a parameter from the caller. That is what makes it
  // trustworthy: nobody can approve a hash of content that isn't actually
  // what is in the database at the moment of approval.
  const sections = await getSections(params.proposalId);
  const hash = contentHash(sections);

  // No author <> approver check here: the brief asks for a human to verify
  // Claude's output before client delivery, not specifically a different
  // human than whoever wrote it. Approving your own proposal is allowed —
  // the required capability (is_approver or is_admin) is checked by the
  // route handler before this is ever called.
  const rows = await sql`
    update proposals
       set status = 'approved',
           approver_id = ${params.approverId},
           approved_at = now(),
           approved_content_hash = ${hash},
           version = version + 1
     where id = ${params.proposalId}
       and status = 'pending_approval'
       and version = ${params.expectedVersion}
       and not exists (select 1 from deliveries where proposal_id = proposals.id)
     returning *
  `;
  if (!rows[0]) {
    const current = await getProposal(params.proposalId);
    if (!current) throw new ConflictError('Proposal not found.');
    if (current.version !== params.expectedVersion) throw new VersionConflictError();
    const [delivered] = await sql`select 1 from deliveries where proposal_id = ${params.proposalId}`;
    if (delivered) throw new ConflictError('This proposal has already been sent and cannot be approved again.');
    throw new ConflictError(`Cannot approve from status '${current.status}'.`);
  }
  return ProposalRow.parse(rows[0]);
}

/**
 * The five-condition send precondition, all re-derived from the database
 * right now, inside this one function. This is called directly by the
 * route — there is no "disabled button" story here: calling this route
 * directly with curl gets exactly this check, and the guarantee lives in
 * this statement, not in whether a button happened to be disabled.
 */
export async function checkSendPreconditions(proposalId: string): Promise<
  | { ok: true; proposal: ProposalRow }
  | { ok: false; reason: string }
> {
  const proposal = await getProposal(proposalId);
  if (!proposal) return { ok: false, reason: 'Proposal not found.' };
  // 'send_failed' means approval itself is still valid — a later step
  // (PDF, email) failed partway. Without accepting it here too, a failed
  // send is a permanent dead end: markSendFailed() sets exactly this status
  // and nothing ever moves it back to 'approved' on its own.
  if (proposal.status !== 'approved' && proposal.status !== 'send_failed') {
    return { ok: false, reason: `Status is '${proposal.status}', not 'approved'.` };
  }
  if (!proposal.approver_id) {
    return { ok: false, reason: 'No approver on record.' };
  }

  // Was the content edited after approval? The database trigger
  // (sections_revoke_approval) already resets status on any such edit, so
  // this check almost never fires in practice — it exists for the case
  // where content changed by a path the trigger doesn't cover.
  const sections = await getSections(proposalId);
  const currentHash = contentHash(sections);
  if (currentHash !== proposal.approved_content_hash) {
    return { ok: false, reason: 'Approved content does not match current content. Re-approve before sending.' };
  }

  const [existing] = await sql`select 1 from deliveries where proposal_id = ${proposalId}`;
  if (existing) {
    return { ok: false, reason: 'Already sent.' };
  }
  return { ok: true, proposal };
}

export async function recordDelivery(params: {
  proposalId: string;
  toEmail: string;
  providerId: string | null;
}): Promise<{ alreadySent: boolean }> {
  try {
    await sql`
      insert into deliveries (proposal_id, to_email, provider_id)
      values (${params.proposalId}, ${params.toEmail}, ${params.providerId})
    `;
    return { alreadySent: false };
  } catch (err) {
    // proposal_id is the PRIMARY KEY — this is the whole idempotency story.
    // A double-clicked Send is a duplicate-key error, not a second email.
    if (err instanceof Error && /duplicate key|unique constraint/i.test(err.message)) {
      return { alreadySent: true };
    }
    throw err;
  }
}

export async function markSent(proposalId: string, pdfPath: string, shareToken: string, shareExpiresAt: Date): Promise<void> {
  await sql`
    update proposals
       set status = 'sent', sent_at = now(), pdf_path = ${pdfPath},
           share_token = ${shareToken}, share_expires_at = ${shareExpiresAt}
     where id = ${proposalId}
  `;
}

export async function markSendFailed(proposalId: string): Promise<void> {
  await sql`update proposals set status = 'send_failed' where id = ${proposalId}`;
}

/**
 * Kills a sent proposal's client link. The read path already enforces this —
 * getProposalByShareToken() filters `share_revoked = false`, so the share
 * page and its PDF route both 404 the moment this lands.
 *
 * `share_token is not null` is the real gate rather than a status check: a
 * token only ever exists after markSent(), so there is nothing to revoke
 * before then. One-way by design — there is no un-revoke, because minting a
 * replacement token for an already-delivered proposal runs into the
 * delivery one-way-door guards above.
 */
export async function revokeShare(
  proposalId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const rows = await sql`
    update proposals
       set share_revoked = true
     where id = ${proposalId}
       and share_token is not null
       and share_revoked = false
     returning id
  `;
  if (rows[0]) return { ok: true };

  const [current] = await sql`
    select share_token, share_revoked from proposals where id = ${proposalId}
  `;
  if (!current) return { ok: false, reason: 'Proposal not found.' };
  if (current.share_revoked) return { ok: false, reason: 'The client link is already revoked.' };
  return { ok: false, reason: 'This proposal has no client link to revoke — it has not been sent yet.' };
}

/**
 * The client's own accept/decline, made from the share link.
 *
 * Keyed on the TOKEN, not the proposal id: the client never sees an id, and
 * doing it this way makes the authority check and the write a single atomic
 * statement — you cannot decide on a proposal whose token you do not hold,
 * because holding it is the WHERE clause. The same four conditions
 * getProposalByShareToken() enforces for reading are repeated here rather
 * than checked separately, so a link that went stale between rendering the
 * page and clicking the button cannot slip through.
 *
 * `status = 'sent'` is what makes a decision final: a second POST matches
 * nothing, so no separate idempotency handling is needed anywhere above.
 */
export async function recordClientDecision(params: {
  token: string;
  decision: 'accept' | 'decline';
  name: string;
  reason?: string;
}): Promise<{ ok: true; proposal: ProposalRow } | { ok: false; reason: string }> {
  const rows = await sql`
    update proposals
       set status = ${params.decision === 'accept' ? 'accepted' : 'declined'},
           client_decision_at = now(),
           client_decision_by = ${params.name},
           client_decline_reason = ${params.reason ?? null}
     where share_token = ${params.token}
       and status = 'sent'
       and share_revoked = false
       and deleted_at is null
       and (share_expires_at is null or share_expires_at > now())
     returning *
  `;
  if (rows[0]) return { ok: true, proposal: ProposalRow.parse(rows[0]) };

  // Nothing matched — say which of the conditions failed. Deliberately does
  // NOT reveal anything about a proposal the caller has no valid token for.
  const [current] = await sql`
    select status, share_revoked, deleted_at, share_expires_at
      from proposals where share_token = ${params.token}
  `;
  if (!current || current.deleted_at) return { ok: false, reason: 'not_found' };
  if (current.share_revoked) return { ok: false, reason: 'not_found' };
  if (current.share_expires_at && new Date(current.share_expires_at) <= new Date()) {
    return { ok: false, reason: 'not_found' };
  }
  if (current.status === 'accepted' || current.status === 'declined') {
    return { ok: false, reason: 'This proposal has already been answered.' };
  }
  return { ok: false, reason: 'This proposal is not awaiting a decision.' };
}

/* ── follow-up nudges ─────────────────────────────────────────────────────── */

/**
 * Every proposal that is overdue a reminder, oldest first.
 *
 * `status = 'sent'` is the whole definition of "the client hasn't answered":
 * recordClientDecision() is the only writer that moves a proposal off it, so
 * anything still sitting on 'sent' is unanswered by construction. The rest of
 * the WHERE clause is about not sending a reminder that would embarrass us:
 * a revoked or expired link points at a 404, a paused proposal is one the
 * salesperson has already heard back on some other way, and the `not exists`
 * against the nudges primary key is what makes a second run a no-op.
 *
 * Deliberately not built on listProposals(): that one caps at 100 rows with
 * no cursor, ordered by recency, which for a backlog scan would silently
 * skip the oldest — precisely the proposals this is for.
 */
export async function listProposalsNeedingNudge(params: {
  afterDays: number;
  limit: number;
}): Promise<ProposalRow[]> {
  const rows = await sql`
    select p.* from proposals p
     where p.status = 'sent'
       and p.deleted_at is null
       and p.nudge_paused = false
       and p.share_revoked = false
       and p.sent_at < now() - make_interval(days => ${params.afterDays})
       and (p.share_expires_at is null or p.share_expires_at > now())
       and not exists (select 1 from nudges n where n.proposal_id = p.id)
     order by p.sent_at asc
     limit ${params.limit}
  `;
  return rows.map((r) => ProposalRow.parse(r));
}

/**
 * Claims the one nudge a proposal ever gets. Same shape as recordDelivery():
 * proposal_id is the PRIMARY KEY, so two cron runs racing each other means
 * one duplicate-key error, not two emails.
 *
 * The cron route calls this BEFORE sending, which is the opposite of the
 * send route's ordering. For a reminder, at-most-once is the safer failure:
 * a crash between claim and send costs one client a nudge, where the other
 * ordering could send the same client two.
 */
export async function recordNudge(params: {
  proposalId: string;
  toEmail: string;
  providerId: string | null;
}): Promise<{ alreadyNudged: boolean }> {
  try {
    await sql`
      insert into nudges (proposal_id, to_email, provider_id)
      values (${params.proposalId}, ${params.toEmail}, ${params.providerId})
    `;
    return { alreadyNudged: false };
  } catch (err) {
    if (err instanceof Error && /duplicate key|unique constraint/i.test(err.message)) {
      return { alreadyNudged: true };
    }
    throw err;
  }
}

/**
 * Backfills the provider's message id onto a nudge that has already been
 * claimed. Needed because the claim happens BEFORE the send — so the row is
 * written when the id doesn't exist yet, and without this the column would
 * be permanently null and therefore a lie. Best-effort: the nudge is already
 * recorded and the event log carries the id too.
 */
export async function attachNudgeProviderId(proposalId: string, providerId: string): Promise<void> {
  await sql`update nudges set provider_id = ${providerId} where proposal_id = ${proposalId}`;
}

/** The nudge that was actually sent, for the sent panel to report. */
export async function getNudge(proposalId: string): Promise<{ sent_at: Date; to_email: string } | null> {
  const rows = await sql`
    select to_email, sent_at from nudges where proposal_id = ${proposalId}
  `;
  if (!rows[0]) return null;
  return { to_email: String(rows[0].to_email), sent_at: new Date(rows[0].sent_at) };
}

/**
 * The salesperson's "I've already heard from them" switch. Unlike revoking a
 * link this is reversible, so it takes the desired state rather than being
 * one-way — the guard is only that the proposal exists and is still live.
 */
export async function setNudgePaused(
  proposalId: string,
  paused: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const rows = await sql`
    update proposals
       set nudge_paused = ${paused}
     where id = ${proposalId}
       and deleted_at is null
     returning id
  `;
  if (rows[0]) return { ok: true };
  return { ok: false, reason: 'Proposal not found.' };
}

/* ── supporting materials ─────────────────────────────────────────────────── */
export async function insertMaterial(params: {
  proposalId: string;
  filename: string;
  mime: string;
  bytes: number;
  anthropicFileId: string | null;
}): Promise<MaterialRow> {
  const rows = await sql`
    insert into supporting_materials (proposal_id, filename, mime, bytes, anthropic_file_id)
    values (${params.proposalId}, ${params.filename}, ${params.mime}, ${params.bytes}, ${params.anthropicFileId})
    returning *
  `;
  return MaterialRow.parse(rows[0]);
}

export async function saveDigest(
  materialId: string,
  digest_md: string,
  citations: unknown,
): Promise<void> {
  await sql`
    update supporting_materials
       set digest_md = ${digest_md}, citations_json = ${sql.json(citations as any)}, status = 'digested'
     where id = ${materialId}
  `;
}

export async function markMaterialFailed(materialId: string, error: string): Promise<void> {
  await sql`
    update supporting_materials set status = 'failed', error = ${error} where id = ${materialId}
  `;
}

/* ── the log. Append-only — see sql/02-triggers.sql, which enforces this
       at the database level, not just here. ───────────────────────────────── */
export async function logEvent(params: {
  proposalId: string | null;
  actor: string;
  step: string;
  ok: boolean;
  durationMs?: number;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await sql`
    insert into events (proposal_id, actor, step, ok, duration_ms, detail)
    values (
      ${params.proposalId}, ${params.actor}, ${params.step}, ${params.ok},
      ${params.durationMs ?? null}, ${sql.json((params.detail ?? {}) as any)}
    )
  `;
}

export async function getEvents(proposalId: string): Promise<EventRow[]> {
  const rows = await sql`
    select * from events where proposal_id = ${proposalId} order by id desc
  `;
  return rows.map((r) => EventRow.parse(r));
}
