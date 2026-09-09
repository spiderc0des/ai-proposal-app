import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthError } from './auth';
import { ConflictError, VersionConflictError } from './queries';
import { logEvent } from './queries';

/**
 * One place that turns a thrown error into an HTTP response, so every route
 * reports failures the same, debuggable way. The rule applies here too:
 * whoever calls this has already logged an `events` row for the failed
 * step before this function runs.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: 'Invalid request.', issues: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      { status: 400 },
    );
  }
  if (err instanceof VersionConflictError) {
    return NextResponse.json({ error: err.message, code: 'VERSION_CONFLICT' }, { status: 409 });
  }
  if (err instanceof ConflictError) {
    return NextResponse.json({ error: err.message, code: 'CONFLICT' }, { status: 409 });
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  console.error(err);
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * Log a step, run it, log the outcome — every route follows this shape.
 *
 * @param successDetail  optional — computes the `detail` to store on the
 *   SUCCESS row from the result, e.g. a before/after diff. Without it, a
 *   successful step logs no detail, same as before this parameter existed —
 *   every other caller of this function is unaffected. This is one row per
 *   attempt, not two: the alternative (a second logEvent call after this
 *   one returns) would put "what happened" and "what changed" in different
 *   rows of the same action, which is the thing this parameter avoids.
 */
export async function withEventLog<T>(
  proposalId: string | null,
  actor: string,
  step: string,
  fn: () => Promise<T>,
  successDetail?: (result: T) => Record<string, unknown>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    await logEvent({
      proposalId,
      actor,
      step,
      ok: true,
      durationMs: Date.now() - startedAt,
      detail: successDetail ? successDetail(result) : undefined,
    });
    return result;
  } catch (err) {
    // The failure row is written BEFORE this function re-throws, not in a
    // catch block three layers up that might itself fail to reach the
    // database.
    await logEvent({
      proposalId,
      actor,
      step,
      ok: false,
      durationMs: Date.now() - startedAt,
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
