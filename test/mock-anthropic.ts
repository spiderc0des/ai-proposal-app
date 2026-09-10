/**
 * Deterministic stand-ins for the four Claude call sites, used when
 * MOCK_ANTHROPIC=1. No network call, no cost, and — critically — able to
 * pretend to fail on command, which is the only practical way to test
 * "what happens when Claude refuses" or "what happens on a 429" without
 * waiting for the real thing to happen.
 *
 * Scenario tests trigger a failure by putting a marker in `client_name`:
 *   "FORCE_REFUSAL"   -> a refusal, exactly like stop_reason: 'refusal'
 *   "FORCE_RATE_LIMIT" -> a rate-limit failure after retries
 *   "FORCE_MAX_TOKENS" -> a truncated reply
 * Anything else runs the normal, successful path.
 */
import { SUBSTANTIVE_FIELDS, type Audit, type Draft, type Intake, type RegenSchema } from '../lib/schemas';
import { SECTIONS } from '../lib/sections';
import type { ClaudeOutcome } from '../lib/claude';
import { z } from 'zod';

function forcedFailure<T>(intake: Intake): ClaudeOutcome<T> | null {
  const marker = intake.client_name;
  if (marker === 'FORCE_REFUSAL') {
    return {
      ok: false,
      reason: 'refusal',
      message: 'Claude declined this request for a safety reason.',
      category: 'mock',
      requestId: 'req_mock_refusal',
      durationMs: 5,
    };
  }
  if (marker === 'FORCE_RATE_LIMIT') {
    return {
      ok: false,
      reason: 'rate_limit',
      message: 'Claude is rate-limiting requests. Try again shortly.',
      requestId: 'req_mock_429',
      durationMs: 5,
    };
  }
  if (marker === 'FORCE_MAX_TOKENS') {
    return {
      ok: false,
      reason: 'invalid_response',
      message: 'The reply was cut off before it finished (max_tokens reached).',
      requestId: 'req_mock_truncated',
      durationMs: 5,
    };
  }
  return null;
}

