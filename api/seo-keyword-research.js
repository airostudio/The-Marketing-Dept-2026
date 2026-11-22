/**
 * api/seo-keyword-research.js — SEO Pipeline Stage 3a: Topic Proposal
 *
 * POST { profile, competitors, cross_competitor_gaps }
 * Returns: { success, topics: [{ topic, target_keyword, est_search_volume,
 *   est_difficulty, data_source: 'estimate', rationale, content_pillar }] }
 *
 * Does exactly ONE slow external call — Claude proposing topic candidates
 * grounded in the real business profile + real competitor content gaps.
 * The real-data upgrade pass (DataForSEO search volume) used to run in this
 * same function right after this call — chaining Claude's (up to 45s) call
 * with DataForSEO's (up to 15s) in one function shares Vercel's 60s ceiling
 * and can time out, exactly the class of bug already fixed repeatedly in
 * Nancy's pipeline. Split into its own function (seo-keyword-volumes.js)
 * for the same reason as every other two-slow-call split in this app.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
// The prompt and tool live in the shared engine, which SEO Autopilot also uses.
const { proposeTopics } = require('./_lib/seo-engine.js');

module.exports = withFailureReporting('api/seo-keyword-research', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Every path below reaches a paid third party or this server's own crawler
  // on the account's credentials. Identify the caller before spending any of
  // it; a rate limit caps the speed, not the entitlement.
  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'seo-keyword-research', max: 6, windowMs: 60 * 1000, auth })) return;

  const { profile, competitors = [], cross_competitor_gaps = [], language = '' } = req.body || {};
  if (!profile || !profile.business_summary) return res.status(400).json({ error: 'profile (from seo-analyze-site) is required' });

  try {
    const topics = await proposeTopics({ profile, competitors, cross_competitor_gaps, language });
    return res.json({ success: true, topics });
  } catch (err) {
    return res.status(502).json({ success: false, error: err.message });
  }
});
