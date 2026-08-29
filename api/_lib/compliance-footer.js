/**
 * api/_lib/compliance-footer.js — guarantees every outgoing email carries
 * opt-out language + a physical mailing address, enforced server-side.
 *
 * Why here and not left to whoever drafts the copy: CAN-SPAM/GDPR/CASL
 * exposure doesn't depend on how careful the AI/human who wrote the body
 * was — it depends on what actually left the sending account. Putting this
 * in the two functions that are the ONLY code paths that call Resend
 * (api/send-email.js, api/send-campaign.js) means it can't be forgotten,
 * edited out client-side, or skipped by a new caller that doesn't know the
 * rule exists.
 *
 * Source of truth, in priority order: whatever the caller explicitly passed
 * (usually Business Brain's sender identity, forwarded by the client) →
 * COMPLIANCE_* env vars → nothing (still sends, but flags a warning back to
 * the caller rather than silently going out without one).
 */

'use strict';

const UNSUB_LANGUAGE_RE = /unsubscribe|opt.?out|stop receiving/i;

function hasUnsubLanguage(text) {
  return UNSUB_LANGUAGE_RE.test(text || '');
}

/** Crude but effective: is a non-trivial chunk of the real address already in the body? */
function hasMailingAddress(text, mailingAddress) {
  const needle = (mailingAddress || '').trim();
  if (needle.length < 8) return false;
  return (text || '').includes(needle);
}

function resolveComplianceFields({ companyName, mailingAddress, replyTo }) {
  return {
    companyName:    companyName    || process.env.COMPLIANCE_COMPANY_NAME    || process.env.RESEND_FROM_NAME || '',
    mailingAddress: mailingAddress || process.env.COMPLIANCE_MAILING_ADDRESS || '',
    replyTo:        replyTo        || process.env.COMPLIANCE_REPLY_TO       || '',
  };
}

function buildFooterHtml({ companyName, mailingAddress, unsubscribeUrl, replyTo }) {
  const identity = [companyName, mailingAddress].filter(Boolean).join(' — ');
  // Literal "opt out"/"unsubscribe" wording is deliberate, not just for the
  // reader — hasUnsubLanguage() (and Scotty's own QA review) look for this
  // exact phrasing, so a footer that only implies opt-out without using the
  // words would fail a later compliance check same as having none at all.
  const optOut = unsubscribeUrl
    ? `<a href="${unsubscribeUrl}" style="color:#888888;text-decoration:underline;">unsubscribe</a>`
    : `reply to this email${replyTo ? ` (${replyTo})` : ''} to opt out of future messages`;
  return `
<div style="margin-top:28px;padding-top:14px;border-top:1px solid #dddddd;font-size:11.5px;line-height:1.6;color:#888888;font-family:Arial,sans-serif;">
  ${identity ? `<p style="margin:0 0 6px;">${identity}</p>` : ''}
  <p style="margin:0;">Don't want to hear from us again? ${optOut}.</p>
</div>`;
}

function buildFooterText({ companyName, mailingAddress, unsubscribeUrl, replyTo }) {
  const identity = [companyName, mailingAddress].filter(Boolean).join(' — ');
  const optOut = unsubscribeUrl
    ? `Unsubscribe: ${unsubscribeUrl}`
    : `Reply to this email${replyTo ? ` (${replyTo})` : ''} to opt out of future messages.`;
  return `\n\n--\n${identity ? identity + '\n' : ''}${optOut}`;
}

/**
 * Appends a compliance footer to html/text UNLESS the body already contains
 * BOTH opt-out language and the real mailing address — checking unsub
 * language alone isn't enough: a merge-token unsubscribe link (e.g.
 * "{{unsubscribe_url}}" rendered as a real link with custom anchor text)
 * can make hasUnsubLanguage() true via the URL itself while the body still
 * has no physical address anywhere in it. Never stacks a second footer
 * under a real one that already covers both.
 * @returns {{html, text, appended, hasCompanyName, hasMailingAddress}}
 */
function ensureComplianceFooter({ html, text, companyName, mailingAddress, unsubscribeUrl, replyTo }) {
  const resolved = resolveComplianceFields({ companyName, mailingAddress, replyTo });
  const combinedBody = `${html || ''} ${text || ''}`;
  const alreadyCompliant = hasUnsubLanguage(combinedBody) && hasMailingAddress(combinedBody, resolved.mailingAddress);

  if (alreadyCompliant) {
    return { html, text, appended: false, hasCompanyName: !!resolved.companyName, hasMailingAddress: !!resolved.mailingAddress };
  }

  const footerArgs = { ...resolved, unsubscribeUrl };
  return {
    html: (html || '') + buildFooterHtml(footerArgs),
    text: text !== undefined ? (text || '') + buildFooterText(footerArgs) : undefined,
    appended: true,
    hasCompanyName: !!resolved.companyName,
    hasMailingAddress: !!resolved.mailingAddress,
  };
}

module.exports = { hasUnsubLanguage, ensureComplianceFooter, resolveComplianceFields };
