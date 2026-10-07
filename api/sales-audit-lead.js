/**
 * api/sales-audit-lead.js — Webese Prospect Hunter: full lead-intelligence
 * audit for one URL (Chase / Sales Intelligence, Phase 1).
 *
 * POST {
 *   url,                                  // required
 *   industry,                             // optional, passed through from discovery
 *   googleRating, googleReviewCount,      // optional, from Google Places (already fetched by Chase)
 *   hasActiveSocial, hasContactInfo,      // optional booleans, from earlier enrichment steps
 * }
 *
 * Returns a single consolidated lead-intelligence object combining:
 *   - technology detection (Wix/GoDaddy/etc, api/_lib/tech-detect.js)
 *   - a full website audit (api/_lib/website-audit.js — SEO/mobile/
 *     conversion/content/local-SEO + PageSpeed performance, all honestly
 *     null where the input to compute them was unavailable)
 *   - an opportunity score + classification (api/_lib/opportunity-score.js)
 *
 * This endpoint only handles the URL-audit side of a lead. Business/
 * location/discovery fields (name, city, country, Google Places rating,
 * etc.) are the caller's own — Chase's existing Google Places/Perplexity
 * discovery pipeline already supplies those — so this endpoint receives
 * them as plain inputs to the scoring model rather than looking them up
 * again itself.
 *
 * This is a genuinely expensive call (a bounded site crawl + tech-detect
 * fetch + a PageSpeed Insights run), so it is rate limited more tightly
 * than a cheap lookup.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { auditProspect } = require('./_lib/chase-pipeline.js');

module.exports = withFailureReporting('api/sales-audit-lead', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // This runs a real site crawl and calls the account's own PageSpeed
  // credentials. Identify the caller before spending any of it.
  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'sales-audit-lead', max: 10, windowMs: 60 * 1000, auth })) return;

  const body = req.body || {};
  const url = body.url && String(body.url).trim();
  if (!url) return res.status(400).json({ error: 'url is required' });

  const result = await auditProspect({
    url,
    industry: body.industry,
    googleRating: body.googleRating,
    googleReviewCount: body.googleReviewCount,
    hasActiveSocial: body.hasActiveSocial,
    hasContactInfo: body.hasContactInfo,
    pagespeedApiKey: process.env.GOOGLE_PAGESPEED_API_KEY,
  });
  return res.json(result);
});
