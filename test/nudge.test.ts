import { describe, it, expect } from 'vitest';
import { isAuthorisedCronRequest } from '../lib/cron-auth';
import { daysUntilNudge, NUDGE_AFTER_DAYS } from '../lib/permissions';

const SECRET = 'a-secret-long-enough-to-pass';

/**
 * The scheduled follow-up has no session behind it — the bearer secret is
 * the entire door. These pin the two ways that door could be left ajar:
 * accepting a request when no secret is configured, and accepting a wrong
 * one. Everything else in the route needs a database and real SMTP, so it
 * is verified live rather than here.
 */
describe('isAuthorisedCronRequest', () => {
  it('accepts the exact secret as a bearer token', () => {
    expect(isAuthorisedCronRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it('refuses when no secret is configured — an open mailer is worse than a broken one', () => {
    expect(isAuthorisedCronRequest(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(isAuthorisedCronRequest(`Bearer `, '')).toBe(false);
  });

  it('refuses a missing, empty or malformed header', () => {
    expect(isAuthorisedCronRequest(null, SECRET)).toBe(false);
    expect(isAuthorisedCronRequest('', SECRET)).toBe(false);
    expect(isAuthorisedCronRequest(SECRET, SECRET)).toBe(false);          // no "Bearer "
    expect(isAuthorisedCronRequest(`bearer ${SECRET}`, SECRET)).toBe(false); // case matters
  });

  it('refuses a wrong secret, including a correct prefix of the right one', () => {
    expect(isAuthorisedCronRequest('Bearer nope', SECRET)).toBe(false);
    expect(isAuthorisedCronRequest(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(isAuthorisedCronRequest(`Bearer ${SECRET}x`, SECRET)).toBe(false);
  });

  it('does not throw on a length mismatch — timingSafeEqual would', () => {
    expect(() => isAuthorisedCronRequest('Bearer x', SECRET)).not.toThrow();
  });
});

/**
 * What the sent panel promises the salesperson. It has to agree with the
 * threshold the job actually uses, or the UI is quietly lying.
 */
describe('daysUntilNudge', () => {
  const now = new Date('2026-09-10T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  it('counts down from the full window on a proposal just sent', () => {
    expect(daysUntilNudge(now, now)).toBe(NUDGE_AFTER_DAYS);
  });

  it('reaches zero once the threshold has passed', () => {
    expect(daysUntilNudge(daysAgo(NUDGE_AFTER_DAYS), now)).toBe(0);
    expect(daysUntilNudge(daysAgo(30), now)).toBe(0);
  });

  it('never goes negative — an overdue proposal reads as due, not as "-28 days"', () => {
    expect(daysUntilNudge(daysAgo(365), now)).toBeGreaterThanOrEqual(0);
  });

  it('rounds a partial day up, so it never promises sooner than it delivers', () => {
    expect(daysUntilNudge(daysAgo(1.5), now)).toBe(1);
  });
});
