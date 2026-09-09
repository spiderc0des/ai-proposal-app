-- ════════════════════════════════════════════════════════════════════════════
-- 00 · Drop everything. DESTRUCTIVE — deletes every table and all data.
--
-- Run this only when you want to throw away the whole database and
-- recreate it fresh, starting again from sql/01-schema.sql. Typical reason:
-- test data has piled up and you want a blank slate.
--
-- After this runs, app_users is empty — everyone (including you) will
-- need to sign in again to get a fresh pending row, then sql/03-seed-users.sql
-- activates them.
-- ════════════════════════════════════════════════════════════════════════════

drop table if exists deliveries cascade;
drop table if exists events cascade;
drop table if exists supporting_materials cascade;
drop table if exists proposal_sections cascade;
drop table if exists proposals cascade;
drop table if exists app_users cascade;

drop type if exists proposal_status cascade;

-- CASCADE on the table drops above removes the triggers that reference
-- these, but not the trigger FUNCTIONS themselves — they're separate
-- objects and need dropping explicitly.
drop function if exists touch_updated_at() cascade;
drop function if exists revoke_approval_on_edit() cascade;
drop function if exists events_are_immutable() cascade;
drop function if exists guard_approval() cascade;

select 'Dropped. Run sql/01-schema.sql, then 02-triggers.sql, next.' as result;
