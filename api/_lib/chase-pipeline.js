/**
 * api/_lib/chase-pipeline.js — Chase's full prospect audit for one website,
 * as a plain function: technology detection + website audit + opportunity
 * score. Shared by the Sales Intelligence endpoint (api/sales-audit-lead.js)
 * and a Scotty mission (api/mission-chase.js), so a lead is scored the same
 * way wherever it is audited.
 *
 * Nothing here is guessed: every score the crawl could not compute stays null
 * (see api/_lib/website-audit.js), and a failed audit is reported as a
 * failure, never as a low score.
 */

'use strict';

const { auditWebsite } = require('./website-audit.js');
const { detectTechnology } = require('./tech-detect.js');
const { calculateOpportunityScore, industryValueTier } = require('./opportunity-score.js');

// Wix, GoDaddy Website Builder, and Squarespace are this feature's
// launch-focus rebuild targets — see api/_lib/tech-detect.js's SIGNATURES
// catalog header. A business already paying monthly for one of these three
// is a proven website *buyer*, just an unhappy one on a template that
// looks like thousands of others — a qualitatively better lead than one
// that's merely stale.
const TARGET_PLATFORMS = new Set(['Wix', 'GoDaddy Website Builder', 'Squarespace']);

/**
 * @param {{url:string, industry?:string, googleRating?:number, googleReviewCount?:number,
 *          hasActiveSocial?:boolean, hasContactInfo?:boolean, pagespeedApiKey?:string}} input
 * @returns {Promise<object>} the lead-intelligence object (same shape the endpoint has always returned)
 */
async function auditProspect(input) {
  const { url, pagespeedApiKey } = input;
  const body = input;
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

  return {
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
  };
}

const TOP_PROBLEMS = 3;
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

/**
 * Audit one mission lead (a Blade shortlist entry or a plain URL). Never
 * throws: a failed audit is recorded in `auditError` and the lead keeps no
 * score at all, which the UI shows differently from a low score so it can be
 * retried rather than read as a verdict. A lead with no website is not
 * audited (there is nothing to audit) and says so.
 *
 * What is kept is a compact summary, not the raw crawl.
 */
async function auditLead(lead, { industry = '', pagespeedApiKey } = {}) {
  const out = { ...lead, audited: true, auditError: null, audit: null };
  if (!lead.website) { out.auditSkipped = 'no_website'; return out; }
  try {
    const r = await auditProspect({
      url: lead.website,
      industry,
      googleRating: typeof lead.rating === 'number' ? lead.rating : undefined,
      googleReviewCount: typeof lead.reviewCount === 'number' ? lead.reviewCount : undefined,
      hasContactInfo: !!lead.email || !!lead.phone,
      pagespeedApiKey,
    });
    const crawled = r.audit && r.audit.scores && !(r.audit.scores._missing && r.audit.scores._missing.length === 6);
    if (!crawled) {
      out.auditError = 'The site could not be crawled.';
      return out;
    }
    out.audit = {
      checkedAt: r.checkedAt,
      platform: r.platform,
      isTargetPlatform: r.isTargetPlatform,
      scores: r.audit.scores,
      topProblems: [...(r.audit.problems || [])]
        .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3))
        .slice(0, TOP_PROBLEMS)
        .map(p => ({ issue: p.issue, severity: p.severity, evidence: p.evidence })),
      opportunity: { score: r.opportunity.score, classification: r.opportunity.classification },
    };
  } catch (e) {
    out.auditError = e.message || 'Audit failed.';
  }
  return out;
}

module.exports = { auditProspect, auditLead, TARGET_PLATFORMS };
