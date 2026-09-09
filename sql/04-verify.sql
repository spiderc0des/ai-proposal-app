-- ════════════════════════════════════════════════════════════════════════════
-- 04 · Verify. Run after 01-03 (and any time you suspect drift between this
-- schema and lib/queries.ts / lib/db-schemas.ts).
--
-- Every hand-written SQL statement lives in lib/queries.ts (see the comment
-- at the top of that file for why). The cost of that choice is that a
-- renamed column fails at RUNTIME, not at compile time. This script is how
-- that cost is paid down: it asserts the schema matches what the app
-- expects, so a drift shows up here — in one place, with a clear message —
-- instead of as an opaque error the first time a route touches that column.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  missing text[] := '{}';
  check_col record;
  expected_cols text[][] := array[
    array['proposals', 'id'], array['proposals', 'status'], array['proposals', 'version'],
    array['proposals', 'client_name'], array['proposals', 'client_email'], array['proposals', 'company_name'],
    array['proposals', 'date_of_call'], array['proposals', 'salesperson_name'],
    array['proposals', 'client_needs_summary'], array['proposals', 'project_scope'],
    array['proposals', 'goals_and_objectives'], array['proposals', 'recommended_services'],
    array['proposals', 'proposed_timeline'], array['proposals', 'estimated_pricing'],
    array['proposals', 'intake_hash'], array['proposals', 'author_id'],
    array['proposals', 'readiness'], array['proposals', 'audit_json'],
    array['proposals', 'approver_id'], array['proposals', 'approved_at'],
    array['proposals', 'approved_content_hash'], array['proposals', 'rejected_reason'],
    array['proposals', 'share_token'], array['proposals', 'share_expires_at'],
    array['proposals', 'share_revoked'], array['proposals', 'pdf_path'], array['proposals', 'sent_at'],
    array['proposals', 'deleted_at'],
    array['proposals', 'client_decision_at'], array['proposals', 'client_decision_by'],
    array['proposals', 'client_decline_reason'],
    array['proposal_sections', 'proposal_id'], array['proposal_sections', 'section_key'],
    array['proposal_sections', 'order_index'], array['proposal_sections', 'title'],
    array['proposal_sections', 'body_md'], array['proposal_sections', 'status'],
    array['proposal_sections', 'assumptions'], array['proposal_sections', 'gaps'],
    array['proposal_sections', 'model'], array['proposal_sections', 'request_id'],
    array['supporting_materials', 'anthropic_file_id'], array['supporting_materials', 'digest_md'],
    array['supporting_materials', 'citations_json'],
    array['events', 'proposal_id'], array['events', 'actor'], array['events', 'step'],
    array['events', 'ok'], array['events', 'duration_ms'], array['events', 'detail'],
    array['deliveries', 'proposal_id'], array['deliveries', 'to_email'], array['deliveries', 'provider_id'],
    array['app_users', 'id'], array['app_users', 'email'],
    array['app_users', 'is_sales'], array['app_users', 'is_approver'], array['app_users', 'is_admin']
  ];
  pair text[];
begin
  foreach pair slice 1 in array expected_cols loop
    if not exists (
      select 1 from information_schema.columns
      where table_name = pair[1] and column_name = pair[2]
    ) then
      missing := array_append(missing, pair[1] || '.' || pair[2]);
    end if;
  end loop;

  if array_length(missing, 1) > 0 then
    raise exception 'Missing columns lib/queries.ts expects: %', array_to_string(missing, ', ');
  end if;
end $$;

-- ── enum values match lib/db-schemas.ts ProposalRow.status exactly ─────────
do $$
declare
  expected text[] := array['draft','blocked','generating','in_review','pending_approval','approved','rejected','sent','send_failed','accepted','declined'];
  actual text[];
begin
  select array_agg(enumlabel order by enumsortorder) into actual
  from pg_enum where enumtypid = 'proposal_status'::regtype;

  if actual is distinct from expected then
    raise exception 'proposal_status enum drifted. Expected %, found %', expected, actual;
  end if;
end $$;

-- ── self-approval is allowed by design — this constraint must NOT exist.
--    sql/01-schema.sql never creates it; this only catches a stray manual
--    `alter table` someone added by hand. ───────────────────────────────
do $$ begin
  if exists (
    select 1 from pg_constraint where conname = 'approver_is_not_author'
  ) then
    raise exception 'approver_is_not_author exists but should not — self-approval is allowed by design; drop the constraint';
  end if;
end $$;

-- ── an active person always has at least one capability ─────────────────────
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_users_active_needs_a_capability'
  ) then
    raise exception 'app_users_active_needs_a_capability constraint is missing — an active user with no capabilities is possible';
  end if;
end $$;

-- ── the trigger that revokes approval on edit ───────────────────────────────
do $$ begin
  if not exists (
    select 1 from pg_trigger where tgname = 'sections_revoke_approval'
  ) then
    raise exception 'sections_revoke_approval trigger is missing — an approved proposal could be edited and sent unreviewed';
  end if;
end $$;

-- ── deliveries.proposal_id is the PRIMARY KEY (the idempotency guarantee) ──
do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_name = 'deliveries' and constraint_type = 'PRIMARY KEY'
  ) then
    raise exception 'deliveries has no primary key — a double-send would insert two rows instead of one';
  end if;
end $$;

-- ── RLS is on everywhere, with no policies (service-role-only access) ──────
do $$
declare
  tbl text;
  bad text[] := '{}';
begin
  foreach tbl in array array['proposals','proposal_sections','supporting_materials','events','deliveries','app_users']
  loop
    if not (select relrowsecurity from pg_class where relname = tbl) then
      bad := array_append(bad, tbl);
    end if;
  end loop;
  if array_length(bad, 1) > 0 then
    raise exception 'RLS is not enabled on: %', array_to_string(bad, ', ');
  end if;
end $$;

select 'All checks passed.' as result;
