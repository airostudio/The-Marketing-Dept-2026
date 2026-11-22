/**
 * api/_lib/merge-fields.js — the one place {{token}} substitution happens.
 *
 * Previously api/send-campaign.js had its own private copy of this, and the
 * AI drafting prompt (web/agents/email-agent.html) told the model to write
 * {{first_name}} while the actual data side (web/js/contacts-store.js's
 * toRecipients()) only ever populates {{firstName}} — two independent
 * descriptions of the same contract that had quietly drifted apart. A
 * campaign following the AI's own instructions to the letter would still
 * have every recipient silently skipped at send time.
 *
 * Factoring this out doesn't fix a naming mismatch by itself, but it means
 * there is now exactly one regex and one substitution rule that both
 * api/send-campaign.js and api/preview-merge.js run — a live preview built
 * against this can never show something different from what actually sends,
 * which is the whole point of a preview.
 */

'use strict';

// {{token}} or {{token|fallback}}. The fallback is what is used when the
// recipient has no value for the token — "Hi {{firstName|there}}," reads fine
// for everyone, and {{area|your area}} can never leave a hole. The fallback
// is plain text only: no braces, tags or pipes.
const MERGE_TAG_RE = /\{\{\s*([\w.]+)\s*(?:\|\s*([^{}<>|]*?)\s*)?\}\}/g;

/** The tokens the sending system actually recognizes — kept in sync with
 *  api/send-campaign.js's mergeFieldsWithUnsub and contacts-store.js's
 *  toRecipients(). Anything else a caller writes as {{token}} still gets
 *  substituted if the recipient row happens to carry that key (custom
 *  fields do), but these four are the ones every template can rely on. */
const KNOWN_TOKENS = [
  'firstName', 'lastName', 'company', 'unsubscribe_url',
  // The recipient's own details, when the contact has them (Blade-found
  // businesses do). Use with a fallback: {{area|your area}}.
  'area', 'website',
  // Who the email is sent as — filled by Pat from the Business Brain contact
  // chosen at send time. A send with none chosen is skipped loudly, not blanked.
  'senderName', 'senderFirstName', 'senderTitle', 'senderEmail', 'senderPhone', 'senderCompany',
];

/** Tokens that may be used with no fallback because a blank is harmless. */
const OPTIONAL_TOKENS = ['firstName', 'lastName', 'company'];

// firstName/lastName/company are optional per-recipient personalization, not
// data the send should depend on existing. A contact with no first name on
// file is a completely normal case — not sending them the campaign at all
// (which is what leaving "{{firstName}}" literal used to cause, since that
// was then caught as an "unresolved merge tag" and the whole recipient was
// skipped) is worse than sending it without their name. unsubscribe_url is
// deliberately NOT in this set — it must never silently blank; send-campaign.js
// always supplies a real value for it, and if it somehow didn't, that should
// still be visible as a defect, not swallowed.
const BLANK_FALLBACK_TOKENS = new Set(['firstName', 'lastName', 'company']);

/**
 * Replace {{token}} merge tags with per-recipient values. A token in
 * BLANK_FALLBACK_TOKENS with no value for this recipient resolves to an
 * empty string — the send still goes out, just without that personalization.
 * Any OTHER unresolved token (a typo, or a genuine custom field that really
 * is missing) is left as literal text rather than silently dropped, so a bad
 * recipient row or a mistyped token name is visible in the rendered output
 * instead of vanishing into blank text, and still gets caught as unfinished
 * content downstream.
 */
function applyMergeFields(template, mergeFields) {
  if (!template) return template;
  const substituted = template.replace(MERGE_TAG_RE, (match, key, fallback) => {
    const val = mergeFields && mergeFields[key];
    if (val !== undefined && val !== null && val !== '') return String(val);
    if (fallback !== undefined) return fallback;     // {{key|fallback}} — written by the author, so it wins
    return BLANK_FALLBACK_TOKENS.has(key) ? '' : match;
  });
  // The one common artifact of a blanked name worth cleaning up generically:
  // "Hi {{firstName}}," becoming "Hi ," (or "Hi {{firstName}}!" becoming
  // "Hi !") reads like a bug even though nothing is wrong. A space directly
  // before sentence-ending punctuation is never intentional in normal copy,
  // so collapsing it is safe regardless of which token (if any) caused it.
  return substituted.replace(/ +([,.!?;:])/g, '$1');
}

/**
 * A bracket placeholder like "[First Name]" is what the Webese incident
 * actually was — copy that clearly INTENDED per-recipient personalization,
 * just written in the wrong syntax. For that narrow, unambiguous set (a
 * name or company, recognizably meant as a real merge field) there is no
 * reason to make a human retype it: rewrite it to the real {{token}} so it
 * personalizes correctly, the same as if it had been typed right the first
 * time. Anything else in brackets — a missing statistic, a placeholder link,
 * a sender name, a mailing address — is content nobody has a value for yet,
 * and guessing at it would be worse than asking; see content-guard.js and
 * Pat's own "fill in the rest" prompt for those.
 */
const FIELD_ALIASES = [
  { re: /\[\s*first\s*name\s*\]/gi, token: 'firstName' },
  { re: /\[\s*last\s*name\s*\]/gi, token: 'lastName' },
  { re: /\[\s*company(?:\s*name)?\s*\]/gi, token: 'company' },
];

/** Rewrites recognizable bracket aliases to their real {{token}} form. Pure
 *  text rewriting — does not touch anything it doesn't recognize. */
function resolveFieldAliases(template) {
  if (!template) return template;
  return FIELD_ALIASES.reduce((text, { re, token }) => text.replace(re, `{{${token}}}`), template);
}

/** The bare token names a text uses, fallback syntax stripped. */
function tokenNames(text) {
  const names = new Set();
  const re = new RegExp(MERGE_TAG_RE.source, 'g');
  let m;
  while ((m = re.exec(text || ''))) names.add(m[1]);
  return [...names];
}

/** Tokens used with no fallback that would skip a recipient who lacks them. */
function tokensNeedingFallback(text) {
  const bare = new Set();
  const re = new RegExp(MERGE_TAG_RE.source, 'g');
  let m;
  while ((m = re.exec(text || ''))) {
    if (m[2] === undefined && !OPTIONAL_TOKENS.includes(m[1]) && !/^sender[A-Z]/.test(m[1]) && m[1] !== 'unsubscribe_url') bare.add(m[1]);
  }
  return [...bare];
}

module.exports = { applyMergeFields, resolveFieldAliases, KNOWN_TOKENS, OPTIONAL_TOKENS, MERGE_TAG_RE, tokenNames, tokensNeedingFallback };
