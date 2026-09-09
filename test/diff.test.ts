import { describe, it, expect } from 'vitest';
import { diffWords } from '../lib/diff';

function reconstruct(parts: ReturnType<typeof diffWords>, side: 'before' | 'after'): string {
  return parts
    .filter((p) => (side === 'before' ? p.type !== 'add' : p.type !== 'remove'))
    .map((p) => p.text)
    .join('');
}

describe('diffWords', () => {
  it('reports no changes for identical text', () => {
    const parts = diffWords('The fee is $42,000.', 'The fee is $42,000.');
    expect(parts.every((p) => p.type === 'equal')).toBe(true);
  });

  it('finds a single-word change inside a sentence, not the whole sentence', () => {
    const parts = diffWords('The fee is $42,000 fixed.', 'The fee is $45,000 fixed.');
    const removed = parts.filter((p) => p.type === 'remove').map((p) => p.text);
    const added = parts.filter((p) => p.type === 'add').map((p) => p.text);
    expect(removed).toEqual(['$42,000']);
    expect(added).toEqual(['$45,000']);
    // everything else should be marked equal, not swept up in the change
    expect(parts.some((p) => p.type === 'equal' && p.text.includes('The fee is'))).toBe(true);
  });

  it('reconstructs both original texts exactly from the parts', () => {
    const before = 'We propose an 8 week engagement starting in September.';
    const after = 'We propose a 10 week engagement starting in October.';
    const parts = diffWords(before, after);
    expect(reconstruct(parts, 'before')).toBe(before);
    expect(reconstruct(parts, 'after')).toBe(after);
  });

  it('handles a pure addition', () => {
    const parts = diffWords('Short text.', 'Short text. With more added.');
    expect(parts.some((p) => p.type === 'add' && p.text.includes('added'))).toBe(true);
    expect(parts.filter((p) => p.type === 'remove')).toHaveLength(0);
  });

  it('handles a pure removal', () => {
    const parts = diffWords('Short text. With more removed.', 'Short text.');
    expect(parts.some((p) => p.type === 'remove' && p.text.includes('removed'))).toBe(true);
    expect(parts.filter((p) => p.type === 'add')).toHaveLength(0);
  });

  it('handles a total rewrite (nothing in common)', () => {
    const parts = diffWords('Alpha beta gamma.', 'Delta epsilon zeta.');
    expect(parts.some((p) => p.type === 'remove')).toBe(true);
    expect(parts.some((p) => p.type === 'add')).toBe(true);
  });

  it('falls back to a whole-block diff for very large inputs rather than a slow token diff', () => {
    const before = 'word '.repeat(5000);
    const after = 'word '.repeat(5000) + 'extra';
    const parts = diffWords(before, after);
    expect(parts).toEqual([
      { type: 'remove', text: before },
      { type: 'add', text: after },
    ]);
  });
});
