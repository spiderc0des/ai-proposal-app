/**
 * A parser for exactly the markdown subset the system prompt (lib/prompts/
 * system.ts, rule 6) allows Claude to write: ##/### headings, paragraphs,
 * `-` bullet lists, and **bold**. Nothing else — no tables, no HTML, no
 * images, no nested emphasis.
 *
 * Deliberately not a general markdown library. Both the PDF renderer
 * (lib/pdf.tsx) and the on-screen renderer (app/MarkdownBody.tsx) only
 * understand this exact subset — anything outside it (a table, raw HTML) is
 * silently dropped rather than rendered wrong, so the prompt's promise to
 * write only this subset is what keeps the two in sync.
 */

export type Block =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'p'; runs: Run[] }
  | { type: 'ul'; items: Run[][] };

export type Run = { text: string; bold: boolean };

function parseInline(line: string): Run[] {
  const runs: Run[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) runs.push({ text: line.slice(last, m.index), bold: false });
    runs.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) runs.push({ text: line.slice(last), bold: false });
  return runs.length ? runs : [{ text: line, bold: false }];
}

/**
 * Same parse, plus a guaranteed heading — the fix for a real bug: whether a
 * section showed its name on the client page and in the PDF depended
 * entirely on whether Claude happened to open that section's body with a
 * matching `## Heading` line. The system prompt (rule 6) allows headings,
 * it never requires one, so it was inconsistent by construction — one
 * proposal had "Introduction" over every section, the next had none at all,
 * with nothing about either being wrong on its own terms.
 *
 * The section's `title` (lib/sections.ts) is the reliable value — it always
 * exists and is never something Claude writes — so it is what gets shown,
 * not whatever the model did or didn't put at the top of the body. A
 * leading heading that already names this section (case-insensitively; a
 * model that wrote "## Pricing Overview" for the pricing section still
 * counts) is treated as satisfying it rather than duplicated — some drafts
 * already have one, and this must not print it twice.
 */
export function parseSectionBlocks(title: string, md: string): Block[] {
  const blocks = parseMarkdownSubset(md);
  const first = blocks[0];
  const alreadyTitled =
    first &&
    (first.type === 'h2' || first.type === 'h3') &&
    normaliseHeading(first.text) === normaliseHeading(title);

  if (alreadyTitled) return blocks;
  return [{ type: 'h2', text: title }, ...blocks];
}

function normaliseHeading(text: string): string {
  return text.trim().toLowerCase();
}

export function parseMarkdownSubset(md: string): Block[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Run[][] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'p', runs: parseInline(para.join(' ').trim()) });
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push({ type: 'ul', items: list });
      list = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h2 = line.match(/^##\s+(.*)/);
    const h3 = line.match(/^###\s+(.*)/);
    const li = line.match(/^[-*]\s+(.*)/);

    if (h2) {
      flushPara();
      flushList();
      blocks.push({ type: 'h2', text: h2[1].trim() });
    } else if (h3) {
      flushPara();
      flushList();
      blocks.push({ type: 'h3', text: h3[1].trim() });
    } else if (li) {
      flushPara();
      list.push(parseInline(li[1].trim()));
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}
