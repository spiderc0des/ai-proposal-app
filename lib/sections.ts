/**
 * The six sections of a proposal, from the brief's proposal-template.md.
 *
 * `modelAuthored` is the risk register: it marks the sections where Claude has
 * to write something the intake does not contain, which is where fabrication
 * risk lives and where review attention should go.
 */
export const SECTIONS = [
  {
    key: 'introduction',
    order: 1,
    title: 'Introduction',
    usesIntake: ['client_needs_summary', 'goals_and_objectives', 'company_name'],
    modelAuthored: false,
    note: 'Framing only. Restates the client’s own words back to them.',
  },
  {
    key: 'proposed_solution',
    order: 2,
    title: 'Proposed Solution',
    usesIntake: ['project_scope'],
    modelAuthored: true,
    note: 'The template’s "recommended approach" has no intake field. Genuinely written by Claude.',
  },
  {
    key: 'deliverables',
    order: 3,
    title: 'Deliverables',
    usesIntake: ['recommended_services'],
    modelAuthored: true,
    note: 'Turns named services into concrete deliverables. Partly generative.',
  },
  {
    key: 'timeline',
    order: 4,
    title: 'Timeline',
    usesIntake: ['proposed_timeline'],
    modelAuthored: false,
    note: 'Structuring only. Never invents a date.',
  },
  {
    key: 'pricing',
    order: 5,
    title: 'Pricing',
    usesIntake: ['estimated_pricing'],
    modelAuthored: false,
    note: 'Presents the salesperson’s figure verbatim, or emits a marker. Never computes a price.',
  },
  {
    key: 'next_steps',
    order: 6,
    title: 'Next Steps',
    usesIntake: [],
    modelAuthored: false,
    note: 'Boilerplate from the template.',
  },
] as const;

export type SectionKey = (typeof SECTIONS)[number]['key'];

export const SECTION_KEYS = SECTIONS.map((s) => s.key) as [SectionKey, ...SectionKey[]];

export function sectionMeta(key: string) {
  const found = SECTIONS.find((s) => s.key === key);
  if (!found) throw new Error(`Unknown section key: ${key}`);
  return found;
}
