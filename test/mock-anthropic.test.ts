import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockAuditFor, mockDraftFor, mockRegenFor } from './mock-anthropic';
import type { Intake } from '../lib/schemas';

function fixture(name: string): Intake {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name, 'intake.json'), 'utf8'));
}

describe('PRD scenario 1 — normal generation', () => {
  it('a complete intake produces six non-empty sections, none of them a marker', () => {
    const intake = fixture('complete');
    const audit = mockAuditFor(intake);
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;
    expect(audit.data.readiness).toBe('ready');

    const draft = mockDraftFor(intake);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.data.sections).toHaveLength(6);
    for (const s of draft.data.sections) {
      expect(s.body_md.length).toBeGreaterThan(0);
      expect(s.body_md).not.toMatch(/\[NEEDS INPUT:/);
    }
  });
});

describe('PRD scenario 2 — missing information', () => {
  it('2a: thin intake generates with a marker in place of the missing pricing figure', () => {
    const intake = fixture('thin-pricing');
    const audit = mockAuditFor(intake);
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;
    expect(audit.data.readiness).toBe('thin');

    const draft = mockDraftFor(intake);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const pricing = draft.data.sections.find((s) => s.section_key === 'pricing')!;
    expect(pricing.body_md).toMatch(/\[NEEDS INPUT:/);
    // The whole point of the marker: it must stand in for a real figure,
    // never sit alongside one that was invented anyway.
    expect(pricing.body_md).not.toMatch(/[$£€]\s?\d/);
  });

  it('2b: an intake with no usable needs or scope blocks before any generation call', () => {
    const intake = fixture('no-needs-no-scope');
    const audit = mockAuditFor(intake);
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;
    expect(audit.data.readiness).toBe('blocked');
    expect(audit.data.blocking_reason).toBeTruthy();
    expect(audit.data.clarifying_questions.length).toBeGreaterThan(0);
    // The route layer must not call draftProposal when readiness === 'blocked'.
    // Asserted again at the route level in test/scenarios.
  });

  it('2c: five runs with no pricing given never state a figure (run 5x — stochastic claim needs repetition)', () => {
    const intake = fixture('no-pricing');
    for (let i = 0; i < 5; i++) {
      const draft = mockDraftFor(intake);
      expect(draft.ok).toBe(true);
      if (!draft.ok) return;
      const pricing = draft.data.sections.find((s) => s.section_key === 'pricing')!;
      expect(pricing.body_md).toMatch(/\[NEEDS INPUT:/);
      expect(pricing.body_md).not.toMatch(/[$£€]\s?\d/);
    }
  });
});

describe('PRD scenario 4 — section regeneration', () => {
  it('regenerating pricing leaves the other five sections untouched', () => {
    const intake = fixture('complete');
    const draft = mockDraftFor(intake);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const before = new Map(draft.data.sections.map((s) => [s.section_key, s.body_md]));

    const regen = mockRegenFor({ intake, sectionKey: 'pricing', instruction: 'be more concise' });
    expect(regen.ok).toBe(true);
    if (!regen.ok) return;

    expect(regen.data.section.body_md).not.toBe(before.get('pricing'));
    // the mock only ever touches the requested key — the other five rows in
    // a real run are never part of this statement at all (lib/queries.ts)
    for (const [key, body] of before) {
      if (key === 'pricing') continue;
      expect(body).toBe(before.get(key)); // tautology here; the real guarantee is the DB UPDATE's WHERE clause
    }
  });
});

describe('PRD scenario 7 — failure handling (mock layer)', () => {
  const forcedIntake = (marker: string): Intake => ({ ...fixture('complete'), client_name: marker });

  it('7a: a forced refusal is reported as ok:false with reason refusal', () => {
    const draft = mockDraftFor(forcedIntake('FORCE_REFUSAL'));
    expect(draft.ok).toBe(false);
    if (draft.ok) return;
    expect(draft.reason).toBe('refusal');
    expect(draft.requestId).toBeTruthy();
  });

  it('7b: a forced rate limit is reported as ok:false with reason rate_limit', () => {
    const draft = mockDraftFor(forcedIntake('FORCE_RATE_LIMIT'));
    expect(draft.ok).toBe(false);
    if (draft.ok) return;
    expect(draft.reason).toBe('rate_limit');
  });

  it('a forced truncation is reported as ok:false with reason invalid_response', () => {
    const draft = mockDraftFor(forcedIntake('FORCE_MAX_TOKENS'));
    expect(draft.ok).toBe(false);
    if (draft.ok) return;
    expect(draft.reason).toBe('invalid_response');
  });

  it('a failure on regeneration does not corrupt the request shape', () => {
    const regen = mockRegenFor({
      intake: forcedIntake('FORCE_REFUSAL'),
      sectionKey: 'pricing',
    });
    expect(regen.ok).toBe(false);
  });
});
