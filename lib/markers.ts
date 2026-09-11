/**
 * The [NEEDS INPUT: …] marker — what Claude writes where a fact it needed was
 * never given (lib/prompts/system.ts, rule 4). Its whole purpose is to be
 * resolved by a person before the client sees the proposal.
 *
 * Nothing enforced that. The marker gate went out with the rest of the
 * grounding check, and 14 markers reached clients as a result — including a
 * pricing section a client then ACCEPTED, agreeing to an engagement with no
 * price in it. So a proposal containing one can no longer be submitted,
 * approved or sent.
 *
 * Unlike the grounding check that was removed, this cannot misfire. That
 * check tried to recognise an INVENTED figure by pattern-matching money and
 * dates, and read "$14,000 milestone" as fourteen billion. This looks for a
 * literal string Claude was instructed to write: it is either there or not.
 *
 * No 'server-only': the review screen uses this too, to disable Submit and
 * point at the sections before a request is ever made.
 */

/** Matches one whole marker, e.g. "[NEEDS INPUT: the proposed start date]". */
export const MARKER_REGEX = /\[NEEDS INPUT[^\]]*\]/gi;

/**
 * The same test for SQL `ilike`. `[` has no special meaning in LIKE (only
 * `%` and `_` do), so this matches the literal opening. Case-insensitive, so
 * a marker hand-typed in lower case during an edit is still caught.
 */
export const MARKER_SQL_PATTERN = '%[NEEDS INPUT%';

export function hasMarker(text: string): boolean {
  return new RegExp(MARKER_REGEX.source, 'i').test(text);
}

export function countMarkers(text: string): number {
  return text.match(new RegExp(MARKER_REGEX.source, 'gi'))?.length ?? 0;
}

/** Plain-English refusal naming where the markers are. Server and client share it. */
export function markerRefusal(action: string, sections: { title: string; count: number }[]): string {
  const total = sections.reduce((n, s) => n + s.count, 0);
  const where = sections.map((s) => (s.count > 1 ? `${s.title} (${s.count})` : s.title)).join(', ');
  return (
    `Can't ${action} yet: ${total} [NEEDS INPUT] marker${total === 1 ? '' : 's'} still in ${where}. ` +
    'Each one is a fact the client would otherwise read as a blank — replace it with the real ' +
    'detail, or remove it, before this moves on.'
  );
}
