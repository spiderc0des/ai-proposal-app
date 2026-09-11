import { describe, it, expect } from 'vitest';
import { hasMarker, countMarkers, markerRefusal, MARKER_REGEX } from '../lib/markers';

/**
 * The marker gate blocks a proposal from being submitted, approved or sent.
 * A false positive would stall a finished proposal; a false negative would
 * let a blank reach a client — which already happened 14 times before this
 * gate existed. Both directions are pinned here.
 */
describe('hasMarker', () => {
  it('finds the marker Claude writes', () => {
    expect(hasMarker('Start on [NEEDS INPUT: the proposed start date].')).toBe(true);
  });

  it('is case-insensitive, so a hand-typed one is caught too', () => {
    expect(hasMarker('[needs input: budget]')).toBe(true);
  });

  it('finds one with no colon or detail', () => {
    expect(hasMarker('Price: [NEEDS INPUT]')).toBe(true);
  });

  it('does not fire on prose that merely mentions input', () => {
    expect(hasMarker('We need input from your dispatch team during discovery.')).toBe(false);
    expect(hasMarker('Needs input from the client (see appendix).')).toBe(false);
  });

  it('is clean on a finished section', () => {
    expect(hasMarker('**$42,000 fixed fee**, exclusive of any applicable tax.')).toBe(false);
  });
});

describe('countMarkers', () => {
  it('counts every marker, not just the first', () => {
    expect(countMarkers('[NEEDS INPUT: a] then [NEEDS INPUT: b] and [NEEDS INPUT: c]')).toBe(3);
  });

  it('is zero on clean text', () => {
    expect(countMarkers('Nothing missing here.')).toBe(0);
  });

  it('does not carry state between calls', () => {
    // A shared /g regex remembers lastIndex between .test() calls and then
    // silently misses matches. Every helper builds a fresh one; this pins it.
    for (let i = 0; i < 5; i++) expect(countMarkers('[NEEDS INPUT: x]')).toBe(1);
    for (let i = 0; i < 5; i++) expect(hasMarker('[NEEDS INPUT: x]')).toBe(true);
    expect(MARKER_REGEX.lastIndex).toBe(0);
  });
});

describe('markerRefusal', () => {
  it('names every section and the total', () => {
    const msg = markerRefusal('submit this for approval', [
      { title: 'Pricing', count: 1 },
      { title: 'Timeline', count: 2 },
    ]);
    expect(msg).toContain('3 [NEEDS INPUT] markers');
    expect(msg).toContain('Pricing');
    expect(msg).toContain('Timeline (2)');
    expect(msg).toContain('submit this for approval');
  });

  it('uses the singular for one', () => {
    expect(markerRefusal('send', [{ title: 'Pricing', count: 1 }])).toContain('1 [NEEDS INPUT] marker still');
  });
});
