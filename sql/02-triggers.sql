-- ════════════════════════════════════════════════════════════════════════════
-- 02 · Triggers.  Run after 01.
--
-- These are rules the database enforces itself. That matters: a route handler
-- we forget to update cannot bypass them.
-- ════════════════════════════════════════════════════════════════════════════

-- ── keep updated_at honest ─────────────────────────────────────────────────
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end $$ language plpgsql;

drop trigger if exists proposals_touch on proposals;
create trigger proposals_touch before update on proposals
  for each row execute function touch_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- The important one.
--
-- Editing a section's text after the proposal has been approved must revoke
-- that approval. Without this, you could approve a proposal, rewrite the
-- pricing, and send content nobody signed off.
--
-- Deliberately does NOT cover 'rejected': there is nothing to revoke there
-- (a rejected proposal was never approved), and unlike approved/pending/
-- send_failed, a rejected proposal is meant to STAY 'rejected' through an
-- edit — the UI shows an explicit "Resubmit for approval" button, enabled
-- only once the content has actually changed, rather than resubmitting
-- itself the instant a single character changes. See
-- lib/queries.ts submitForApproval() for the resubmit path (it now also
-- accepts 'rejected' as a starting status, not only 'in_review').
--
-- It lives here rather than in TypeScript so that every present and future
-- route that touches body_md is covered, including ones written in a hurry.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function revoke_approval_on_edit() returns trigger as $$
declare
  current_status proposal_status;
begin
  -- only a real change to the text counts; touching status or metadata does not
  if new.body_md is not distinct from old.body_md then
    return new;
  end if;

  select status into current_status from proposals where id = new.proposal_id;

  -- send_failed included alongside approved/pending_approval: it means
  -- approval succeeded and only the delivery step (PDF/email) failed, so
  -- approved_content_hash still points at the pre-edit text. Without
  -- covering it here, editing during send_failed would leave the row
  -- silently pointing at approved content that no longer matches — a
  -- retry would correctly refuse to send (the hash check in
  -- checkSendPreconditions), but the status would stay 'send_failed'
  -- instead of honestly reflecting that this needs a fresh review.
  if current_status in ('approved', 'pending_approval', 'send_failed') then
    update proposals
       set status                = 'in_review',
           approver_id           = null,
           approved_at           = null,
           approved_content_hash = null,
           version               = version + 1
     where id = new.proposal_id;

    -- Attributed to the person whose edit caused this, not to 'system'.
    -- lib/queries.ts (editSection / regenerateSectionRow) publishes their
    -- email with set_config('app.actor', …, true) inside the same
    -- transaction; the `true` second argument to current_setting means
    -- "return null if unset" rather than raising, so a write from psql or a
    -- migration still works and simply falls back.
    --
    -- This exists because the row used to say 'system', which is true of
    -- the mechanism and useless to a reader: the entire point of the event
    -- is that somebody's edit invalidated an approval, and the only
    -- question worth asking of it is whose.
    insert into events (proposal_id, actor, step, ok, detail)
    values (new.proposal_id,
            coalesce(nullif(current_setting('app.actor', true), ''), 'system'),
            'approval_revoked', true,
            jsonb_build_object(
              'reason',       'section text edited after approval',
              'section_key',  new.section_key,
              'was_status',   current_status
            ));
  end if;

  return new;
end $$ language plpgsql;

drop trigger if exists sections_revoke_approval on proposal_sections;
create trigger sections_revoke_approval after update on proposal_sections
  for each row execute function revoke_approval_on_edit();


-- ── the log is append-only, and the database is what makes that true ───────
create or replace function events_are_immutable() returns trigger as $$
begin
  raise exception 'events is append-only: % is not permitted', tg_op;
end $$ language plpgsql;

drop trigger if exists events_no_update on events;
create trigger events_no_update before update or delete on events
  for each row execute function events_are_immutable();


-- ── a proposal cannot be approved unless it is awaiting approval ───────────
-- The route handler checks this too, in its WHERE clause. Belt and braces:
-- this catches a direct database edit as well.
--
-- Both checks guard the TRANSITION into 'approved', not the state of being
-- approved — hence `new.status is distinct from old.status` on each. Without
-- it the first check fired on every subsequent update to an already-approved
-- row, because such a row has new.status = 'approved' and old.status =
-- 'approved', which is indeed not 'pending_approval'. The practical effect
-- was that an approved proposal could never be soft-deleted: deleteProposal()
-- permits it (only sent/accepted/declined are undeletable), but the UPDATE
-- setting deleted_at was refused here, with an error about approving that had
-- nothing to do with what the caller was trying to do.
create or replace function guard_approval() returns trigger as $$
begin
  if new.status = 'approved'
     and new.status is distinct from old.status
     and old.status <> 'pending_approval' then
    raise exception
      'cannot approve from status %: a proposal must be pending_approval first',
      old.status;
  end if;

  if new.status = 'approved'
     and new.status is distinct from old.status
     and new.approved_content_hash is null then
    raise exception
      'cannot approve without recording approved_content_hash';
  end if;

  return new;
end $$ language plpgsql;

drop trigger if exists proposals_guard_approval on proposals;
create trigger proposals_guard_approval before update on proposals
  for each row execute function guard_approval();
