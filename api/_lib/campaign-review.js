/**
 * api/_lib/campaign-review.js — Scotty's pre-send QA pass and fix pass as
 * plain functions, so api/review-campaign.js / api/fix-campaign.js (Pat's page)
 * and Scotty's server-side missions (api/_lib/pat-pipeline.js) run the SAME
 * review with the SAME rules, not two copies that drift apart.
 *
 * See those two endpoints for the full reasoning (forced tool calls instead of
 * freehand JSON, and why a fix may rewrite phrasing but never invent a fact).
 */

'use strict';

const { callClaudeForJSON } = require('./nancy-claude.js');
const writingLanguage = require('./writing-language.js');

const REVIEW_TOOL = {
  name: 'submit_campaign_review',
  description: 'Submit the QA verdict for this email campaign before it is allowed to send.',
  input_schema: {
    type: 'object',
    properties: {
      approved: { type: 'boolean', description: 'true only if blockers is empty' },
      blockers: { type: 'array', items: { type: 'string' }, description: 'Specific issues that MUST be fixed before send. Empty array if none.' },
      warnings: { type: 'array', items: { type: 'string' }, description: 'Non-blocking issues worth a human glance. Empty array if none.' },
      summary: { type: 'string', description: '2-3 sentence CMO-level verdict on whether this is safe to send and why.' },
    },
    required: ['approved', 'blockers', 'warnings', 'summary'],
  },
};

const SYSTEM_PROMPT = `You are Scotty, the AI CMO, acting as the final QA gate before a marketing email campaign is sent to real recipients. You are strict — deliverability, legal exposure, and brand reputation are on the line. You are reviewing copy only; you cannot see rendered output, so flag anything text-inspectable.

Check for:
- Missing or malformed unsubscribe / opt-out language (required for bulk commercial email — CAN-SPAM / GDPR)
- Missing physical sender identification if implied as a commercial newsletter
- Spam-trigger language (ALL CAPS shouting, excessive "!!!", "FREE", "ACT NOW", "$$$", misleading subject lines)
- Unresolved or likely-broken merge tags (e.g. {{firstName}} left in copy with no fallback, or merge tokens that don't look like real fields)
- Unfilled bracket placeholders left in the copy (e.g. "[Your Name]", "[Company]", "[solve pain point]", "[insert X]") — these must never go out in a real send
- Overstated/unverifiable claims (guarantees, ROI numbers, "#1", medical/financial claims) that need a disclaimer
- Broken or placeholder links (e.g. "#", "example.com", "TODO", "[link]")
- Missing subject line or empty body
- Recipient list problems visible from the sample given (obviously fake/test addresses like test@test.com mixed into a real send)

Set approved:false if there is at least one blocker. Minor stylistic nitpicks belong in warnings, not blockers.`;


/** @returns {Promise<{approved, blockers, warnings, summary}>} @throws Error on a failed Claude call */
async function reviewCampaign({ campaignName, recipients, replyTo, subject, html, text, language }) {
  const recipientList = Array.isArray(recipients) ? recipients : [];
  const recipientSample = recipientList.slice(0, 5).map((r) => r && r.to).filter(Boolean).join(', ');
  const mergeTokensUsed = Array.from(new Set(
    (`${subject}\n${html}`.match(/\{\{\s*([\w.]+)\s*(?:\|[^{}]*)?\}\}/g) || [])
      .map((t) => t.replace(/[{}]/g, '').split('|')[0].trim())
  ));

  const user = `Campaign: ${campaignName || '(untitled)'}
Recipient count: ${recipientList.length}
Recipient sample: ${recipientSample || '(none provided)'}
Merge tokens found in copy: ${mergeTokensUsed.join(', ') || '(none)'}
Reply-to: ${replyTo || '(not set)'}
${writingLanguage.directive(language) ? `Expected writing language: ${writingLanguage.LANGUAGES[language][0]}. Report any misspelling, or spelling from a different variant, as a warning (not a blocker).\n` : ''}
Subject: ${subject}

HTML body:
${html}

${text ? `Plain text body:\n${text}` : ''}`;

  const result = await callClaudeForJSON({ system: SYSTEM_PROMPT, user, tool: REVIEW_TOOL, maxTokens: 1500 });
  if (!result.success) throw new Error(result.error);

  const parsed = result.data || {};
  return {
    approved: !!parsed.approved && (!parsed.blockers || parsed.blockers.length === 0),
    blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    summary: parsed.summary || '',
  };
}

