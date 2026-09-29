/**
 * The Webese incident's root cause, traced end-to-end: the AI drafting
 * prompt in web/agents/email-agent.html told the model to write
 * {{first_name}}-style tokens, while the actual recipient data
 * (web/js/contacts-store.js's toRecipients()) only ever supplies
 * "firstName" — two independent descriptions of the same contract that had
 * quietly drifted apart. A campaign following the AI's OWN instructions to
 * the letter would still have had every recipient silently skipped at send.
 * The prompt also taught bracket notation ("[pain-focused variant]") right
 * next to its one under-emphasized merge-tag instruction, and only warned
 * against brackets for the sign-off specifically — not personalization in
 * general, which is exactly where "[First Name]" came from.
 *
 * This pins the structural fixes: the prompt now names the exact, real
 * token set, warns against brackets everywhere (not just the sign-off), and
 * Pat's compose flow now renders a real-data preview (api/preview-merge.js)
 * before send instead of never showing rendered output at all.
 *
 *   node tests/merge-tag-pipeline/run.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }

console.log('\n──── the drafting prompt names the REAL tokens, matching the data side exactly ────');
{
  const prompt = read('web/agents/email-agent.html');
  check('the prompt no longer INSTRUCTS the model to write {{first_name}} (snake_case, which never matches real data) — it may still name it as a negative example',
    !/Use \{\{first_name\}\}-style merge tokens/.test(prompt));
  check('the prompt explicitly names {{firstName}} as the correct, camelCase token',
    /\{\{firstName\}\}/.test(prompt));
  check('the prompt states this is the exact set the sending system recognizes',
    /ONLY merge tokens the sending system actually recognizes/.test(prompt));

  const contactsStore = read('web/js/contacts-store.js');
  const toRecipients = contactsStore.slice(contactsStore.indexOf('function toRecipients'), contactsStore.indexOf('function toRecipients') + 400);
  check('the prompt\'s named tokens actually match what toRecipients() populates (firstName, lastName, company)',
    /firstName:/.test(toRecipients) && /lastName:/.test(toRecipients) && /company:/.test(toRecipients));
}

console.log('\n──── the "no bracket placeholders" rule covers ALL copy, not just the sign-off ────');
{
  const prompt = read('web/agents/email-agent.html');
  check('brackets are banned everywhere in the copy, not just for a sender name',
    /NEVER write a placeholder in square brackets ANYWHERE/.test(prompt));
  check('the prompt explains its OWN bracket notation ("[pain-focused variant]") is an instruction to the model, not valid output',
    /are instructions to you about what to write in that spot/.test(prompt));
  check('the old narrow-scoped warning (sign-off only) is gone', !/never write a placeholder like "\[Your Name\]" or "\[Sender\]"/.test(prompt));
}

console.log('\n──── a bracket someone clearly meant as a real field is auto-resolved, not blocked ────');
{
  const shared = read('api/_lib/merge-fields.js');
  check('a resolver for known field aliases exists', /function resolveFieldAliases/.test(shared));
  check('it is exported for reuse by both send-campaign and preview-merge', /module\.exports = \{[^}]*resolveFieldAliases/.test(shared));

  const sendCampaign = read('api/send-campaign.js');
  check('send-campaign.js resolves aliases before the template-level check runs',
    sendCampaign.indexOf('resolveFieldAliases(subject)') < sendCampaign.indexOf('checkSendableContent({ subject, html, text }, { allowMergeTags: true })'));

  const preview = read('api/preview-merge.js');
  check('preview-merge.js resolves aliases before rendering too, so the preview matches what actually sends',
    /applyMergeFields\(resolveFieldAliases\(subject/.test(preview));
  check('preview-merge.js returns the structured placeholder list, not just prose', /findBracketPlaceholders\(/.test(preview) && /issues: blocking, placeholders/.test(preview));
}

console.log('\n──── one substitution function, not two that can drift ────');
{
  const sendCampaign = read('api/send-campaign.js');
  check('send-campaign.js no longer keeps its own private applyMergeFields', !/function applyMergeFields/.test(sendCampaign));
  check('it imports the shared implementation instead', /require\('\.\/_lib\/merge-fields\.js'\)/.test(sendCampaign));

  const shared = read('api/_lib/merge-fields.js');
  check('the shared module documents the actual real token set', /firstName.*lastName.*company.*unsubscribe_url|KNOWN_TOKENS/.test(shared));
}

console.log('\n──── Pat shows a real-data preview before send, not just the raw {{template}} ────');
{
  const page = read('web/agents/email-delivery-agent.html');
  check('a preview box exists in the review step', /merge-preview-box/.test(page));
  check('it calls the shared preview endpoint', /\/api\/preview-merge/.test(page));
  check('the preview runs BEFORE/alongside Scotty\'s review, in runReview()', /renderMergePreview\(\)/.test(page) && /function runReview\(\)/.test(page));
  check('the rendered HTML is shown in a sandboxed iframe, not raw innerHTML on the page itself',
    /iframe\.setAttribute\('sandbox', ''\)/.test(page) && /iframe\.srcdoc = data\.html/.test(page));
  check('the preview surfaces issues found for the sample recipient', /data\.issues/.test(page));
}

console.log('\n──── unresolvable placeholders are ASKED about, not just refused ────');
{
  const page = read('web/agents/email-delivery-agent.html');
  check('the preview endpoint\'s structured placeholder list drives an inline form', /renderPlaceholderFillForm\(placeholders\)/.test(page));
  check('one input per exact placeholder, not a single free-text box', /data-placeholder="\$\{escHtml\(p\)\}"/.test(page));
  check('applying a fix replaces the placeholder everywhere (subject/html/text), not just one spot',
    /campaign\.subject = replaceAll\(campaign\.subject\)/.test(page) &&
    /campaign\.html = replaceAll\(campaign\.html\)/.test(page) &&
    /campaign\.text = replaceAll\(campaign\.text\)/.test(page));
  check('the fix is reflected back into the visible compose fields too, not just in memory',
    /in-subject'\)\.value = campaign\.subject/.test(page) && /in-html'\)\.value = campaign\.html/.test(page));
  check('applying fixes re-runs the whole review, so the preview reflects the real content', /function applyPlaceholderFixes\(\)[\s\S]{0,1500}runReview\(\)/.test(page));
  check('applyPlaceholderFixes is reachable from the onclick handler (exported on EDA)', /applyPlaceholderFixes,?\s*\n\s*\};/.test(page) || /EDA\.applyPlaceholderFixes\(\)/.test(page));
}

console.log('\n──── a pasted recipient list is enriched from the contacts table it already has ────');
{
  const page = read('web/agents/email-delivery-agent.html');
  check('collate() calls the enrichment step', /enrichRecipientsFromContacts\(recipients\)/.test(page));
  check('only for the paste path — segment recipients already come from real contact rows',
    /if \(!segmentRecipients\) \{\s*\n\s*recipients = await window\.EmailDeliveryService\.enrichRecipientsFromContacts/.test(page));
}

console.log('\n──── Scotty attempts its own fix pass on a blocked campaign before offering override ────');
{
  const page = read('web/agents/email-delivery-agent.html');
  check('a fix button is offered alongside the existing manual-edit/override options', /Ask Scotty to fix this/.test(page));
  check('it calls the new fix endpoint with the actual blockers Scotty found', /\/api\/fix-campaign[\s\S]{0,300}blockers: lastReview\.blockers/.test(page));
  check('a safe rewrite is shown as a preview requiring an explicit apply click, not silently applied', /Apply Scotty\'s fix/.test(page) && /function applyScottyFix\(\)/.test(page));
  check('the fixed HTML preview uses the same sandboxed-iframe pattern as the merge preview', /scotty-fix-frame-wrap[\s\S]{0,1300}iframe\.setAttribute\('sandbox', ''\)/.test(page));
  check('questions needing real facts reuse the EXACT SAME fill-in mechanism as bracket placeholders (one flow, not two)',
    /class="placeholder-fill-input" data-placeholder="\$\{escHtml\(q\.snippet\)\}"/.test(page) &&
    /onclick="EDA\.applyPlaceholderFixes\(\)">Apply answers/.test(page));
  check('askScottyToFix and applyScottyFix are reachable from onclick handlers (exported on EDA)',
    /askScottyToFix, applyScottyFix,/.test(page));
}

console.log('\n──── the fix endpoint is instructed never to invent facts, only rewrite tone ────');
{
  const fixSrc = read('api/fix-campaign.js');
  check('the prompt explicitly bans inventing a URL/name/stat/address', /Never invent a URL, a name, a number, a testimonial, or an address/.test(fixSrc));
  check('the prompt distinguishes fixable tone/spam issues from must-ask factual gaps', /FIX IT YOURSELF/.test(fixSrc) && /ASK THE SENDER/.test(fixSrc));
  check('uses the same forced-tool-call helper as review-campaign — no freehand JSON parsing', /callClaudeForJSON/.test(fixSrc));
  check('malformed/emptyquestion entries from the model are filtered before reaching the client', /filter\(\(q\) => q && typeof q\.question === \x27string\x27/.test(fixSrc));
}

console.log('\n──── the preview endpoint reuses send-time logic exactly, not a second copy ────');
{
  const preview = read('api/preview-merge.js');
  check('uses the shared merge-fields module', /require\('\.\/_lib\/merge-fields\.js'\)/.test(preview));
  check('uses the shared content-guard module', /require\('\.\/_lib\/content-guard\.js'\)/.test(preview));
  check('is auth-gated', /requireUser\(req, res\)/.test(preview));
  check('makes no Resend call and claims no quota — it sends nothing', !/resend\.com/i.test(preview) && !/claimQuota/.test(preview));
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
