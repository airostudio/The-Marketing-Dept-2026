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

const MERGE_TAG_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** The tokens the sending system actually recognizes — kept in sync with
 *  api/send-campaign.js's mergeFieldsWithUnsub and contacts-store.js's
 *  toRecipients(). Anything else a caller writes as {{token}} still gets
 *  substituted if the recipient row happens to carry that key (custom
 *  fields do), but these four are the ones every template can rely on. */
const KNOWN_TOKENS = ['firstName', 'lastName', 'company', 'unsubscribe_url'];

/**
 * Replace {{token}} merge tags with per-recipient values. Unresolved tokens
 * are left as-is rather than silently dropped, so a bad recipient row or a
 * mistyped token name is visible in the rendered output instead of vanishing
 * into blank text.
 */
function applyMergeFields(template, mergeFields) {
  if (!template) return template;
  return template.replace(MERGE_TAG_RE, (match, key) => {
    const val = mergeFields && mergeFields[key];
    return (val === undefined || val === null || val === '') ? match : String(val);
  });
}

module.exports = { applyMergeFields, KNOWN_TOKENS, MERGE_TAG_RE };
