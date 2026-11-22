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
const { reviewCampaign } = require('./_lib/campaign-review.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

module.exports = withFailureReporting('api/review-campaign', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'review-campaign', max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, auth })) return;

  const { campaignName, recipients, replyTo, subject, html, text, language } = req.body || {};
  if (!subject || !html) return res.status(400).json({ error: 'subject and html are required' });

  try {
    return res.json(await reviewCampaign({ campaignName, recipients, replyTo, subject, html, text, language }));
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
});
