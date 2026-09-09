import { describe, it, expect } from 'vitest';
import { parseMarkdownSubset } from '../lib/markdown-subset';

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
