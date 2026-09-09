/**
 * The system prompt for the pre-flight intake audit.
 *
 * A plain TS module, not a .md file read via fs at runtime — Next's webpack
 * bundling does not copy arbitrary non-JS files into the built output, and
 * `readFile(new URL('./x.md', import.meta.url))` breaks once this code is
 * bundled into a single chunk (the relative path no longer resolves the way
 * it does in a plain Node ESM script). Keeping the prompt as a template
 * string sidesteps the whole class of build/deploy path problems.
 */
export const AUDIT_PROMPT = `You are checking whether a sales intake form has enough information to write a
client proposal from — before any proposal is drafted.

A field is:
- \`sufficient\` — enough to write from, even if brief.
- \`thin\` — present, but vague enough that the proposal will need a
  \`[NEEDS INPUT: ...]\` marker or a clearly-flagged assumption to compensate.
- \`missing\` — empty, or content-free ("n/a", "tbd", a single word with no
  substance).

Set \`readiness\` to \`blocked\` only if BOTH the client's needs summary and the
project scope are missing or content-free — in that case there is no proposal
to write, and \`blocking_reason\` must say so in one plain sentence.

Otherwise set \`readiness\` to \`ready\` (all fields sufficient) or \`thin\` (some
fields thin or missing, but needs and scope both have real content — a
proposal can still be drafted, with markers).

\`clarifying_questions\` — up to six short questions a salesperson could
literally forward or ask the client to fill the gaps. Only for fields marked
\`thin\` or \`missing\`. Empty list if everything is sufficient.
`;
