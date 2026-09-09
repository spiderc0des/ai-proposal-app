import 'server-only';
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer';
import { parseMarkdownSubset, type Block, type Run } from './markdown-subset';
import type { Intake } from './schemas';
import type { SectionRow } from './db-schemas';

/**
 * The client-facing PDF. Pure JS rendering (@react-pdf/renderer) — no
 * headless Chromium, so no 50 MB binary and no serverless cold-start cliff.
 *
 * Uses the standard PDF fonts (Helvetica / Helvetica-Bold) by NAME rather
 * than Font.register()-ing an external face. This needs no network fetch at
 * render time and sidesteps a real react-pdf gotcha: asking for
 * `fontWeight: 'bold'` on a family that was never registered with a bold
 * source renders as regular weight, not bold — silently. Naming the bold
 * standard font directly has no such ambiguity.
 */

const styles = StyleSheet.create({
  page: { padding: 56, fontFamily: 'Helvetica', fontSize: 10.5, lineHeight: 1.45, color: '#1a2733' },
  brand: { fontSize: 9, color: '#6b7c8d', marginBottom: 4, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
  title: { fontSize: 22, fontFamily: 'Helvetica-Bold', color: '#12202c', marginBottom: 4 },
  meta: { fontSize: 10, color: '#46586b', marginBottom: 24 },
  hr: { borderBottomWidth: 1, borderBottomColor: '#d5dee6', marginBottom: 20 },
  h2: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#12202c', marginTop: 18, marginBottom: 8 },
  h3: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', color: '#1c4b7a', marginTop: 12, marginBottom: 4 },
  p: { marginBottom: 8 },
  li: { flexDirection: 'row', marginBottom: 4, paddingLeft: 4 },
  bullet: { width: 12 },
  liText: { flex: 1 },
  bold: { fontFamily: 'Helvetica-Bold' },
  footer: {
    position: 'absolute', bottom: 32, left: 56, right: 56,
    fontSize: 8, color: '#9aa8b5', textAlign: 'center',
    borderTopWidth: 1, borderTopColor: '#e5ebf1', paddingTop: 8,
  },
});

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => (
        <Text key={i} style={r.bold ? styles.bold : undefined}>
          {r.text}
        </Text>
      ))}
    </>
  );
}

function RenderBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'h2') return <Text key={i} style={styles.h2}>{b.text}</Text>;
        if (b.type === 'h3') return <Text key={i} style={styles.h3}>{b.text}</Text>;
        if (b.type === 'p') return <Text key={i} style={styles.p}><Runs runs={b.runs} /></Text>;
        return (
          <View key={i}>
            {b.items.map((runs, j) => (
              <View key={j} style={styles.li}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.liText}><Runs runs={runs} /></Text>
              </View>
            ))}
          </View>
        );
      })}
    </>
  );
}

export function ProposalDocument({
  intake,
  sections,
}: {
  intake: Pick<Intake, 'client_name' | 'company_name' | 'salesperson_name' | 'date_of_call'>;
  sections: Pick<SectionRow, 'section_key' | 'title' | 'body_md'>[];
}) {
  return (
    <Document title={`Proposal for ${intake.client_name}`} author="Koya Talent">
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>KOYA TALENT</Text>
        <Text style={styles.title}>Proposal for {intake.client_name}</Text>
        <Text style={styles.meta}>
          Prepared by {intake.salesperson_name}
          {intake.date_of_call ? `  ·  ${intake.date_of_call}` : ''}
        </Text>
        <View style={styles.hr} />

        {sections.map((s) => (
          <RenderBlocks key={s.section_key} blocks={parseMarkdownSubset(s.body_md)} />
        ))}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}

export async function renderProposalPdf(
  intake: Pick<Intake, 'client_name' | 'company_name' | 'salesperson_name' | 'date_of_call'>,
  sections: Pick<SectionRow, 'section_key' | 'title' | 'body_md'>[],
): Promise<Buffer> {
  return renderToBuffer(<ProposalDocument intake={intake} sections={sections} />);
}
