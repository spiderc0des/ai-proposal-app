import 'server-only';
import Anthropic, { toFile } from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { env, mockClaude } from './env';
import { AuditSchema, DraftSchema, RegenSchema, type Intake } from './schemas';
import { SECTIONS, SECTION_KEYS } from './sections';
import { mockAuditFor, mockDigestFor, mockDraftFor, mockRegenFor } from '../test/mock-anthropic';
import { SYSTEM_PROMPT } from './prompts/system';
import { AUDIT_PROMPT } from './prompts/audit';

/**
 * The only file in this project that constructs an Anthropic request.
 * (enforced by an eslint no-restricted-imports rule on '@anthropic-ai/sdk'
 * everywhere except here — see .eslintrc)
 */

const MODEL = 'claude-sonnet-5';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

/** What every call site returns, so route handlers log the same shape. */
export interface ClaudeResult<T> {
  ok: true;
  data: T;
  requestId: string | null;
  model: string;
  durationMs: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}
export interface ClaudeFailure {
  ok: false;
  reason: 'refusal' | 'rate_limit' | 'invalid_response' | 'api_error';
  message: string;
  requestId: string | null;
  category?: string | null;
  durationMs: number;
}
export type ClaudeOutcome<T> = ClaudeResult<T> | ClaudeFailure;

/**
 * One retrying wrapper around every call, so the four call sites below stay
 * about *what* to ask, not how to survive a 429 or a refusal.
 *
 * Retries only 429s (honouring retry-after) — never a 400, which means our
 * own request was malformed and retrying it changes nothing.
 */
async function withRetry<T>(
  attempt: () => Promise<{
    data: T;
    requestId: string | null;
    model: string;
    stopReason: string | null;
    stopDetails: { category?: string | null } | null;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }>,
  maxAttempts = 3,
): Promise<ClaudeOutcome<T>> {
  const startedAt = Date.now();

  for (let n = 1; n <= maxAttempts; n++) {
    try {
      const r = await attempt();

      // Check stop_reason BEFORE trusting content — a refusal is a 200 with
      // empty content, and reading it as success saves a blank section.
      if (r.stopReason === 'refusal') {
        return {
          ok: false,
          reason: 'refusal',
          message: 'Claude declined this request for a safety reason.',
          category: r.stopDetails?.category ?? null,
          requestId: r.requestId,
          durationMs: Date.now() - startedAt,
        };
      }
      if (r.stopReason === 'max_tokens') {
        return {
          ok: false,
          reason: 'invalid_response',
          message: 'The reply was cut off before it finished (max_tokens reached).',
          requestId: r.requestId,
          durationMs: Date.now() - startedAt,
        };
      }

      return {
        ok: true,
        data: r.data,
        requestId: r.requestId,
        model: r.model,
        durationMs: Date.now() - startedAt,
        cacheReadTokens: r.cacheReadTokens,
        cacheWriteTokens: r.cacheWriteTokens,
      };
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError && n < maxAttempts) {
        const retryAfter = Number(err.headers?.get('retry-after')) || 2 ** n;
        await new Promise((res) => setTimeout(res, retryAfter * 1000));
        continue;
      }
      if (err instanceof Anthropic.RateLimitError) {
        return {
          ok: false,
          reason: 'rate_limit',
          message: 'Claude is rate-limiting requests. Try again shortly.',
          requestId: err.requestID ?? null,
          durationMs: Date.now() - startedAt,
        };
      }
      if (err instanceof Anthropic.AuthenticationError) {
        return {
          ok: false,
          reason: 'api_error',
          message: 'The Anthropic API key is missing or invalid.',
          requestId: err.requestID ?? null,
          durationMs: Date.now() - startedAt,
        };
      }
      if (err instanceof Anthropic.APIError) {
        return {
          ok: false,
          reason: 'api_error',
          message: `Claude API error (${err.status}): ${err.message}`,
          requestId: err.requestID ?? null,
          durationMs: Date.now() - startedAt,
        };
      }
      throw err; // a bug in our own code — let it surface, don't swallow it
    }
  }
  // unreachable, but TypeScript wants every path to return
  return {
    ok: false,
    reason: 'rate_limit',
    message: 'Exhausted retries.',
    requestId: null,
    durationMs: Date.now() - startedAt,
  };
}

