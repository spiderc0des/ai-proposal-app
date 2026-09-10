import { PROPOSAL_CLOSE } from '@/lib/close';

/**
 * The HTML rendering of the fixed proposal close. Shared by the
 * client-facing share page and the salesperson's review view so both show
 * the same ending the PDF does — see lib/close.ts for why this isn't part
 * of what Claude writes.
 */
export default function ProposalClose({ salespersonName }: { salespersonName: string }) {
  return (
    <div className="mt-8 text-sm leading-relaxed">
      <p className="mb-4">{PROPOSAL_CLOSE.farewell}</p>
      <p>{PROPOSAL_CLOSE.signoff}</p>
      <p className="mt-3 font-semibold">{salespersonName}</p>
      <p className="text-[var(--ink-soft)]">{PROPOSAL_CLOSE.company}</p>
    </div>
  );
}
