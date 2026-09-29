/**
 * api/_lib/content-guard.js — refuses to send copy that was never finished.
 *
 * A real campaign got this far: subject and HTML present, recipients valid,
 * nobody suppressed, budget available — and it still would have gone out
 * with "Hi [First Name]," a CTA linking to literally "[Try Webese Free →]",
 * a sign-off of "[Sender Name]", and a stray "What Content Studio Does"
 * label left over from wherever the copy was drafted. Nothing server-side
 * ever looked at the rendered content itself; compliance-footer.js only
 * checks for opt-out wording and a mailing address, and Scotty's QA review
 * (web/js/email-delivery-service.js) is a client-side, non-deterministic,
 * override-able LLM opinion — not a gate this endpoint enforces.
 *
 * This is deliberately simple pattern-matching, not a model call: it runs on
 * every send, for free, with a result nobody can talk their way past with an
 * "Override" button, and it only needs to catch the shapes an author's own
 * bracket notation and templating actually take.
 *
 * Three things this catches, matched to the actual incident that prompted
 * it:
 *
 *   Bracket placeholders — "[First Name]", "[ADD: a real stat...]",
 *   "[Sender Name]", "[Company Address]". A purely numeric bracket like
 *   "[1]" or "[42]" is excluded — that's an ordinary footnote/citation
 *   marker, not unfinished copy.
 *
 *   Unresolved {{merge}} tags — checked AFTER per-recipient substitution
 *   (applyMergeFields already leaves an unknown/empty token as literal
 *   text on purpose, so a bad recipient row is visible instead of
 *   vanishing into blank text). This is template-level for send-email.js
 *   (no merge fields at all) and per-recipient for send-campaign.js.
 *
 *   Broken links — an href that's empty, "#", or still contains literal
 *   bracket/brace characters, because a placeholder CTA is exactly as
 *   likely to be styled as a real button as a working one is.
 */

'use strict';

const BRACKET_PLACEHOLDER_RE = /\[[^\[\]\n]{1,160}\]/g;
const MERGE_TAG_RE = /\{\{\s*[\w.]+\s*\}\}/g;
const HREF_RE = /href\s*=\s*"([^"]*)"/gi;

/** @returns {string[]} every distinct bracket placeholder found, "[1]"-style footnotes excluded */
function findBracketPlaceholders(text) {
  const found = new Set();
  ((text || '').match(BRACKET_PLACEHOLDER_RE) || []).forEach((m) => {
    const inner = m.slice(1, -1).trim();
    if (/^\d+$/.test(inner)) return; // [1], [42] — a footnote marker, not unfinished copy
    found.add(m);
  });
  return Array.from(found);
}

/** @returns {string[]} every distinct {{token}} still present, unresolved */
function findUnresolvedMergeTags(text) {
  return Array.from(new Set((text || '').match(MERGE_TAG_RE) || []));
}

/** @returns {string[]} every distinct broken href value found in the HTML */
function findBrokenLinks(html) {
  const broken = new Set();
  let m;
  HREF_RE.lastIndex = 0;
  while ((m = HREF_RE.exec(html || ''))) {
    const href = m[1].trim();
    if (!href || href === '#' || /[\[\]{}]/.test(href)) broken.add(href || '(empty)');
  }
  return Array.from(broken);
}

/**
 * @param {{subject?, html?, text?}} content - content as it would actually be sent
 * @param {{allowMergeTags?: boolean}} [opts] - pass true when checking a
 *   send-campaign.js TEMPLATE before per-recipient merge has happened, where
 *   a {{token}} is expected to still be present and is not itself a defect —
 *   it gets checked again, per recipient, AFTER merge instead. Leave false
 *   (the default) for content that has already been through merge, or that
 *   was never templated at all (send-email.js has no merge step, so a
 *   {{token}} there is unresolved by definition).
 * @returns {{blocking: string[]}} human-readable reasons this must not go out; empty when clean
 */
function checkSendableContent({ subject, html, text }, opts = {}) {
  const blocking = [];
  const combined = `${subject || ''}\n${html || ''}\n${text || ''}`;

  const brackets = findBracketPlaceholders(combined);
  if (brackets.length) {
    blocking.push(`Unfilled placeholder${brackets.length === 1 ? '' : 's'} still in the copy: ${brackets.slice(0, 8).join(', ')}${brackets.length > 8 ? ', …' : ''}`);
  }

  if (!opts.allowMergeTags) {
    const unresolvedTags = findUnresolvedMergeTags(combined);
    if (unresolvedTags.length) {
      blocking.push(`Unresolved merge tag${unresolvedTags.length === 1 ? '' : 's'}: ${unresolvedTags.join(', ')} — this recipient has no value for it.`);
    }
  }

  const brokenLinks = findBrokenLinks(html);
  if (brokenLinks.length) {
    blocking.push(`Broken link${brokenLinks.length === 1 ? '' : 's'} in the HTML — href is ${brokenLinks.map((h) => `"${h}"`).join(', ')}.`);
  }

  return { blocking };
}

module.exports = { checkSendableContent, findBracketPlaceholders, findUnresolvedMergeTags, findBrokenLinks };
