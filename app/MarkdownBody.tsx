import { parseMarkdownSubset, parseSectionBlocks, type Run } from '@/lib/markdown-subset';
import { MARKER_REGEX } from '@/lib/markers';

/**
 * Renders the exact markdown subset the system prompt allows Claude to
 * write (lib/prompts/system.md rule 6) — no raw markdown syntax visible,
 * matching what the client sees on the share page and what the PDF
 * renders. Shared between the client-facing page and the salesperson's
 * own read-only section view, so both render the same content identically.
 *
 * `title`, when given, guarantees a heading via parseSectionBlocks (see
 * lib/markdown-subset.ts) instead of trusting the body to have written its
 * own — some drafts do, some don't, and the two must not look different.
 * Left unset on the review page, where the section title is already shown
 * separately above this component (ProposalEditor's SectionCard) — passing
 * it there would print the name twice.
 */
export default function MarkdownBody({
  body,
  title,
  highlightMarkers = false,
}: {
  body: string;
  title?: string;
  /** Review screen only: make each [NEEDS INPUT] marker impossible to skim
   *  past, since it now blocks the proposal from moving on. Never set on the
   *  client's page — they should never see a marker at all. */
  highlightMarkers?: boolean;
}) {
  const blocks = title ? parseSectionBlocks(title, body) : parseMarkdownSubset(body);
  const renderRuns = (runs: Run[]) =>
    runs.map((r, j) => {
      const content = highlightMarkers ? markMarkers(r.text) : r.text;
      return r.bold ? <b key={j}>{content}</b> : <span key={j}>{content}</span>;
    });
  return (
    <div className="markdown-body">
      {blocks.map((b, i) => {
        if (b.type === 'h2') return <h2 key={i}>{b.text}</h2>;
        if (b.type === 'h3') return <h3 key={i}>{b.text}</h3>;
        if (b.type === 'p') return <p key={i}>{renderRuns(b.runs)}</p>;
        return (
          <ul key={i}>
            {b.items.map((runs, j) => (
              <li key={j}>{renderRuns(runs)}</li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

/** Splits text around each marker and wraps the markers in a <mark>. */
function markMarkers(text: string): React.ReactNode {
  const parts = text.split(new RegExp(`(${MARKER_REGEX.source})`, 'gi'));
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        className="rounded px-1 font-medium"
        style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
