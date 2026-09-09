import 'server-only';
import nodemailer from 'nodemailer';
import { env, emailEnabled } from './env';

/**
 * Three jobs, one provider:
 *   1. client delivery   (this file, sendClientProposal)
 *   2. approver notification (this file, sendApprovalRequest)
 *   3. Supabase Auth magic links (configured in the Supabase dashboard as
 *      custom SMTP — not code)
 *
 * Gmail SMTP, not an email API provider (Resend was the original choice).
 * Resend's unverified-sandbox mode only delivers to the account owner's own address
 * unless a domain is verified with DNS records; a real client's inbox is
 * exactly what fails without one ("domain is not verified", 403
 * validation_error). Gmail SMTP sends from an address you already own with
 * no domain-verification step, at the cost of the "from" address always
 * being your literal Gmail address rather than something on a branded
 * domain — a fine trade for getting this working today.
 *
 * Client delivery is OPTIONAL: the brief allows "exported or sent", and the
 * tokenised share page + PDF already satisfies "exported". Without
 * GMAIL_USER / GMAIL_APP_PASSWORD configured, sending is skipped and
 * recorded as a real events row rather than silently doing nothing or
 * throwing.
 */

const transport = emailEnabled
  ? nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD },
    })
  : null;

// Gmail rejects a "from" address it does not own — this must be the
// authenticated account, with only the display name customisable.
const FROM = emailEnabled ? `"${env.MAIL_FROM_NAME}" <${env.GMAIL_USER}>` : null;

export type EmailOutcome =
  | { sent: true; providerId: string | null }
  | { sent: false; skipped: true; reason: string }
  | { sent: false; skipped: false; reason: string };

async function send(to: string, subject: string, text: string): Promise<EmailOutcome> {
  if (!transport || !FROM) {
    return {
      sent: false,
      skipped: true,
      reason: 'No email provider configured (GMAIL_USER / GMAIL_APP_PASSWORD unset).',
    };
  }
  try {
    const info = await transport.sendMail({ from: FROM, to, subject, text });
    return { sent: true, providerId: info.messageId ?? null };
  } catch (err) {
    return { sent: false, skipped: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendClientProposal(params: {
  clientName: string;
  clientEmail: string;
  companyName: string;
  salespersonName: string;
  proposalLink: string;
}): Promise<EmailOutcome> {
  // Body from the brief's assets/client-email-template.md, unchanged in
  // structure — only the placeholders are filled.
  return send(
    params.clientEmail,
    `Proposal for ${params.companyName}`,
    `Hi ${params.clientName},\n\n` +
      `Thanks again for taking the time to speak with us. Based on our conversation, ` +
      `we have put together a customized proposal for your review.\n\n` +
      `You can view the proposal here: ${params.proposalLink}\n\n` +
      `This document outlines the project scope, timeline, pricing details, and recommended approach.\n\n` +
      `If you have any questions or would like to make adjustments, feel free to reach out. ` +
      `We are happy to iterate with you.\n\n` +
      `Looking forward to hearing your thoughts.\n\n` +
      `Best regards,\n\n${params.salespersonName}\n\nKoya Talent`,
  );
}

export async function sendApprovalRequest(params: {
  approverEmail: string;
  authorName: string;
  companyName: string;
  reviewLink: string;
}): Promise<EmailOutcome> {
  return send(
    params.approverEmail,
    `Proposal ready for review — ${params.companyName}`,
    `${params.authorName} submitted a proposal for ${params.companyName} and it needs your review ` +
      `before it can go to the client.\n\n` +
      `Review it here: ${params.reviewLink}\n\n` +
      `(This link requires you to be signed in as an approver.)`,
  );
}