function intakeAsText(intake: Intake): string {
  return Object.entries(intake)
    .map(([k, v]) => `${k}: ${v || '(not given)'}`)
    .join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════════
   5.1 · Pre-flight audit — effort low, structured output, no documents.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function auditIntake(intake: Intake) {
  if (mockClaude) return mockAuditFor(intake);

  return withRetry(async () => {
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: zodOutputFormat(AuditSchema) },
      system: [{ type: 'text', text: AUDIT_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: intakeAsText(intake) }],
    });
    if (!res.parsed_output) throw new Error('structured output did not parse');
    return {
      data: res.parsed_output,
      requestId: res._request_id ?? null,
      model: res.model,
      stopReason: res.stop_reason,
      stopDetails: res.stop_details,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   5.2 · Material digest — citations ON, structured output OFF.
   These two features return a 400 if combined in one call, so uploaded
   material is read here, in prose, and handed to the draft call as TEXT
   (never as the document itself) in §5.3/5.4.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function uploadMaterial(buffer: Buffer, filename: string, mime: string) {
  if (mockClaude) return { id: `mock_file_${filename}`, size_bytes: buffer.length };
  const uploaded = await client.files.upload({
    file: await toFile(buffer, filename, { type: mime }),
  });
  return { id: uploaded.id, size_bytes: uploaded.size_bytes };
}

export async function digestMaterial(fileId: string, intakeContext: string) {
  if (mockClaude) return mockDigestFor(fileId);

  return withRetry(async () => {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system:
        'Extract only the facts in this document that bear on the proposal ' +
        'described below. For each fact, quote the exact sentence it comes ' +
        'from. Do not summarise the whole document — only what is relevant. ' +
        'If nothing in the document is relevant, say so plainly.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `The proposal is for:\n${intakeContext}` },
            {
              type: 'document',
              source: { type: 'file', file_id: fileId },
              citations: { enabled: true },
            },
          ],
        },
      ],
    });

    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n\n');
    const citations = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .flatMap((b) => b.citations ?? []);

    return {
      data: { digest_md: text, citations },
      requestId: res._request_id ?? null,
      model: res.model,
      stopReason: res.stop_reason,
      stopDetails: null,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   5.3 · Full draft — one call, all six sections, streamed.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function draftProposal(intake: Intake, digests: string[]) {
  if (mockClaude) return mockDraftFor(intake);

  const materialBlock = digests.length
    ? `\n\nSupporting material provided by the client (already extracted, cite it where relevant):\n${digests.join('\n---\n')}`
    : '';

  return withRetry(async () => {
    // beta namespace + fallbacks: on a policy decline, Anthropic retries the
    // same request on a substitute model server-side before we ever see a
    // refusal. Client-facing generation is exactly where that is worth it.
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: zodOutputFormat(DraftSchema) },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: intakeAsText(intake) + materialBlock }],
    });
    const res = await stream.finalMessage();

    if (!res.parsed_output || res.parsed_output.sections.length !== SECTION_KEYS.length) {
      throw new Error(
        `expected ${SECTION_KEYS.length} sections, got ${res.parsed_output?.sections.length ?? 0}`,
      );
    }
    const gotKeys = new Set(res.parsed_output.sections.map((s) => s.section_key));
    for (const k of SECTION_KEYS) {
      if (!gotKeys.has(k)) throw new Error(`missing section: ${k}`);
    }

    return {
      data: res.parsed_output,
      // finalMessage() does not carry _request_id (unlike .parse()/.create());
      // the stream object itself exposes it via the request-id header.
      requestId: stream.request_id ?? null,
      model: res.model,
      stopReason: res.stop_reason,
      stopDetails: res.stop_details,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   5.4 · Section regeneration — the other five sections go in as read-only
   context, so the rewrite still fits its neighbours. Only this one section's
   row is ever written by the caller.
   ═══════════════════════════════════════════════════════════════════════════ */
export async function regenerateSection(params: {
  intake: Intake;
  digests: string[];
  sectionKey: string;
  currentBody: string;
  siblings: { section_key: string; title: string; body_md: string }[];
  instruction?: string;
}) {
  if (mockClaude) return mockRegenFor(params);

  const meta = SECTIONS.find((s) => s.key === params.sectionKey);
  const materialBlock = params.digests.length
    ? `\n\nSupporting material:\n${params.digests.join('\n---\n')}`
    : '';
  const siblingBlock = params.siblings
    .map((s) => `### ${s.title} (DO NOT REWRITE — shown for context only)\n${s.body_md}`)
    .join('\n\n');

  return withRetry(async () => {
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: zodOutputFormat(RegenSchema) },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content:
            `${intakeAsText(params.intake)}${materialBlock}\n\n` +
            `The rest of the proposal, already finalised — keep this section consistent with it:\n${siblingBlock}\n\n` +
            `Rewrite only the "${meta?.title ?? params.sectionKey}" section (key: ${params.sectionKey}).\n` +
            `Its current text:\n${params.currentBody}\n\n` +
            (params.instruction
              ? `The salesperson's instruction for this rewrite: ${params.instruction}`
              : 'No specific instruction — improve clarity and specificity.'),
        },
      ],
    });
    if (!res.parsed_output) throw new Error('structured output did not parse');

    return {
      data: res.parsed_output,
      requestId: res._request_id ?? null,
      model: res.model,
      stopReason: res.stop_reason,
      stopDetails: res.stop_details,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
    };
  });
}
