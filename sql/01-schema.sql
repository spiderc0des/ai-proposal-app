-- ════════════════════════════════════════════════════════════════════════════
-- 01 · Schema.  Run first, once, against a fresh Supabase project.
-- Safe to re-run: everything is IF NOT EXISTS or guarded.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;   -- gen_random_uuid(), digest()

-- ── status: a fixed list, so a typo is rejected rather than stored ──────────
do $$ begin
  create type proposal_status as enum (
    'draft',             -- intake saved, nothing generated yet
    'blocked',           -- pre-flight audit refused: required intake missing
    'generating',
    'in_review',         -- a draft exists, salesperson is editing
    'pending_approval',
    'approved',
    'rejected',          -- the internal approver said no. NOT the client.
    'sent',
    'send_failed',
    'accepted',          -- the CLIENT accepted it, from the share link
    'declined'           -- the CLIENT said no, with a reason
  );
exception when duplicate_object then null; end $$;

-- ── people ─────────────────────────────────────────────────────────────────
-- Our own table, not Supabase's auth.users. This one is the ALLOWLIST: a
-- magic-link login for an email with no row here authorises nothing.
--
-- Three independent flags, not one exclusive role. A person can be any
-- combination:
--   is_sales    — can create proposals; sees only proposals they authored.
--   is_approver — can see the approval queue and approve/reject; the brief
--                 asks for a human to review Claude's output before client
--                 delivery, not specifically a DIFFERENT human than whoever
--                 wrote it — so approving your own proposal is allowed.
--   is_admin    — sees every proposal and every log regardless of author,
--                 and can approve anything. The one flag that bypasses the
--                 per-proposal ownership check everywhere it appears.
create table if not exists app_users (
  id           uuid primary key,             -- same id as auth.users.id
  email        text not null unique,
  full_name    text not null default '',
  is_sales     boolean not null default true,
  is_approver  boolean not null default false,
  is_admin     boolean not null default false,
  active       boolean not null default true,
  -- an active person with no capability at all could sign in and do
  -- nothing anywhere in the app, with no error explaining why — this makes
  -- that misconfiguration impossible to save rather than a support ticket.
  constraint app_users_active_needs_a_capability
    check (not active or is_sales or is_approver or is_admin),
  created_at  timestamptz not null default now(),
  -- How this person got here. An admin invite sets the first two; signing
  -- in on your own leaves them null. first_signed_in_at separates "invited,
  -- never clicked the link" from "signed in, waiting to be activated" — the
  -- admin page needs that to offer the right action (resend vs activate).
  invited_at          timestamptz,
  invited_by          text,
  first_signed_in_at  timestamptz
);

-- ── proposals ──────────────────────────────────────────────────────────────
create table if not exists proposals (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  status                 proposal_status not null default 'draft',
  version                int not null default 1,

  -- intake. Denormalised on purpose: it is the input of record for this
  -- proposal and must not change if a lookup table changes later.
  client_name            text not null,
  client_email           text not null,
  company_name           text not null,
  date_of_call           date,
  salesperson_name       text not null,
  client_needs_summary   text not null default '',
  project_scope          text not null default '',
  goals_and_objectives   text not null default '',
  recommended_services   text not null default '',
  proposed_timeline      text not null default '',
  estimated_pricing      text not null default '',

  intake_hash            text not null,
  author_id              uuid not null references app_users(id),

  -- result of the pre-flight audit
  readiness              text check (readiness in ('ready','thin','blocked')),
  audit_json             jsonb,

  -- approval
  approver_id            uuid references app_users(id),
  approved_at            timestamptz,
  approved_content_hash  text,
  rejected_reason        text,

  -- delivery
  share_token            text unique,
  share_expires_at       timestamptz,
  share_revoked          boolean not null default false,
  pdf_path               text,
  sent_at                timestamptz,

  -- the client's own decision, made from the share link. Kept separate from
  -- the approval block above: `rejected_reason` is the internal approver's,
  -- this is the client's, and one proposal can legitimately carry both in
  -- its history. Collapsing them would make the audit trail lie about who
  -- said no. `client_decision_by` is the name the client typed — a record of
  -- who acted, not authentication: anyone holding the link can decide.
  client_decision_at     timestamptz,
  client_decision_by     text,
  client_decline_reason  text,

  -- The salesperson's "stop chasing this one" switch, for when the client
  -- responded somewhere the app cannot see — an email reply, a phone call.
  -- Without it the follow-up job would nudge someone who already answered.
  nudge_paused           boolean not null default false,

  -- soft delete: hidden from every listing once set, never a hard DELETE.
  -- A hard delete would cascade into `events` (on delete cascade, sql/02-
  -- triggers.sql), and events_are_immutable() unconditionally raises on
  -- any DELETE there, including one arriving via cascade — so a hard
  -- delete of a proposal with any history at all would fail outright.
  -- Soft-deleting also keeps the audit trail intact for a proposal that
  -- did exist, which the append-only design already treats as load-bearing.
  deleted_at             timestamptz

  -- No constraint requiring approver_id <> author_id: the brief asks for a
  -- human to verify Claude's output before client delivery, not specifically
  -- a different human than the one who requested it. Approving your own
  -- proposal is allowed.
);

