import { describe, it, expect } from 'vitest';
import { parseMarkdownSubset, parseSectionBlocks } from '../lib/markdown-subset';

describe('parseMarkdownSubset', () => {
  it('parses headings, paragraphs, bullets and bold', () => {
    const blocks = parseMarkdownSubset(
      '## Introduction\n\nThank you, **Priya**.\n\n### Recommended Approach\n\n- Item one\n- Item **two**',
    );
    expect(blocks).toEqual([
      { type: 'h2', text: 'Introduction' },
      { type: 'p', runs: [{ text: 'Thank you, ', bold: false }, { text: 'Priya', bold: true }, { text: '.', bold: false }] },
      { type: 'h3', text: 'Recommended Approach' },
      { type: 'ul', items: [
        [{ text: 'Item one', bold: false }],
        [{ text: 'Item ', bold: false }, { text: 'two', bold: true }],
      ]},
    ]);
  });

  it('joins wrapped paragraph lines into one block', () => {
    const blocks = parseMarkdownSubset('Line one\nLine two\n\nLine three');
    expect(blocks).toEqual([
      { type: 'p', runs: [{ text: 'Line one Line two', bold: false }] },
      { type: 'p', runs: [{ text: 'Line three', bold: false }] },
    ]);
  });
});

describe('parseSectionBlocks', () => {
  it('prepends the section title when the body writes no heading of its own', () => {
    const blocks = parseSectionBlocks('Introduction', 'Thank you for your time.');
    expect(blocks[0]).toEqual({ type: 'h2', text: 'Introduction' });
    expect(blocks).toHaveLength(2);
  });

  it('does not duplicate a heading the model already wrote for this section', () => {
    const blocks = parseSectionBlocks('Introduction', '## Introduction\n\nThank you for your time.');
    expect(blocks.filter((b) => b.type === 'h2')).toHaveLength(1);
    expect(blocks[0]).toEqual({ type: 'h2', text: 'Introduction' });
  });

  it('matches case-insensitively, so a differently-cased heading still counts', () => {
    const blocks = parseSectionBlocks('Pricing', '## PRICING\n\n$42,000.');
    expect(blocks.filter((b) => b.type === 'h2')).toHaveLength(1);
  });

  it('does not treat an unrelated leading heading as this section’s title', () => {
    // A model that opened with an h3, or a heading for something else
    // entirely, still needs THIS section's name — the two are not the same
    // failure, but both are covered by the one rule: only a match counts.
    const blocks = parseSectionBlocks('Pricing', '### A note on payment terms\n\n$42,000.');
    expect(blocks[0]).toEqual({ type: 'h2', text: 'Pricing' });
    expect(blocks[1]).toEqual({ type: 'h3', text: 'A note on payment terms' });
  });

  it('reproduces the real bug: the Redmoor draft with no heading at all', () => {
    const blocks = parseSectionBlocks(
      'Introduction',
      'Thank you for the time on the call, Priya, and for sending over the operations note ahead of it.',
    );
    expect(blocks[0].type).toBe('h2');
    expect((blocks[0] as { text: string }).text).toBe('Introduction');
  });
});
