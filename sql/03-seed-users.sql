-- ════════════════════════════════════════════════════════════════════════════
-- 03 · Activate the people who should have access.  Run after 02.
--
-- HOW THIS WORKS, because it trips everybody up once:
--
-- Supabase keeps its own user list in auth.users. We keep app_users, keyed by
-- the same id. app/auth/callback/route.ts creates a PENDING row here
-- automatically the first time someone signs in — active = false. A pending
-- row grants nothing: findAppUser() (lib/queries.ts) only matches
-- active = true, so a pending person can sign in fine and still be told
-- "not on the approved list" everywhere in the app.
--
-- Three independent capability flags, not one exclusive role:
--   is_sales    — creates proposals; sees only proposals they authored.
--   is_approver — sees the approval queue, approves/rejects. Approving your
--                 OWN proposal is allowed — the brief asks for a human to
--                 verify Claude's output, not specifically a different
--                 human than whoever wrote it.
--   is_admin    — sees every proposal and every log regardless of author,
--                 and can approve anything. Use this for whoever runs the
--                 team, not for ordinary salespeople.
--
-- So the flow is:
--
--   1. Have each person request a magic link and sign in once. This creates
--      their row, pending, is_sales = true / everything else false by default.
--   2. Come back here, and set active = true plus whichever capabilities
--      each person should have.
-- ════════════════════════════════════════════════════════════════════════════

-- See who's pending:
select email, is_sales, is_approver, is_admin, active, created_at from app_users order by created_at desc;

-- ── EDIT THE EMAILS BELOW, then run this block ──────────────────────────────

-- A salesperson: writes proposals, sees only their own, can also approve
-- proposals (including their own) since they hold is_approver too.
update app_users set active = true, is_sales = true, is_approver = true, is_admin = false
  where email = 'you@example.com';

-- Another salesperson — the app supports as many of these as you need.
-- Each one sees only the proposals they personally created.
update app_users set active = true, is_sales = true, is_approver = false, is_admin = false
  where email = 'second-salesperson@example.com';

-- An admin: sees every proposal and every log from every salesperson, and
-- can approve anything, regardless of who created it.
update app_users set active = true, is_sales = false, is_approver = false, is_admin = true
  where email = 'admin@example.com';

-- Confirm it landed:
select email, is_sales, is_approver, is_admin, active from app_users order by email;
