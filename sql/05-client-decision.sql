-- ════════════════════════════════════════════════════════════════════════════
-- 05 · Client accept/decline. Run once, against a project that already ran
-- an older 01-schema.sql (one without the two client statuses and the three
-- client_decision_* columns). Safe to re-run.
--
-- WHY: until now the system knew nothing about a client beyond "SMTP accepted
-- the message." The share page and its PDF are pure reads that write nothing,
-- so a client could open a proposal fifty times and leave no trace. This adds
-- the first client-side signal: a decision, made from the share link.
--
-- `accepted` / `declined` are deliberately NOT the existing `rejected`, which
-- means the internal approver said no. A proposal can legitimately carry both
-- in its history, and collapsing them would make the audit trail lie about
-- who said no.
--
-- If you are setting this project up FRESH, skip this file — the current
-- 01-schema.sql already creates all of it.
-- ════════════════════════════════════════════════════════════════════════════

-- Enum values first, in their own statements. `alter type ... add value`
-- cannot be used by a later statement in the SAME transaction, so these have
-- to land before anything references them.
alter type proposal_status add value if not exists 'accepted';
alter type proposal_status add value if not exists 'declined';

alter table proposals add column if not exists client_decision_at    timestamptz;
alter table proposals add column if not exists client_decision_by    text;
alter table proposals add column if not exists client_decline_reason text;

select 'Added accepted/declined statuses and client_decision_* columns.' as result;
