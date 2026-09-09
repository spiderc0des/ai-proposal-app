-- ════════════════════════════════════════════════════════════════════════════
-- 06 · Client follow-up nudges. Run once, against a project that already ran
-- an older 01-schema.sql (one without the `nudges` table and the
-- `nudge_paused` column). Safe to re-run.
--
-- WHY: a proposal a client never gets round to answering currently dies
-- quietly — nobody is prompted, the link expires, the deal is lost to
-- silence. A scheduled job now sends one reminder two days after send, if
-- the client hasn't accepted or declined.
--
-- The `nudges` primary key is the whole "only ever nudged once" guarantee,
-- exactly as `deliveries.proposal_id` is for sending: a retried or
-- concurrent cron run hits a duplicate key rather than emailing a client
-- twice.
--
-- If you are setting this project up FRESH, skip this file — the current
-- 01-schema.sql already creates both.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists nudges (
  proposal_id  uuid primary key references proposals(id) on delete cascade,
  to_email     text not null,
  provider_id  text,
  sent_at      timestamptz not null default now()
);

alter table proposals add column if not exists nudge_paused boolean not null default false;

-- RLS on, no policies — the same service-role-only posture every other table
-- in this schema has. Without this the anon key could read the table through
-- PostgREST, and it holds client email addresses.
alter table nudges enable row level security;

select 'Added the nudges table and proposals.nudge_paused.' as result;
