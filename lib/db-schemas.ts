import { z } from 'zod';

/**
 * The shape of a row once it comes back from Postgres — the boundary Zod
 * validates. Not every insert needs this ceremony, but anything the UI or
 * an API response renders does: a renamed column should fail loudly here,
 * in one place, rather than as `undefined` on a page.
 */

export const ProposalRow = z.object({
  id: z.string(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
  status: z.enum([
    'draft', 'blocked', 'generating', 'in_review',
    'pending_approval', 'approved', 'rejected', 'sent', 'send_failed',
    // The client's own decision — distinct from 'rejected', which is the
    // internal approver's.
    'accepted', 'declined',
  ]),
  version: z.number(),

  client_name: z.string(),
  client_email: z.string(),
  company_name: z.string(),
  date_of_call: z.coerce.date().nullable(),
  salesperson_name: z.string(),
  client_needs_summary: z.string(),
  project_scope: z.string(),
  goals_and_objectives: z.string(),
  recommended_services: z.string(),
  proposed_timeline: z.string(),
  estimated_pricing: z.string(),

  intake_hash: z.string(),
  author_id: z.string(),

  readiness: z.enum(['ready', 'thin', 'blocked']).nullable(),
  audit_json: z.unknown().nullable(),

  approver_id: z.string().nullable(),
  approved_at: z.coerce.date().nullable(),
  approved_content_hash: z.string().nullable(),
  rejected_reason: z.string().nullable(),

  share_token: z.string().nullable(),
  share_expires_at: z.coerce.date().nullable(),
  share_revoked: z.boolean(),
  pdf_path: z.string().nullable(),
  sent_at: z.coerce.date().nullable(),
  deleted_at: z.coerce.date().nullable(),

  client_decision_at: z.coerce.date().nullable(),
  client_decision_by: z.string().nullable(),
  client_decline_reason: z.string().nullable(),

  nudge_paused: z.boolean(),
});
export type ProposalRow = z.infer<typeof ProposalRow>;

export const SectionRow = z.object({
  id: z.string(),
  proposal_id: z.string(),
  section_key: z.string(),
  order_index: z.number(),
  title: z.string(),
  body_md: z.string(),
  status: z.enum(['pending', 'generated', 'edited', 'regenerating', 'failed']),
  assumptions: z.array(z.string()),
  gaps: z.array(z.string()),
  error: z.string().nullable(),
  model: z.string().nullable(),
  request_id: z.string().nullable(),
  generated_at: z.coerce.date().nullable(),
  edited_at: z.coerce.date().nullable(),
  edited_by: z.string().nullable(),
});
export type SectionRow = z.infer<typeof SectionRow>;

export const MaterialRow = z.object({
  id: z.string(),
  proposal_id: z.string(),
  filename: z.string(),
  mime: z.string(),
  bytes: z.number(),
  anthropic_file_id: z.string().nullable(),
  digest_md: z.string().nullable(),
  citations_json: z.unknown().nullable(),
  status: z.enum(['uploaded', 'digesting', 'digested', 'failed']),
  error: z.string().nullable(),
  created_at: z.coerce.date(),
});
export type MaterialRow = z.infer<typeof MaterialRow>;

export const EventRow = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  proposal_id: z.string().nullable(),
  at: z.coerce.date(),
  actor: z.string(),
  step: z.string(),
  ok: z.boolean(),
  duration_ms: z.number().nullable(),
  detail: z.unknown(),
});
export type EventRow = z.infer<typeof EventRow>;

export const AppUserRow = z.object({
  id: z.string(),
  email: z.string(),
  full_name: z.string(),
  // Three independent flags, not one exclusive role — a person can hold
  // any combination. is_admin bypasses per-proposal ownership checks
  // everywhere they appear. See sql/01-schema.sql for why.
  is_sales: z.boolean(),
  is_approver: z.boolean(),
  is_admin: z.boolean(),
  active: z.boolean(),
  // .nullish(), not .nullable(): findAppUser() — which runs on every signed-in
  // request — selects an explicit column list that omits these. A required
  // key here would make that parse fail and lock every user out of the app.
  // Only listAppUsers() (select *) reads them, for the admin page.
  invited_at: z.coerce.date().nullish(),
  invited_by: z.string().nullish(),
  first_signed_in_at: z.coerce.date().nullish(),
});
export type AppUserRow = z.infer<typeof AppUserRow>;
