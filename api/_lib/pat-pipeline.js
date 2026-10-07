/**
 * api/_lib/pat-pipeline.js — draft a real outreach email, check it through
 * the same gates a send goes through, and report honestly whether it is fit
 * to send. This is what a Scotty mission runs as Pat's step.
 *
 * It used to be a Claude write-up converted to HTML with a regex-guessed
 * subject line and handed to Pat to discover its problems. Now the draft is
 * produced as structured fields, run through (in order):
 *
 *   1. the deterministic send-time guards — unfilled [bracket] placeholders,
 *      broken links, and any {{merge tag}} the send pipeline doesn't know —
 *      the same functions api/send-campaign.js blocks on;
 *   2. Scotty's real QA review (api/_lib/campaign-review.js, the same one
 *      Pat's page calls);
 *   3. if that blocks it, ONE fix pass — which rewrites phrasing but may
 *      never invent a fact, and hands back questions for anything that needs
 *      one — followed by a re-check of 1 and 2.
 *
 * The result says plainly whether it passed. Nothing in here sends anything.
 *
 * Facts it will not make up: a missing offer or sender is a question back to
 * the user (before any Claude spend), not a plausible default; the email
 * makes no claim about any recipient's own website, because one email goes
 * to a whole list and a claim true of one business is false of the next.
 */

'use strict';

const { callClaudeForJSON } = require('./nancy-claude.js');
const { reviewCampaign, fixCampaign } = require('./campaign-review.js');
const { checkSendableContent, findUnresolvedMergeTags } = require('./content-guard.js');
const { applyMergeFields, resolveFieldAliases, KNOWN_TOKENS, tokenNames, tokensNeedingFallback } = require('./merge-fields.js');
const { directive: languageDirective } = require('./writing-language.js');

const DRAFT_TOOL = {
  name: 'submit_campaign_draft',
  description: 'Submit the finished outreach email.',
  input_schema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'Honest, specific subject line. Under 60 characters. No ALL CAPS, no "!!!", no fake "Re:"/"Fwd:".' },
      html: { type: 'string', description: 'The email body as simple HTML: <p> paragraphs, at most one <a href> link. No images, no tables, no styling blocks.' },
      text: { type: 'string', description: 'The same email as plain text.' },
    },
    required: ['subject', 'html', 'text'],
  },
};

const DRAFT_SYSTEM_PROMPT = `You write one short, honest outreach email that will go to a whole list of small local businesses, in the voice of the sender named below.

Hard rules — each one exists because breaking it gets an email blocked or a sender's domain damaged:
- The ONLY merge tags that exist are {{firstName}}, {{lastName}}, {{company}}, {{area}} and {{website}}. Give every tag a fallback after a pipe, used when a recipient has no value: "Hi {{firstName|there}},", "{{company|your business}}", "{{area|your area}}". Use {{firstName|there}} once at most, in the greeting. Use {{area}}/{{website}} only if it reads naturally with its fallback. Never write any other {{tag}}, and never write a {{sender…}} tag — sign off with the literal sender name given.
- NEVER write a [bracketed placeholder] anywhere — not in the greeting, the body, the sign-off or a link. Nothing is filled in later.
- Do NOT write an unsubscribe line, a footer, or a postal address. The sending system adds the legally required footer and unsubscribe link itself.
- NEVER invent a statistic, a price, a result, a guarantee, a testimonial, a client name, a deadline or a case study. Use only the facts you are given.
- NEVER make a claim about the recipient's own website or business ("your site is slow", "I noticed your…") — this one email goes to many different businesses and any specific claim will be false for most of them. Speak to the trade in general terms.
- Use the offer exactly as described; do not embellish what it includes.
- If a link URL is given, use it as the single link's href, exactly as given. If none is given, do not include any link — invite them to reply instead.
- Sign off with the sender name (and title, if given) and the company — nothing else, and never a made-up name.
- 60–120 words. Plain, direct, no hype, no "I hope this finds you well", no fake urgency.`;

/** Checks that cost nothing and must pass before any model is called. */
function missingInputs({ offer, senderName }) {
  const questions = [];
  if (!String(offer || '').trim()) questions.push({ field: 'offer', question: 'What are you offering these businesses? (One or two sentences — the email can only say what you tell it.)' });
  if (!String(senderName || '').trim()) {
    questions.push({ field: 'sender', question: 'Who is this email from? Add at least one contact person under "Contact People" in your Business Brain, so it is signed by a real name and not an invented one.' });
  }
  return questions;
}

