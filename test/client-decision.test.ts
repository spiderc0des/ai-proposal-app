import { describe, it, expect } from 'vitest';
import { ClientDecisionSchema } from '../lib/schemas';

/**
 * The one rule worth pinning down here: a decline must say why.
 *
 * It's expressed as a discriminated union rather than an optional field plus
 * a check in the route, so "declined without a reason" is not a shape this
 * type can hold at all. These tests exist to keep it that way — the route
 * has no fallback check to catch it if the schema ever loosens.
 */
describe('ClientDecisionSchema', () => {
  it('accepts an acceptance with a name', () => {
    const parsed = ClientDecisionSchema.parse({ decision: 'accept', name: 'Abdul Rahman' });
    expect(parsed).toEqual({ decision: 'accept', name: 'Abdul Rahman' });
  });

  it('rejects an acceptance with no name — the record of who acted is the point', () => {
    expect(() => ClientDecisionSchema.parse({ decision: 'accept', name: '' })).toThrow();
    expect(() => ClientDecisionSchema.parse({ decision: 'accept' })).toThrow();
  });

  it('accepts a decline that gives a reason', () => {
    const parsed = ClientDecisionSchema.parse({
      decision: 'decline',
      name: 'Abdul Rahman',
      reason: 'The timeline is too aggressive for our Q4.',
    });
    expect(parsed).toMatchObject({ decision: 'decline', reason: 'The timeline is too aggressive for our Q4.' });
  });

  it('rejects a decline with no reason at all', () => {
    expect(() => ClientDecisionSchema.parse({ decision: 'decline', name: 'Abdul Rahman' })).toThrow();
  });

  it('rejects a decline whose reason is only whitespace', () => {
    expect(() =>
      ClientDecisionSchema.parse({ decision: 'decline', name: 'Abdul Rahman', reason: '   ' }),
    ).toThrow();
  });

  it('rejects a decision that is neither accept nor decline', () => {
    expect(() => ClientDecisionSchema.parse({ decision: 'maybe', name: 'Abdul Rahman' })).toThrow();
  });

  it('trims the name and reason, so stored values are not padded', () => {
    const parsed = ClientDecisionSchema.parse({
      decision: 'decline',
      name: '  Abdul Rahman  ',
      reason: '  Too expensive  ',
    });
    expect(parsed).toMatchObject({ name: 'Abdul Rahman', reason: 'Too expensive' });
  });
});
