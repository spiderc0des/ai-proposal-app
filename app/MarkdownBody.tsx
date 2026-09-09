import { parseMarkdownSubset } from '@/lib/markdown-subset';

/**
 * Renders the exact markdown subset the system prompt allows Claude to
 * write (lib/prompts/system.md rule 6) — no raw markdown syntax visible,
 * matching what the client sees on the share page and what the PDF
 * renders. Shared between the client-facing page and the salesperson's
 * own read-only section view, so both render the same content identically.
 */
export default function MarkdownBody({ body }: { body: string }) {
  const blocks = parseMarkdownSubset(body);
  return (
    <div className="markdown-body">
      {blocks.map((b, i) => {
        if (b.type === 'h2') return <h2 key={i}>{b.text}</h2>;
        if (b.type === 'h3') return <h3 key={i}>{b.text}</h3>;
        if (b.type === 'p')
          return (
            <p key={i}>
              {b.runs.map((r, j) => (r.bold ? <b key={j}>{r.text}</b> : <span key={j}>{r.text}</span>))}
            </p>
          );
        return (
          <ul key={i}>
            {b.items.map((runs, j) => (
              <li key={j}>{runs.map((r, k) => (r.bold ? <b key={k}>{r.text}</b> : <span key={k}>{r.text}</span>))}</li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
