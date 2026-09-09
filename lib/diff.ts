/**
 * A word-level diff between two versions of a section's text — used to show
 * what an edit or regeneration actually changed, in the event log.
 *
 * Word-level, not line-level: proposal sections are continuous prose, not
 * code. A line-diff would report "this entire paragraph changed" for a
 * one-word correction, which tells a reviewer nothing about what actually
 * happened. This is a standard LCS (longest common subsequence) diff,
 * tokenised on whitespace so the original spacing reconstructs exactly.
 */

export type DiffPart = { type: 'equal' | 'add' | 'remove'; text: string };

/** Above this many tokens, the O(n·m) LCS table gets too large to be worth it. */
const MAX_TOKENS = 4000;

function tokenize(text: string): string[] {
  return text.match(/\S+|\s+/g) ?? [];
}

export function diffWords(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);

  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    // Too large for a token-level diff to be worth the O(n·m) cost — fall
    // back to reporting the whole thing changed, which is still true.
    return [
      { type: 'remove', text: before },
      { type: 'add', text: after },
    ];
  }

  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('remove', a[i]);
      i++;
    } else {
      push('add', b[j]);
      j++;
    }
  }
  while (i < n) {
    push('remove', a[i]);
    i++;
  }
  while (j < m) {
    push('add', b[j]);
    j++;
  }
  return parts;
}
