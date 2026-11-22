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
const { fixCampaign } = require('./_lib/campaign-review.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

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

  try {
    return res.json(await fixCampaign({ subject, html, text, blockers }));
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
});
