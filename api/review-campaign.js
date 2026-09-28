/**
 * api/review-campaign.js — Scotty's pre-send QA pass, moved server-side.
 *
 * Previously this ran entirely client-side in web/js/email-delivery-
 * service.js's reviewWithScotty(): a freehand text completion via
 * window.ClaudeService.streamResponse(), asked to "Respond ONLY with valid
 * JSON", parsed with a bare regex + JSON.parse(). That fails exactly the way
 * it was reported to: "Unterminated string in JSON at position 250" — the
 * prompt echoes the campaign's own subject/HTML/text back into the model's
 * context and asks it to freehand a JSON blob that may quote or reference
 * that content, and nothing enforced the model actually escaping a literal
 * quote or newline it decided to include in a string field. A model that
 * gets this right 99% of the time still eventually produces "almost JSON",
 * and the failure mode was an opaque parse error instead of a review.
 *
 * This uses the same forced-tool-call pattern already established for every
 * other structured Claude call in this codebase (api/_lib/nancy-claude.js,
 * used by api/seo-outreach-draft.js and others): the schema is enforced by
 * Anthropic's own tool-use encoding, not by hoping the model's raw text
 * happens to be parseable. That doesn't just reduce the failure rate — it
 * removes "the model wrote malformed JSON" as a failure mode entirely; the
 * only remaining way callClaudeForJSON() can fail to parse is a genuine
 * max_tokens cutoff, which it already reports distinctly.
 *
 * POST { campaignName, recipients, replyTo, subject, html, text }
 * Returns: { approved, blockers: string[], warnings: string[], summary }
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { callClaudeForJSON } = require('./_lib/nancy-claude.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

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

module.exports = withFailureReporting('api/review-campaign', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'review-campaign', max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, auth })) return;

  const { campaignName, recipients, replyTo, subject, html, text } = req.body || {};
  if (!subject || !html) return res.status(400).json({ error: 'subject and html are required' });

  const recipientList = Array.isArray(recipients) ? recipients : [];
  const recipientSample = recipientList.slice(0, 5).map((r) => r && r.to).filter(Boolean).join(', ');
  const mergeTokensUsed = Array.from(new Set(
    (`${subject}\n${html}`.match(/\{\{\s*([\w.]+)\s*\}\}/g) || [])
      .map((t) => t.replace(/[{}]/g, '').trim())
  ));

  const user = `Campaign: ${campaignName || '(untitled)'}
Recipient count: ${recipientList.length}
Recipient sample: ${recipientSample || '(none provided)'}
Merge tokens found in copy: ${mergeTokensUsed.join(', ') || '(none)'}
Reply-to: ${replyTo || '(not set)'}

Subject: ${subject}

HTML body:
${html}

${text ? `Plain text body:\n${text}` : ''}`;

  const result = await callClaudeForJSON({ system: SYSTEM_PROMPT, user, tool: REVIEW_TOOL, maxTokens: 1500 });
  if (!result.success) return res.status(502).json({ error: result.error });

  const parsed = result.data || {};
  return res.json({
    approved: !!parsed.approved && (!parsed.blockers || parsed.blockers.length === 0),
    blockers: Array.isArray(parsed.blockers) ? parsed.blockers : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    summary: parsed.summary || '',
  });
});