create index if not exists proposals_status_idx  on proposals (status, updated_at desc);
create index if not exists proposals_author_idx  on proposals (author_id, updated_at desc);

-- ── sections: one row each. This shape is why regenerating one section
--    cannot disturb the other five. ────────────────────────────────────────
create table if not exists proposal_sections (
  id            uuid primary key default gen_random_uuid(),
  proposal_id   uuid not null references proposals(id) on delete cascade,
  section_key   text not null,
  order_index   int  not null,
  title         text not null,
  body_md       text not null default '',
  status        text not null default 'pending'
                  check (status in ('pending','generated','edited','regenerating','failed')),
  assumptions   jsonb not null default '[]',
  gaps          jsonb not null default '[]',
  error         text,
  model         text,
  request_id    text,
  generated_at  timestamptz,
  edited_at     timestamptz,
  edited_by     uuid references app_users(id),
  unique (proposal_id, section_key)
);

create index if not exists sections_proposal_idx
  on proposal_sections (proposal_id, order_index);

-- ── supporting material ────────────────────────────────────────────────────
create table if not exists supporting_materials (
  id                 uuid primary key default gen_random_uuid(),
  proposal_id        uuid not null references proposals(id) on delete cascade,
  filename           text not null,
  mime               text not null,
  bytes              int  not null,
  anthropic_file_id  text,
  digest_md          text,
  citations_json     jsonb,
  status             text not null default 'uploaded'
                       check (status in ('uploaded','digesting','digested','failed')),
  error              text,
  created_at         timestamptz not null default now()
);

create index if not exists materials_proposal_idx
  on supporting_materials (proposal_id, created_at);

-- ── the log. Append-only: never updated, never deleted. ────────────────────
create table if not exists events (
  id           bigserial primary key,
  proposal_id  uuid references proposals(id) on delete cascade,
  at           timestamptz not null default now(),
  actor        text not null default 'system',
  step         text not null,
  ok           boolean not null,
  duration_ms  int,
  detail       jsonb not null default '{}'
);

create index if not exists events_proposal_idx on events (proposal_id, id desc);
create index if not exists events_failures_idx on events (at desc) where ok = false;

-- ── deliveries. proposal_id is the PRIMARY KEY, which is the whole
--    idempotency story: a second send is a duplicate-key error, not a
--    second email to a client. ──────────────────────────────────────────────
create table if not exists deliveries (
  proposal_id  uuid primary key references proposals(id) on delete cascade,
  to_email     text not null,
  -- Which service actually carried it, and its own id for that message.
  -- A provider_id is meaningless without this: a Gmail Message-ID and a
  -- Resend id look nothing alike, and in a year the label is what makes an
  -- old id traceable.
  --
  -- Deliberately NO default. It had one ('resend'), left over from before
  -- the switch to Gmail SMTP, and recordDelivery() never wrote the column —
  -- so every row in the table claimed 'resend' while carrying a Gmail
  -- Message-ID, and stayed wrong for as long as nobody looked. A default on
  -- a column nobody writes is not a convenience, it is a silent lie. With
  -- none, an insert that forgets it fails loudly instead.
  provider     text not null,
  provider_id  text,
  sent_at      timestamptz not null default now()
);

-- ── nudges. Same shape and same reasoning as deliveries above: the primary
--    key IS the "only ever nudged once" guarantee. A retried or concurrent
--    cron run gets a duplicate-key error instead of sending a client a
--    second reminder.
--
--    Deliberately a table rather than an `events` row. Events has no
--    uniqueness constraint, so it could not enforce this at all, and the
--    "has this been nudged?" scan would be `where step = '...'` with no
--    proposal_id — there is no index on `step`, so that means sequentially
--    scanning the busiest table in the app on every tick. Events still
--    narrates what happened; this table is what makes it true. ─────────────
create table if not exists nudges (
  proposal_id  uuid primary key references proposals(id) on delete cascade,
  to_email     text not null,
  provider_id  text,
  sent_at      timestamptz not null default now()
);

-- ── Row Level Security ─────────────────────────────────────────────────────
-- On, with NO policies at all. Every legitimate query in this app runs from a
-- backend route handler using the service role key, which bypasses RLS. So
-- this is not our authorisation mechanism (route handlers are) — it is a
-- second line of defence, so that a leaked anon key reads nothing.
alter table app_users            enable row level security;
alter table proposals            enable row level security;
alter table proposal_sections    enable row level security;
alter table supporting_materials enable row level security;
alter table events               enable row level security;
alter table deliveries           enable row level security;
alter table nudges               enable row level security;
