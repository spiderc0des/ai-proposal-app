-- ════════════════════════════════════════════════════════════════════════════
-- 09 · Invitations. Run once, against a project that already ran an older
-- 01-schema.sql. Safe to re-run. Purely additive — every new column is
-- nullable with no default, so code deployed before this runs is unaffected.
--
-- WHY: an admin can now invite someone by email from /admin. Until now the
-- only way in was for a person to sign in first and then wait to be noticed
-- in the pending list. Three columns make the two routes into the table
-- distinguishable, which the admin page needs in order to say something
-- true about each pending row:
--
--   invited_at / invited_by — set when an admin sends an invite. Null for
--       anyone who arrived by signing in on their own.
--   first_signed_in_at — set the first time the person actually completes a
--       sign-in. "Invited, never signed in" and "signed in, awaiting
--       activation" look identical without it, and they call for different
--       actions: resend the invite, or activate.
--
-- If you are setting this project up FRESH, skip this file — the current
-- 01-schema.sql already contains all three.
-- ════════════════════════════════════════════════════════════════════════════

alter table app_users add column if not exists invited_at         timestamptz;
alter table app_users add column if not exists invited_by         text;
alter table app_users add column if not exists first_signed_in_at timestamptz;

-- Everyone already in the table got here by signing in, so they have, by
-- definition, signed in. created_at is when that first happened.
update app_users
   set first_signed_in_at = created_at
 where first_signed_in_at is null
   and invited_at is null;

select email, invited_at, first_signed_in_at from app_users order by created_at;