function ok<T>(data: T, requestId: string): ClaudeOutcome<T> {
  return {
    ok: true,
    data,
    requestId,
    model: 'claude-opus-5-mock',
    durationMs: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function isThin(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.length === 0 || v === 'n/a' || v === 'tbd' || v.length < 15;
}

export function mockAuditFor(intake: Intake): ClaudeOutcome<Audit> {
  const forced = forcedFailure<Audit>(intake);
  if (forced) return forced;

  const needsBad = isThin(intake.client_needs_summary);
  const scopeBad = isThin(intake.project_scope);

  const fields: Audit['fields'] = SUBSTANTIVE_FIELDS.map((key) => {
    const v = intake[key];
    const verdict: 'sufficient' | 'thin' | 'missing' = isThin(v)
      ? v.trim()
        ? 'thin'
        : 'missing'
      : 'sufficient';
    return {
      key,
      verdict,
      why:
        verdict === 'sufficient'
          ? 'Enough to write from.'
          : `"${key}" is ${verdict === 'missing' ? 'empty' : 'too vague to build a section on'}.`,
    };
  });

  if (needsBad && scopeBad) {
    return ok(
      {
        readiness: 'blocked',
        fields,
        clarifying_questions: [
          'What problem is the client actually trying to solve?',
          'What, concretely, would we be building or delivering?',
        ],
        blocking_reason:
          'Neither the client needs nor the project scope has enough content to draft a proposal from.',
      },
      'req_mock_audit_blocked',
    );
  }

  const anyThin = fields.some((f) => f.verdict !== 'sufficient');
  return ok(
    {
      readiness: anyThin ? 'thin' : 'ready',
      fields,
      clarifying_questions: fields
        .filter((f) => f.verdict !== 'sufficient')
        .map((f) => `Can you get more detail on ${f.key.replace(/_/g, ' ')}?`),
      blocking_reason: null,
    },
    'req_mock_audit',
  );
}

export function mockDigestFor(fileId: string) {
  return ok(
    {
      digest_md:
        `From the uploaded document: the client's current process handles roughly ` +
        `40 dispatch events per day, and their fleet-tracking API refreshes GPS ` +
        `positions every 30 seconds. ("current volume is about 40 dispatches a day, ` +
        `with GPS pings every 30 seconds")`,
      citations: [
        {
          cited_text: 'current volume is about 40 dispatches a day, with GPS pings every 30 seconds',
          document_index: 0,
          document_title: fileId,
        },
      ],
    },
    'req_mock_digest',
  );
}

function sectionFor(key: string, intake: Intake): Draft['sections'][number] {
  const meta = SECTIONS.find((s) => s.key === key)!;
  const assumptions: string[] = [];
  const gaps: string[] = [];
  let body = '';

  switch (key) {
    case 'introduction':
      body =
        `## Introduction\n\nThank you for taking the time to speak with us, ${intake.client_name}. ` +
        `Based on our conversation, we understand ${intake.company_name} is dealing with: ` +
        `${intake.client_needs_summary || '[NEEDS INPUT: a summary of the client\'s needs]'}\n\n` +
        `We believe the approach below will help you ${intake.goals_and_objectives || '[NEEDS INPUT: the goals this project should achieve]'}.`;
      if (!intake.client_needs_summary) gaps.push('No client needs summary was provided.');
      break;
    case 'proposed_solution':
      assumptions.push('Assumed a phased rollout is acceptable given no rollout preference was stated.');
      body =
        `## Proposed Solution\n\n### Project Scope\n\n${intake.project_scope || '[NEEDS INPUT: the project scope]'}\n\n` +
        `### Recommended Approach\n\nWe recommend starting with a focused pilot before a full rollout, ` +
        `so the approach can be validated against real usage before scaling it across the organisation.`;
      if (!intake.project_scope) gaps.push('No project scope was provided.');
      break;
    case 'deliverables':
      body =
        `## Deliverables\n\nYou can expect the following:\n\n` +
        (intake.recommended_services
          ? intake.recommended_services
              .split(/[.;]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s) => `- ${s}`)
              .join('\n')
          : '- [NEEDS INPUT: the services or deliverables to list]');
      if (!intake.recommended_services) gaps.push('No recommended services were provided.');
      break;
    case 'timeline':
      body = `## Timeline\n\nWe estimate this project can be completed within: ${
        intake.proposed_timeline || '[NEEDS INPUT: the proposed timeline]'
      }\n\nThis includes implementation, testing, and feedback iteration.`;
      if (!intake.proposed_timeline) gaps.push('No timeline was provided.');
      break;
    case 'pricing':
      body = `## Pricing\n\nThe estimated cost for this engagement is: ${
        intake.estimated_pricing || '[NEEDS INPUT: the agreed price or pricing structure]'
      }`;
      if (!intake.estimated_pricing) gaps.push('No pricing was provided — this section cannot state a figure.');
      break;
    case 'next_steps':
      // No sign-off: the complimentary close is rendered by lib/close.ts, not
      // written by the model. It used to be here, copied from the brief's
      // template, which quietly made the mocked path end differently from the
      // live one — every scenario passed while real proposals shipped with no
      // close at all.
      body =
        `## Next Steps\n\nIf you are happy with this proposal, we will send over an agreement ` +
        `to formalize the engagement and start the project. You can reach us with any questions.`;
      break;
  }

  return { section_key: meta.key, title: meta.title, body_md: body, assumptions, gaps };
}

export function mockDraftFor(intake: Intake): ClaudeOutcome<Draft> {
  const forced = forcedFailure<Draft>(intake);
  if (forced) return forced;

  return ok(
    { sections: SECTIONS.map((s) => sectionFor(s.key, intake)) },
    'req_mock_draft',
  );
}

export function mockRegenFor(params: {
  intake: Intake;
  sectionKey: string;
  instruction?: string;
}): ClaudeOutcome<z.infer<typeof RegenSchema>> {
  const forced = forcedFailure<z.infer<typeof RegenSchema>>(params.intake);
  if (forced) return forced;

  const base = sectionFor(params.sectionKey, params.intake);
  const rewritten = params.instruction
    ? { ...base, body_md: base.body_md + `\n\n_(regenerated: ${params.instruction})_` }
    : { ...base, body_md: base.body_md + `\n\n_(regenerated)_` };

  return ok({ section: rewritten }, 'req_mock_regen');
}
