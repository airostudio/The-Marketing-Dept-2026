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
const { auditWebsite } = require('./_lib/website-audit.js');
const { detectTechnology } = require('./_lib/tech-detect.js');
const { calculateOpportunityScore, industryValueTier } = require('./_lib/opportunity-score.js');

// Wix and GoDaddy Website Builder are this feature's launch-focus rebuild
// targets — see api/_lib/tech-detect.js's SIGNATURES catalog header.
const TARGET_PLATFORMS = new Set(['Wix', 'GoDaddy Website Builder']);

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

  const pagespeedApiKey = process.env.GOOGLE_PAGESPEED_API_KEY;

  const [audit, tech] = await Promise.all([
    auditWebsite(url, { pagespeedApiKey }),
    detectTechnology(url),
  ]);

  const technologies = tech.available ? tech.technologies : [];
  // Prefer a target-platform match if one was found; otherwise the
  // highest-confidence detected technology in a platform-shaped category.
  const platformCategories = new Set(['website-builder', 'cms', 'ecommerce']);
  const platformHits = technologies.filter(t => platformCategories.has(t.category));
  const targetHit = platformHits.find(t => TARGET_PLATFORMS.has(t.name));
  const platform = targetHit ? targetHit.name : (platformHits[0] ? platformHits[0].name : null);
  const isTargetPlatform = !!targetHit;

  const tier = industryValueTier(body.industry);

  const opportunity = calculateOpportunityScore({
    platform,
    isTargetPlatform,
    hasWebsite: true,
    auditScores: audit.scores,
    problems: audit.problems,
    googleRating: typeof body.googleRating === 'number' ? body.googleRating : null,
    googleReviewCount: typeof body.googleReviewCount === 'number' ? body.googleReviewCount : null,
    hasActiveSocial: !!body.hasActiveSocial,
    industryValueTier: tier,
    hasContactInfo: !!body.hasContactInfo,
  });

  return res.json({
    success: true,
    url,
    checkedAt: audit.checkedAt,
    platform,
    isTargetPlatform,
    technologyCheck: { available: tech.available, checked: tech.checked, reason: tech.reason },
    technologies,
    industry: body.industry || null,
    industryValueTier: tier,
    audit: {
      scores: audit.scores,
      problems: audit.problems,
    },
    // Extracted from the same homepage crawl the audit already ran — a
    // best-effort palette (never fabricated: null when the page declared no
    // usable colour signal), so a later step like generate-website-mockup.js
    // can offer real brand colours as a default without a caller having to
    // supply their own.
    brandColors: audit.brandColors,
    opportunity,
    raw: audit.raw,
  });
});