/** Everything wrong with the copy that can be found without a model. */
function gateIssues({ subject, html, text }) {
  const issues = [...checkSendableContent({ subject, html, text }, { allowMergeTags: true }).blocking];
  const combined = `${subject}\n${html}\n${text}`;
  const unknown = tokenNames(combined).filter(t => !KNOWN_TOKENS.includes(t));
  if (unknown.length) issues.push(`Merge tag${unknown.length === 1 ? '' : 's'} the send system does not know how to fill: ${unknown.map(t => `{{${t}}}`).join(', ')}`);
  // A tag with no fallback would skip every recipient who lacks that detail.
  const bare = tokensNeedingFallback(combined).filter(t => KNOWN_TOKENS.includes(t));
  if (bare.length) issues.push(`Add a fallback to ${bare.map(t => `{{${t}}}`).join(', ')} (for example {{${bare[0]}|your area}}) so recipients without it are not skipped.`);
  if (!String(subject || '').trim()) issues.push('The subject line is empty.');
  if (!String(html || '').replace(/<[^>]+>/g, '').trim()) issues.push('The email body is empty.');
  return issues;
}

function normalise(draft) {
  return {
    subject: resolveFieldAliases(String(draft.subject || '')).trim(),
    html: resolveFieldAliases(String(draft.html || '')).trim(),
    text: resolveFieldAliases(String(draft.text || '')).trim(),
  };
}

async function runChecks(copy, { campaignName, replyTo, expectedRecipients, language }, deps) {
  const gate = gateIssues(copy);
  let review;
  try {
    review = await deps.review({
      campaignName, replyTo, language, ...copy,
      recipients: Array.from({ length: Math.min(Math.max(0, expectedRecipients | 0), 500) }, () => ({})),
    });
  } catch (e) {
    // A review that could not run is not a pass. Say so rather than
    // returning something that looks reviewed.
    return { approved: false, blockers: [...gate, `Scotty's QA review could not run: ${e.message}`], warnings: [], summary: '', reviewRan: false };
  }
  const blockers = [...gate, ...review.blockers];
  return { approved: blockers.length === 0 && review.approved, blockers, warnings: review.warnings, summary: review.summary, reviewRan: true };
}

/**
 * @param {object} input
 *   offer, ctaUrl?, audience (plain words), senderName?, companyName?,
 *   businessContext?, campaignName?, replyTo?, expectedRecipients?
 * @param {object} [deps] injectable for tests: { draft, review, fix }
 * @returns {Promise<{status: 'needs_input', questions} | {status: 'drafted', subject, html, text, review, fixed, questions, preview}>}
 */
async function buildCampaign(input, deps = {}) {
  const d = {
    draft: deps.draft || (async (args) => {
      const r = await callClaudeForJSON({ system: DRAFT_SYSTEM_PROMPT, user: args.user, tool: DRAFT_TOOL, maxTokens: 1800, timeoutMs: 50000 });
      if (!r.success) throw new Error(r.error);
      return r.data;
    }),
    review: deps.review || reviewCampaign,
    fix: deps.fix || fixCampaign,
  };

  const questions = missingInputs(input);
  if (questions.length) return { status: 'needs_input', questions };

  const user = [
    `Offer (use exactly as described): ${String(input.offer).trim()}`,
    `Who it is going to: ${String(input.audience || 'small local businesses').trim()}`,
    `Link to use: ${String(input.ctaUrl || '').trim() || '(none — invite them to reply instead; include no link)'}`,
    `Sender name: ${String(input.senderName || '').trim() || '(not set)'}`,
    input.senderTitle ? `Sender title: ${String(input.senderTitle).trim()}` : '',
    `Sender company: ${String(input.companyName || '').trim() || '(not set)'}`,
    languageDirective(input.language) || '',
    input.businessContext ? `Background on the sender's business (context only — do not quote statistics from it unless stated here as fact):\n${String(input.businessContext).slice(0, 1200)}` : '',
  ].filter(Boolean).join('\n');

  let copy = normalise(await d.draft({ user }));
  const ctx = { campaignName: input.campaignName, replyTo: input.replyTo, expectedRecipients: input.expectedRecipients, language: input.language };
  let review = await runChecks(copy, ctx, d);
  let fixed = false;
  let fixQuestions = [];

  if (!review.approved && review.reviewRan !== false) {
    // One fix round: rewrite phrasing, never invent a fact; anything needing
    // a real fact comes back as a question for the user.
    try {
      const fix = await d.fix({ ...copy, blockers: review.blockers });
      fixQuestions = fix.questions || [];
      const refreshed = normalise({ subject: fix.fixedSubject, html: fix.fixedHtml, text: fix.fixedText });
      if (refreshed.subject !== copy.subject || refreshed.html !== copy.html || refreshed.text !== copy.text) {
        copy = refreshed;
        fixed = true;
        review = await runChecks(copy, ctx, d);
      }
    } catch { /* the original blockers stand and are reported as-is */ }
  }

  const sample = { firstName: 'Sam', lastName: 'Taylor', company: 'Acme Plumbing', area: 'Austin', website: 'https://example.com', unsubscribe_url: '#' };
  return {
    status: 'drafted',
    ...copy,
    review: { approved: review.approved, blockers: review.blockers, warnings: review.warnings, summary: review.summary },
    fixed,
    questions: fixQuestions,
    preview: { subject: applyMergeFields(copy.subject, sample), html: applyMergeFields(copy.html, sample) },
  };
}

module.exports = { buildCampaign, missingInputs, gateIssues, DRAFT_SYSTEM_PROMPT, DRAFT_TOOL };
