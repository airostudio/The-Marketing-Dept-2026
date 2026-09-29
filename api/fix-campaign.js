/**
 * api/fix-campaign.js — when Scotty blocks a campaign, have it try to fix
 * what it safely can, and ask for whatever it genuinely can't.
 *
 * Before this, a blocked campaign left the human with exactly two options:
 * go edit the raw HTML by hand ("Fix Campaign"), or click past the block
 * entirely ("Send Anyway (Override)"). Most of what Scotty flags — spam-
 * trigger phrasing, an overstated claim, a stray "!!!" — is copy Scotty can
 * safely rewrite itself; a much smaller set (a real URL, a real customer
 * example, a real statistic) is content nobody but the sender has.
 *
 * The prompt draws that line explicitly and is checked server-side, not
 * just asked nicely: fixedHtml/fixedSubject may rewrite TONE and PHRASING,
 * never invent a fact. Anything requiring a real fact comes back as a
 * `questions` entry instead — same {snippet, question} shape Pat's existing
 * placeholder-fill UI already uses (see applyPlaceholderFixes() in
 * email-delivery-agent.html), so answering one is the same one-click flow
 * as filling in a bracket placeholder, not a second UI to learn.
 *
 * Uses the same forced-tool-call pattern as api/review-campaign.js
 * (api/_lib/nancy-claude.js's callClaudeForJSON) — Anthropic's tool-use
 * encoding produces the JSON, not the model's raw text, so this can't fail
 * with a freehand JSON parse error the way the old client-side review did.
 *
 * POST { subject, html, text, blockers: string[] }
 * Returns: { fixedSubject, fixedHtml, fixedText, resolvedBlockers: string[],
 *   questions: [{ snippet, question }] }
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { callClaudeForJSON } = require('./_lib/nancy-claude.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

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

const SYSTEM_PROMPT = `You are Scotty, the AI CMO, fixing what you safely can in a blocked email campaign before asking the sender for help.

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

module.exports = withFailureReporting('api/fix-campaign', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'fix-campaign', max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, auth })) return;

  const { subject, html, text, blockers } = req.body || {};
  if (!subject || !html) return res.status(400).json({ error: 'subject and html are required' });
  if (!Array.isArray(blockers) || !blockers.length) return res.status(400).json({ error: 'blockers must be a non-empty array' });

  const user = `Subject: ${subject}

HTML body:
${html}

${text ? `Plain text body:\n${text}` : '(no plain-text body)'}

Blockers a QA review found:
${blockers.map((b, i) => `${i + 1}. ${b}`).join('\n')}`;

  const result = await callClaudeForJSON({ system: SYSTEM_PROMPT, user, tool: FIX_TOOL, maxTokens: 3000 });
  if (!result.success) return res.status(502).json({ error: result.error });

  const parsed = result.data || {};
  return res.json({
    fixedSubject: parsed.fixedSubject || subject,
    fixedHtml: parsed.fixedHtml || html,
    fixedText: parsed.fixedText || text || '',
    resolvedBlockers: Array.isArray(parsed.resolvedBlockers) ? parsed.resolvedBlockers : [],
    questions: Array.isArray(parsed.questions)
      ? parsed.questions.filter((q) => q && typeof q.question === 'string' && q.question.trim())
      : [],
  });
});
