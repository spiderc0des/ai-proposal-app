# Koya Proposal Engine

A discovery-call intake becomes a six-section proposal written by Claude,
reviewed and edited section by section, approved by a human before it can
go out, then published as a client-facing link, exported as a PDF, emailed,
and logged — with every step recorded whether it worked or not.

```
intake  →  pre-flight audit  →  full draft  →  review & edit  →  submit
                                                                     │
                                                             approval gate
                                                     (an approver — may be
                                                      the author, if also
                                                       an approver)
                                                                     │
                                                                 approve
                                                                     ▼
                                                  share link + PDF (rendered
                                                  live, never stored) + email
                                                                     │
                                                    client accepts or declines
                                                    (one reminder first, if
                                                     they go quiet for 2 days)
                                                                     │
                                                                events log
                                                   (every step above, ok or not)
```

## Stack

- **Next.js 15** (App Router, TypeScript) — one deployable, Route Handlers
  keep the Anthropic key server-side by construction.
- **Supabase Postgres**, accessed with raw hand-written SQL (`postgres.js`),
  no ORM — the state machine's guarantees (nobody can send an unapproved
  proposal, a double-click can't send two emails) are enforced by a
  database `WHERE` clause or a unique constraint, in `lib/queries.ts`, not
  hoped for in application code.
- **Supabase Auth** magic links for identity, gated by an application-level
  allowlist (`app_users`) with three independent capability flags —
  `is_sales` / `is_approver` / `is_admin` — rather than one exclusive role.
- **`@anthropic-ai/sdk`** on `claude-opus-5`, with adaptive thinking and
  structured outputs (Zod schemas, via `zodOutputFormat`).
- **Zod** — one schema per shape (intake, Claude's structured outputs, API
  request bodies), shared across the browser form, the API boundary, and
  the database row, so the three can't quietly drift apart.
- **`@react-pdf/renderer`** for the client-facing PDF — pure JS rendering,
  no headless Chromium.
- **Gmail SMTP** (`nodemailer`) for the app's own client-delivery and
  approver-notification emails.
- **Vercel Cron** (`vercel.json`) for the one scheduled job — a single
  follow-up reminder to a client who hasn't answered.
- **Vitest** for unit tests, plus a small scenario harness
  (`npm run scenarios`) that exercises the core business logic end to end
  against a deterministic mock of Claude.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev
