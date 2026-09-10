import 'server-only';
import nodemailer from 'nodemailer';
import { env, emailEnabled } from './env';
import { emailShell, p as para, button, quote, escapeHtml } from './email-layout';

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

/**
 * The name recorded against a delivery, so a stored provider_id can be
 * interpreted later. Exported rather than written as a literal at the call
 * site: the last time this changed (Resend to Gmail), a hard-coded value
 * was missed and the deliveries table lied about every row for two days.
 */
export const EMAIL_PROVIDER = 'gmail';

/** What to record when nothing was sent — the tokenised link WAS the delivery. */
export const NO_EMAIL_PROVIDER = 'none';

export type EmailOutcome =
  | { sent: true; providerId: string | null }
  | { sent: false; skipped: true; reason: string }
  | { sent: false; skipped: false; reason: string };

/**
 * Sends both parts, always.
 *
 * `text` is not a fallback nobody sees. It is what a screen reader reads, what
 * a watch notification shows, what a plain-text client renders — and a message
 * with no text part scores measurably worse with spam filters, which for a
 * proposal going to a prospect is the failure that costs the most. So the
 * signature makes it impossible to send HTML without also writing the text.
 */
async function send(
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<EmailOutcome> {
  if (!transport || !FROM) {
    return {
      sent: false,
      skipped: true,
      reason: 'No email provider configured (GMAIL_USER / GMAIL_APP_PASSWORD unset).',
    };
  }
  try {
    const info = await transport.sendMail({ from: FROM, to, subject, text, html });
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
  // Wording from the brief's assets/client-email-template.md, unchanged in
  // structure — only the placeholders are filled. The HTML part says the
  // same thing; it is not a different letter.
  const name = escapeHtml(params.clientName);
  const company = escapeHtml(params.companyName);
  const seller = escapeHtml(params.salespersonName);

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
    emailShell({
      title: `Your proposal from Koya Talent`,
      preheader: `The proposal for ${params.companyName} — scope, timeline and pricing.`,
      body:
        para(`Hi ${name},`) +
        para(
          'Thanks again for taking the time to speak with us. Based on our conversation, ' +
            'we have put together a customized proposal for your review.',
        ) +
        button({ label: 'View your proposal', href: params.proposalLink }) +
        para('It covers the project scope, timeline, pricing details, and our recommended approach.') +
        para(
          'If you have any questions or would like to make adjustments, feel free to reach out — ' +
            'we are happy to iterate with you.',
        ) +
        para('Looking forward to hearing your thoughts.') +
        para(`Best regards,<br><strong>${seller}</strong><br>Koya Talent`),
      footnote: `This link is private to ${company}. It expires in 90 days and can be withdrawn at any time.`,
    }),
  );
}

export async function sendApprovalRequest(params: {
  approverEmail: string;
  authorName: string;
  companyName: string;
  reviewLink: string;
}): Promise<EmailOutcome> {
  const author = escapeHtml(params.authorName);
  const company = escapeHtml(params.companyName);

  return send(
    params.approverEmail,
    `Proposal ready for review — ${params.companyName}`,
    `${params.authorName} submitted a proposal for ${params.companyName} and it needs your review ` +
      `before it can go to the client.\n\n` +
      `Review it here: ${params.reviewLink}\n\n` +
      `(This link requires you to be signed in as an approver.)`,
    emailShell({
      title: `Ready for review: ${params.companyName}`,
      // Names the person and the company, because an approver's inbox may
      // hold several of these and the subject line alone does not say who
      // is waiting on them.
      preheader: `${params.authorName} needs your sign-off before this reaches the client.`,
      body:
        para(
          `<strong>${author}</strong> submitted a proposal for <strong>${company}</strong> ` +
            'and it needs your review before it can go to the client.',
        ) +
        button({ label: 'Review the proposal', href: params.reviewLink }) +
        para('Nothing is sent until you approve it.', true),
      footnote: 'This link requires you to be signed in as an approver.',
    }),
  );
}

/**
 * Tells the salesperson their client actually answered — the one thing the
 * system could never report before, because nothing a client did was ever
 * recorded. Best-effort: the decision is already committed by the time this
 * is called, so a failure here must never undo it.
 */
export async function sendClientDecision(params: {
  toEmail: string;
  decision: 'accept' | 'decline';
  clientName: string;
  companyName: string;
  reason?: string;
  proposalLink: string;
}): Promise<EmailOutcome> {
  const accepted = params.decision === 'accept';
  const who = escapeHtml(params.clientName);
  const company = escapeHtml(params.companyName);

  return send(
    params.toEmail,
    accepted
      ? `Accepted — ${params.companyName}`
      : `Declined — ${params.companyName}`,
    (accepted
      ? `${params.clientName} accepted the proposal for ${params.companyName}.\n\n`
      : `${params.clientName} declined the proposal for ${params.companyName}.\n\n` +
        `Reason given:\n${params.reason ?? '(none given)'}\n\n`) +
      `See it here: ${params.proposalLink}\n\n` +
      `(This link requires you to be signed in.)`,
    emailShell({
      title: accepted ? `${params.companyName} accepted` : `${params.companyName} declined`,
      // The whole answer, in the inbox list, without opening anything —
      // this is the one email whose content is a single fact.
      preheader: accepted
        ? `${params.clientName} accepted the proposal.`
        : `${params.clientName} declined. Their reason is inside.`,
      body:
        para(
          accepted
            ? `<strong>${who}</strong> accepted the proposal for <strong>${company}</strong>.`
            : `<strong>${who}</strong> declined the proposal for <strong>${company}</strong>.`,
        ) +
        (accepted ? '' : quote('Reason given', params.reason ?? '(none given)')) +
        button({ label: 'Open the proposal', href: params.proposalLink }),
      footnote: 'This link requires you to be signed in.',
    }),
  );
}

/**
 * The one reminder a client gets, two days after the proposal reached them.
 *
 * Written to give them an easy way out as well as an easy yes. A reminder
 * that only pushes reads as pressure and earns silence; naming "not right
 * now" as an acceptable answer is what makes it a nudge rather than a chase.
 */
export async function sendClientNudge(params: {
  toEmail: string;
  clientName: string;
  companyName: string;
  salespersonName: string;
  proposalLink: string;
}): Promise<EmailOutcome> {
  const name = escapeHtml(params.clientName);
  const company = escapeHtml(params.companyName);
  const seller = escapeHtml(params.salespersonName);

  return send(
    params.toEmail,
    `Following up — proposal for ${params.companyName}`,
    `Hi ${params.clientName},\n\n` +
      `Just following up on the proposal we sent over for ${params.companyName}. ` +
      `I wanted to make sure it reached you.\n\n` +
      `You can still view it here: ${params.proposalLink}\n\n` +
      `There is an accept or decline button at the bottom of that page, so letting us ` +
      `know either way only takes a moment. If the timing is not right, just say so — ` +
      `that is a genuinely useful answer and we would rather know than wonder.\n\n` +
      `And if anything in it needs changing, tell me what and we will revise it.\n\n` +
      `Best regards,\n\n${params.salespersonName}\n\nKoya Talent`,
    emailShell({
      title: 'Just following up',
      // Says "no pressure" before the mail is even opened, which is the
      // whole point of a nudge that is meant to read as a nudge.
      preheader: `Your proposal for ${params.companyName} is still open — either answer is welcome.`,
      body:
        para(`Hi ${name},`) +
        para(
          `Just following up on the proposal we sent over for <strong>${company}</strong>. ` +
            'I wanted to make sure it reached you.',
        ) +
        button({ label: 'View the proposal', href: params.proposalLink }) +
        para(
          'There is an accept or decline button at the bottom of that page, so letting us know ' +
            'either way only takes a moment. <strong>If the timing is not right, just say so</strong> — ' +
            'that is a genuinely useful answer and we would rather know than wonder.',
        ) +
        para('And if anything in it needs changing, tell me what and we will revise it.') +
        para(`Best regards,<br><strong>${seller}</strong><br>Koya Talent`),
      footnote: 'This is the only reminder we will send about this proposal.',
    }),
  );
}
