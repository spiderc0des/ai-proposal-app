import 'server-only';

/**
 * The HTML shell every outgoing email is poured into.
 *
 * Email clients are not browsers. The rules this file follows, and why:
 *
 *   • Tables for layout, not flex or grid. Outlook renders through Word's
 *     HTML engine, which supports neither.
 *   • Inline styles on every element. Gmail strips <style> blocks in some
 *     contexts, notably the clipped-message view and several mobile apps.
 *   • No external CSS, no web fonts, no images. An image would need hosting
 *     and would be blocked by default anyway; a font would silently fall
 *     back. The palette below is the app's own (app/globals.css) hard-coded,
 *     because a CSS variable cannot survive here.
 *   • A plain-text alternative is always sent alongside (see send() in
 *     lib/email.ts). It is not a courtesy — a mail with no text part scores
 *     worse with spam filters, and it is what a screen reader or a watch
 *     notification actually reads.
 *
 * Deliberately restrained: no logo, no marketing furniture. Three of the
 * four emails go to a client who is about to be asked for money, and one
 * goes to a colleague. Both audiences are better served by something that
 * looks like correspondence than by something that looks like a campaign.
 */

const INK = '#0f172a';
const BODY = '#1e293b';
const SOFT = '#475569';
const FAINT = '#8496ab';
const RULE = '#dbe3ec';
const PAPER = '#ffffff';
const SURFACE = '#f1f5f9';
const ACCENT = '#0284c7';

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export type EmailButton = { label: string; href: string };

/** A paragraph. `muted` for the small print at the end. */
export function p(text: string, muted = false): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${
    muted ? SOFT : BODY
  };">${text}</p>`;
}

/** A bordered box for something quoted — a decline reason, a rejection note. */
export function quote(label: string, text: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">
    <tr><td style="border-left:3px solid ${ACCENT};background:${SURFACE};padding:12px 16px;border-radius:0 4px 4px 0;">
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${FAINT};margin-bottom:4px;">${escapeHtml(label)}</div>
      <div style="font-size:15px;line-height:1.55;color:${BODY};">${escapeHtml(text)}</div>
    </td></tr>
  </table>`;
}

/**
 * The call to action. A table rather than a styled <a> because Outlook
 * ignores padding on an inline element, collapsing the button to bare text.
 * The URL is repeated in plain text underneath: a proportion of recipients
 * cannot or will not click a styled link in an email from an address they
 * do not recognise, and for a proposal link that matters.
 */
export function button(btn: EmailButton): string {
  // The padding lives on the <td>, not the <a>. A client that strips or
  // ignores padding on an inline element — Outlook does — would otherwise
  // collapse this to bare blue text, which is the one element in the mail
  // that has to look clickable. Verified by rendering it through a converter
  // that ignores anchor padding: the shape survives.
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 18px;">
    <tr><td align="center" bgcolor="${ACCENT}" style="background:${ACCENT};border-radius:6px;padding:13px 28px;">
      <a href="${escapeAttr(btn.href)}"
         style="font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;font-family:${FONT};white-space:nowrap;">${escapeHtml(btn.label)}</a>
    </td></tr>
  </table>
  <p style="margin:0 0 20px;font-size:12px;line-height:1.5;color:${FAINT};word-break:break-all;">
    Or paste this into your browser:<br><span style="color:${SOFT};">${escapeHtml(btn.href)}</span>
  </p>`;
}

/**
 * Wraps the blocks above into a full document.
 *
 * `preheader` is the line a mail client shows next to the subject in the
 * inbox list. Left unset, clients grab the first words of the body, which
 * for a letter is "Hi Priya," — a wasted slot on the one line that decides
 * whether the mail gets opened. Hidden in the rendered mail itself.
 */
export function emailShell(params: {
  title: string;
  preheader: string;
  body: string;
  footnote?: string;
}): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(params.title)}</title>
</head>
<body style="margin:0;padding:0;background:${SURFACE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(params.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${SURFACE};">
<tr><td align="center" style="padding:28px 12px;">

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background:${PAPER};border:1px solid ${RULE};border-radius:8px;">
    <tr><td style="padding:28px 32px 8px;font-family:${FONT};">
      <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${ACCENT};margin-bottom:14px;">Koya Talent</div>
      <h1 style="margin:0 0 18px;font-size:20px;line-height:1.3;font-weight:600;color:${INK};">${escapeHtml(params.title)}</h1>
    </td></tr>
    <tr><td style="padding:0 32px 24px;font-family:${FONT};">
${params.body}
    </td></tr>
    ${
      params.footnote
        ? `<tr><td style="padding:0 32px 26px;font-family:${FONT};">
      <div style="border-top:1px solid ${RULE};padding-top:14px;font-size:12px;line-height:1.55;color:${FAINT};">${params.footnote}</div>
    </td></tr>`
        : ''
    }
  </table>

  <div style="max-width:560px;margin:14px auto 0;font-family:${FONT};font-size:11px;line-height:1.5;color:${FAINT};text-align:center;">
    Sent by the Koya Proposal Engine.
  </div>

</td></tr></table>
</body></html>`;
}

/** Text going into an HTML document. Every interpolated value passes through. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Same, for a value going inside an attribute. */
function escapeAttr(s: string): string {
  return escapeHtml(s);
}