const FIX_TOOL = {
  name: 'submit_campaign_fix',
  description: 'Fix what can be safely fixed in this email without inventing facts, and ask for anything that genuinely needs real information only the sender has.',
  input_schema: {
    type: 'object',
    properties: {
      fixedSubject: { type: 'string', description: 'The subject line, rewritten to resolve whatever blockers are safely fixable. Unchanged if the subject had no fixable issue.' },
      fixedHtml: { type: 'string', description: 'The full HTML body, rewritten to resolve whatever blockers are safely fixable. Preserve all HTML structure/tags — only change wording. Unchanged if nothing here was fixable.' },
      fixedText: { type: 'string', description: 'The plain-text body, same treatment as fixedHtml. Empty string if there was no plain-text body.' },
      resolvedBlockers: { type: 'array', items: { type: 'string' }, description: 'Exact strings copied from the blockers list, for each one actually resolved by the rewrite above.' },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            snippet: { type: 'string', description: 'The EXACT text copied verbatim from the email that needs to change — this is used to find and replace it, so it must match the source exactly, character for character.' },
            question: { type: 'string', description: 'A short, specific question asking the sender for the real information needed to fix this.' },
          },
          required: ['snippet', 'question'],
        },
        description: 'One entry per blocker that needs a real fact, not a rewrite — a URL, a name, a statistic, a physical address, anything invented would be dishonest.',
      },
    },
    required: ['fixedSubject', 'fixedHtml', 'fixedText', 'resolvedBlockers', 'questions'],
  },
};

const FIX_SYSTEM_PROMPT = `You are Scotty, the AI CMO, fixing what you safely can in a blocked email campaign before asking the sender for help.

You will be given the campaign's subject/HTML/text and a list of specific blockers a QA review already found. For EACH blocker, decide which of two things applies:

FIX IT YOURSELF — safe to rewrite without inventing any fact:
- Spam-trigger phrasing (ALL CAPS, "FREE!!!", excessive punctuation, "ACT NOW") — rewrite in normal tone
- An overstated/unverifiable claim (a guarantee, an invented ROI number, "#1", a medical/financial claim) — soften or remove the specific unverifiable part, don't replace it with a different invented claim
- Grammatical errors, awkward phrasing, missing words
- A stray leftover label or template artifact — remove it
- Generic/weak CTA copy that doesn't reference anything factual — you may improve the wording

ASK THE SENDER — this needs a real fact only they have, never invent one:
- A broken or placeholder link ("#", "example.com", "[link]") — you don't know the real URL
- A missing real customer example, statistic, or case study — you don't know a real one
- A missing sender name, company name, or physical address — you don't know the real one
- Anything about the recipient list itself (fake/test addresses) — that's a data problem, not a copy problem; ask, don't touch the copy

Never invent a URL, a name, a number, a testimonial, or an address to make a blocker disappear. A plausible-looking invented fact is worse than an honest question, because nobody will know to check it.

For every question, copy the EXACT text from the email that needs to change into "snippet" — character for character, so it can be found and replaced. If a blocker doesn't correspond to one findable exact snippet (e.g. "the recipient list contains test addresses"), still ask the question but leave snippet as a short unique phrase near the relevant part of the copy, or an empty string if there's truly nothing to anchor to.

If a blocker is already resolved by the compliance footer the sending system appends automatically (a generic "missing unsubscribe language" complaint when the footer will add it) — you can note it in resolvedBlockers without changing anything, since it's already handled elsewhere.`;


/** @returns {Promise<{fixedSubject, fixedHtml, fixedText, resolvedBlockers, questions}>} @throws Error on a failed Claude call */
async function fixCampaign({ subject, html, text, blockers }) {
  const user = `Subject: ${subject}

HTML body:
${html}

${text ? `Plain text body:\n${text}` : '(no plain-text body)'}

Blockers a QA review found:
${blockers.map((b, i) => `${i + 1}. ${b}`).join('\n')}`;

  const result = await callClaudeForJSON({ system: FIX_SYSTEM_PROMPT, user, tool: FIX_TOOL, maxTokens: 3000 });
  if (!result.success) throw new Error(result.error);

  const parsed = result.data || {};
  return {
    fixedSubject: parsed.fixedSubject || subject,
    fixedHtml: parsed.fixedHtml || html,
    fixedText: parsed.fixedText || text || '',
    resolvedBlockers: Array.isArray(parsed.resolvedBlockers) ? parsed.resolvedBlockers : [],
    questions: Array.isArray(parsed.questions)
      ? parsed.questions.filter((q) => q && typeof q.question === 'string' && q.question.trim())
      : [],
  };
}

module.exports = { reviewCampaign, fixCampaign, REVIEW_TOOL, FIX_TOOL, SYSTEM_PROMPT, FIX_SYSTEM_PROMPT };
