import { z } from 'zod';
import { SECTION_KEYS } from './sections';
import type { ProposalRow } from './db-schemas';

/* ═══════════════════════════════════════════════════════════════════════════
   1 · Intake — the eleven fields from the brief's intake-form-fields.md.

   This one object validates three things: the form in the browser, the body
   arriving at our API, and the row we write. One definition, so the three can
   never drift apart.
   ═══════════════════════════════════════════════════════════════════════════ */
export const IntakeSchema = z.object({
  client_name: z.string().trim().min(1, 'Who is the client contact?'),
  client_email: z.string().trim().email('That does not look like an email address'),
  company_name: z.string().trim().min(1, 'Which company?'),
  date_of_call: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker')
    .optional()
    .or(z.literal('')),
  salesperson_name: z.string().trim().min(1, 'Who owns this proposal?'),

  // The substantive fields. Allowed to be empty here — the pre-flight audit
  // decides whether what is present is enough, and says so in plain words.
  // Rejecting an empty box at the form would just teach people to type "n/a".
  client_needs_summary: z.string().trim().default(''),
  project_scope: z.string().trim().default(''),
  goals_and_objectives: z.string().trim().default(''),
  recommended_services: z.string().trim().default(''),
  proposed_timeline: z.string().trim().default(''),
  estimated_pricing: z.string().trim().default(''),
});

export type Intake = z.infer<typeof IntakeSchema>;

/**
 * A ProposalRow (lib/db-schemas.ts) is NOT an Intake, even though every
 * Intake field is denormalised onto it — `date_of_call` alone is enough to
 * break `IntakeSchema.parse()` on a raw row: the database stores it as
 * `Date | null` (`z.coerce.date().nullable()`), while the intake form's
 * schema expects a plain `'YYYY-MM-DD'` string or `undefined`. Passing a
 * ProposalRow straight into `IntakeSchema.parse()` throws a ZodError on
 * that field on every call — a `Date` object and `.optional().or(literal(''))`
 * never match — surfaced to the caller as a bare "Invalid request." with no
 * clue which field. This converts the one field that actually differs and
 * then validates the rest as normal.
 */
export function proposalToIntake(proposal: ProposalRow): Intake {
  return IntakeSchema.parse({
    ...proposal,
    date_of_call: proposal.date_of_call ? proposal.date_of_call.toISOString().slice(0, 10) : '',
  });
}

/** The fields whose content the proposal is actually built from. */
export const SUBSTANTIVE_FIELDS = [
  'client_needs_summary',
  'project_scope',
  'goals_and_objectives',
  'recommended_services',
  'proposed_timeline',
  'estimated_pricing',
] as const;

/* ═══════════════════════════════════════════════════════════════════════════
   2 · Pre-flight audit — what Claude returns when grading the intake.
   ═══════════════════════════════════════════════════════════════════════════ */
export const AuditSchema = z.object({
  readiness: z.enum(['ready', 'thin', 'blocked']),
  fields: z.array(
    z.object({
      key: z.string(),
      verdict: z.enum(['sufficient', 'thin', 'missing']),
      why: z.string(),
    }),
  ),
  clarifying_questions: z.array(z.string()),
  blocking_reason: z.string().nullable(),
});

export type Audit = z.infer<typeof AuditSchema>;

/* ═══════════════════════════════════════════════════════════════════════════
   3 · Draft — the six sections.

   Deliberately simple: objects, strings, enums, arrays. No .refine(), no
   .length() — those do not survive the trip into a JSON schema. The
   six-sections rule is checked in code instead (lib/claude.ts), which also
   produces a far better error message than a schema violation would.
   ═══════════════════════════════════════════════════════════════════════════ */
const SectionOutput = z.object({
  section_key: z.enum(SECTION_KEYS),
  title: z.string(),
  body_md: z.string(),
  // Things Claude inferred rather than was told. Required on purpose: a model
  // asked for prose smooths over a gap, a model asked to ENUMERATE what it
  // assumed will list it, because the field is there and empty looks wrong.
  assumptions: z.array(z.string()),
  // Things genuinely missing from the intake.
  gaps: z.array(z.string()),
});

export const DraftSchema = z.object({
  sections: z.array(SectionOutput),
});

export const RegenSchema = z.object({
  section: SectionOutput,
});

export type SectionOutput = z.infer<typeof SectionOutput>;
export type Draft = z.infer<typeof DraftSchema>;

/* ═══════════════════════════════════════════════════════════════════════════
   4 · API request bodies
   ═══════════════════════════════════════════════════════════════════════════ */
export const RegenRequestSchema = z.object({
  instruction: z.string().trim().max(500).optional(),
  version: z.coerce.number().int().positive(),
});

export const EditSectionSchema = z.object({
  body_md: z.string(),
  version: z.coerce.number().int().positive(),
});

export const ApproveSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(1000).optional(),
  version: z.coerce.number().int().positive(),
});
