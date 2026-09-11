-- ════════════════════════════════════════════════════════════════════════════
-- 08 · Attribute trigger-written events to the person who caused them.
-- Run once, against a project that already ran an older 02-triggers.sql.
-- Safe to re-run.
--
-- WHY: sections_revoke_approval writes an `approval_revoked` event whenever
-- an edit invalidates an approval. It recorded actor = 'system', which is
-- true of the mechanism and useless to a reader — the entire point of the
-- event is that somebody's edit revoked an approval, and the only question
-- worth asking of it is whose.
--
-- lib/queries.ts (editSection / regenerateSectionRow) now publishes the
-- acting user's email into the transaction with
-- set_config('app.actor', …, true), and the trigger reads it back. The
-- `true` on current_setting means "return null if unset" rather than
-- raising, so a hand-written UPDATE from psql still works and falls back to
-- 'system'.
--
-- This file is just 02-triggers.sql's revoke function again. Re-running
-- 02-triggers.sql wholesale has the same effect — this exists so the change
-- is traceable on its own.
--
-- If you are setting this project up FRESH, skip this file — the current
-- 02-triggers.sql already contains it.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function revoke_approval_on_edit() returns trigger as $$
declare
  current_status proposal_status;
begin
  if new.body_md is not distinct from old.body_md then
    return new;
  end if;

  select status into current_status from proposals where id = new.proposal_id;

  if current_status in ('approved', 'pending_approval', 'send_failed') then
    update proposals
       set status                = 'in_review',
           approver_id           = null,
           approved_at           = null,
           approved_content_hash = null,
           version               = version + 1
     where id = new.proposal_id;

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

select 'approval_revoked events now name the person who caused them.' as result;
