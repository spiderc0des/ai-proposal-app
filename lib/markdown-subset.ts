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