```

Environment variables (`lib/env.ts` validates all of these at startup and
refuses to boot if one is missing, naming exactly which):

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API |
| `DATABASE_URL` | Supabase project → Settings → Database → Connection string → **URI**, port **6543** (the transaction pooler). Percent-encode the password if it contains `@ % # / : ?` — a password copied straight off the dashboard usually needs this. |
| `APP_URL` | `http://localhost:3000` locally |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Optional. A Gmail address with an [App Password](https://myaccount.google.com/apppasswords) (requires 2-Step Verification on). Without these, the app's own emails are skipped (and logged as such) rather than failing — the client share link and PDF download still work either way. |
| `CRON_SECRET` | Optional. The bearer token guarding the scheduled follow-up job. Without it that endpoint refuses to run rather than running unsecured. Any long random string (`openssl rand -base64 32`); set the same value in the Vercel project so Vercel Cron can present it. |
| `MOCK_ANTHROPIC` | `1` to run against a deterministic stand-in for Claude instead of the real API (no cost, no network) |

## Database setup

Run these against a Supabase project, in order, in the SQL Editor:

1. `sql/01-schema.sql` — every table.
2. `sql/02-triggers.sql` — the rules the database enforces itself (an
   edit after approval revokes that approval; the event log is
   append-only; a proposal can only be approved from `pending_approval`).
   Safe to re-run any time either file changes — everything is
   `create or replace` / `if not exists`.
3. Sign in once through the running app (`/login`) for each real person —
   this creates a **pending** row in `app_users` automatically
   (`active = false`).
4. `sql/03-seed-users.sql` — edit the emails at the top, then run it, to
   activate those people and assign their capabilities.
5. `sql/04-verify.sql` — asserts the schema matches what the code expects
   and prints `All checks passed.` if it does.

`sql/05-client-decision.sql` and `sql/06-client-nudge.sql` are migrations for
a database that was set up before those features existed. A fresh project
does not need them — `01-schema.sql` already contains everything they add.

`sql/00-drop-everything.sql` is a destructive full reset, kept separate and
clearly labelled, for wiping a test database clean to start over from `01`.

## Testing

```bash
npm test            # unit tests — permissions, diff, PDF rendering, schemas
npm run scenarios   # core scenarios against the mocked Claude layer, sub-second
npm run typecheck   # tsc --noEmit
```

`npm run dev` with `MOCK_ANTHROPIC=1` runs the whole app against the same
deterministic mock, so the full flow (generate → review → approve → send)
can be exercised without an Anthropic key or any API cost.

## Project layout

```
app/                    Next.js App Router — pages and API routes
  api/proposals/        every backend route: create, generate, edit,
                         regenerate, submit, approve, send, delete
  api/share/[token]/     the client's own accept/decline — the only
                         unauthenticated write in the app; the token is
                         the credential
  api/cron/nudge/        the scheduled follow-up, behind a bearer secret
  p/[id]/                the review/edit/approve/send workspace
  p/share/[token]/       the client-facing page and its live PDF render
  proposals/, queue/     "my proposals" list and the approval queue
lib/
  claude.ts              the only Anthropic call site (audit, digest,
                          draft, regenerate)
  prompts/                the system prompt — the sole defense against a
                          fabricated price or date; there is no separate
                          mechanical check behind it
  queries.ts              every hand-written SQL statement in the app
  auth.ts, permissions.ts  session handling and the capability/ownership
                          rules, split out so the latter is unit-testable
                          in isolation
  pdf.tsx, markdown-subset.ts, diff.ts, email.ts, hash.ts   supporting
                          utilities — PDF rendering, the small markdown
                          subset Claude is allowed to write, the
                          word-level diff shown in the event log, Gmail
                          SMTP, content hashing
sql/                    schema, triggers, seed/verify/reset scripts
test/                   unit tests, the mocked Claude scenario harness,
                        and the fixtures behind both
```

## A few design decisions worth knowing before changing anything

- **A proposal is six database rows, not one document.** Regenerating one
  section is an `UPDATE` of exactly one row — the other five are read as
  context but never touched, by construction, not by a check.
- **Missing facts become a literal `[NEEDS INPUT: …]` marker**, never a
  guess. The system prompt (`lib/prompts/system.ts`) is the only defense
  against a fabricated price or date — there is no deterministic check
  running behind it, which is a deliberate trade for simplicity; catching
  a slip depends entirely on the model following those instructions, and
  a human reviewing the draft before Submit.
- **The approval gate is a database transaction, not a UI convention.**
  `POST /api/proposals/:id/send` re-derives every precondition from the
  database on every call — calling it directly with `curl` on an
  unapproved proposal gets exactly the same refusal a disabled button
  would represent.
- **Self-approval is allowed by design.** The brief asks for a human to
  verify Claude's output before delivery, not specifically a different
  human than whoever wrote it — someone holding both the sales and
  approver capabilities can review and approve their own work.
- **Delivery is a one-way door.** Once a proposal has actually been sent,
  no further submit/approve/reject can ever succeed again, checked
  directly against the existence of a `deliveries` row rather than trusted
  to the `status` column alone.
- **Deleting a proposal is a soft delete.** A real `DELETE` would cascade
  into the append-only `events` table, which refuses any delete
  unconditionally (including one arriving via cascade) — so a proposal is
  hidden behind a `deleted_at` flag instead, keeping its full history
  intact. Once a proposal has reached a client — `sent`, `accepted` or
  `declined` — it can never be deleted at all, by anyone.
- **The client's silence is a state the system can act on.** `status =
  'sent'` means the proposal reached a client and they have not answered —
  the accept/decline route is the only thing that moves it off that status.
  A daily job (`/api/cron/nudge`) uses exactly that to send one reminder
  after two days. It claims the nudge *before* sending, the opposite of the
  send route's ordering: for a reminder, at-most-once is the safer failure.
  A `nudges` row's primary key is what makes "only ever one" true, the same
  way `deliveries` does for the proposal itself.
- **Every external step logs itself before it's allowed to throw.** The
  `events` table is the whole answer to "what happened and why" — see
  `/p/:id/log` on any proposal.
- **No PDF is ever stored anywhere.** The client's copy is rendered fresh,
  from the live section rows, on every request to the share route.

Local, more detailed design notes and a full build log live in `docs/` and
the `aat-c3-week-3-proposal-app/` reference brief — both are present in
this working copy but intentionally left untracked (see `.gitignore`), so
they won't appear in a fresh clone of this repository.
