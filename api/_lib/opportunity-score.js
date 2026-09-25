/**
 * api/_lib/opportunity-score.js — configurable prospect-scoring model for
 * the Webese Prospect Hunter (Chase / Sales Intelligence, Phase 1).
 *
 * Not a Vercel route; api/_lib/ is excluded from routing.
 *
 * ── Design ────────────────────────────────────────────────────────────────
 *
 * Every weight lives in DEFAULT_WEIGHTS, named and documented, rather than
 * as a magic number inline in calculateOpportunityScore() — the point is
 * that an admin settings UI (not built in this phase) can hand this
 * function an overridden weights object with no change to the scoring
 * logic itself.
 *
 * The single most important behavioral property of this model (per spec):
 * a good, established business with a weak website is a BETTER prospect
 * than a struggling business with an equally weak website — the weak
 * website is the opportunity either way, but a proven business is more
 * likely to have the budget and appetite to fix it. Google rating/review
 * count and industry value tier both weight in that direction, and never
 * negatively — a business is never penalized for lacking review data we
 * simply could not find, only rewarded when it is verified good.
 *
 * `breakdown` exists so a salesperson can see WHY a lead scored the way it
 * did — every entry names real points tied to real input data, never a
 * vague "general fit" line with nothing behind it.
 */

'use strict';

/**
 * Every weight this model uses, in one place, overridable as a whole object.
 * Values are point contributions on a roughly-0-100 scale; the model clamps
 * the final total regardless, so a customized weight set cannot overflow it.
 */
const DEFAULT_WEIGHTS = {
  // Base score every prospect starts from.
  BASE_SCORE: 40,

  // Platform fit — is this exactly the kind of easy-migration site the
  // pitch targets (Wix/GoDaddy Website Builder)?
  TARGET_PLATFORM_BONUS: 15,          // isTargetPlatform === true
  NON_TARGET_KNOWN_PLATFORM_BONUS: 5, // a known platform, just not the primary target (e.g. Squarespace)
  UNKNOWN_PLATFORM_BONUS: 0,          // could not detect any platform — no bonus, no penalty

  // Website audit quality — the WORSE the site, the bigger the opportunity,
  // so this is scored inversely: a low audit average adds points here.
  AUDIT_WEAKNESS_MAX_BONUS: 20,       // full bonus at audit average score 0
  PROBLEM_COUNT_POINTS: 2,            // per problem found, up to the cap below
  PROBLEM_COUNT_MAX_BONUS: 10,
  HIGH_SEVERITY_PROBLEM_POINTS: 3,    // extra per 'high' severity problem, up to the cap below
  HIGH_SEVERITY_PROBLEM_MAX_BONUS: 9,

  // Business health signals — a real, reviewed, active business is a
  // stronger prospect regardless of its website's condition.
  GOOGLE_RATING_MAX_BONUS: 10,        // scaled by (rating / 5), only when reviews exist
  GOOGLE_REVIEW_VOLUME_MAX_BONUS: 10, // scaled by review-count tiers, see reviewVolumeBonus()
  ACTIVE_SOCIAL_BONUS: 5,
  CONTACT_INFO_BONUS: 5,

  // Industry value tier — some verticals have materially higher deal value
  // and faster sales cycles for a website-rebuild pitch.
  INDUSTRY_HIGH_BONUS: 10,
  INDUSTRY_MEDIUM_BONUS: 5,
  INDUSTRY_LOW_PENALTY: -10,
  INDUSTRY_UNKNOWN_BONUS: 0,          // unknown is neutral, never guessed as a tier

  // Disqualifiers — real red flags that should pull a score down hard
  // regardless of everything else.
  NO_WEBSITE_AT_ALL_PENALTY: -15,     // this feature is a rebuild pitch; no site is a different pitch entirely
  VERY_LOW_RATING_PENALTY: -15,       // rating present and below this threshold is a warning sign, not an opportunity
  VERY_LOW_RATING_THRESHOLD: 2.5,
};

/**
 * Classification thresholds, in points. Every boundary is inclusive on its
 * lower end and exclusive on the next tier's, e.g. 90 is 'exceptional',
 * 89 is 'high_priority'.
 */
const CLASSIFICATION_THRESHOLDS = [
  { min: 90, classification: 'exceptional' },
  { min: 80, classification: 'high_priority' },
  { min: 70, classification: 'strong_prospect' },
  { min: 60, classification: 'potential_prospect' },
  { min: 50, classification: 'low_priority' },
  { min: 0, classification: 'do_not_contact' },
];

/** Curated industry -> value tier table (spec section 29). Unknown industries
 *  are never guessed into a tier — see industryValueTier() below. */
const INDUSTRY_TIERS = {
  high: ['roofing', 'hvac', 'solar', 'legal', 'law', 'attorney', 'mortgage', 'construction', 'general contractor', 'dental', 'dentist'],
  medium: ['plumbing', 'electrical', 'electrician', 'landscaping', 'physiotherapy', 'physio', 'automotive', 'auto repair'],
  low: ['cafe', 'coffee shop', 'retail', 'hobby', 'gift shop', 'convenience store'],
};

/**
 * Look up a curated industry value tier.
 *
 * @param {string|null|undefined} industry free-text industry/category label
 * @returns {'high'|'medium'|'low'|null} null for an unrecognized industry —
 *   deliberately NOT a guessed tier; calculateOpportunityScore() treats null
 *   as neutral (INDUSTRY_UNKNOWN_BONUS), never as 'low'.
 */
function industryValueTier(industry) {
  if (!industry) return null;
  const s = String(industry).trim().toLowerCase();
  if (!s) return null;
  for (const tier of ['high', 'medium', 'low']) {
    if (INDUSTRY_TIERS[tier].some(keyword => s.includes(keyword))) return tier;
  }
  return null;
}

/** Review-count -> bonus tiers. More reviews is a stronger "real, established
 *  business" signal, with diminishing returns. */
function reviewVolumeBonus(reviewCount, maxBonus) {
  if (!reviewCount || reviewCount <= 0) return 0;
  if (reviewCount >= 100) return maxBonus;
  if (reviewCount >= 50) return maxBonus * 0.75;
  if (reviewCount >= 20) return maxBonus * 0.5;
  if (reviewCount >= 5) return maxBonus * 0.25;
  return maxBonus * 0.1;
}

function classify(score) {
  for (const tier of CLASSIFICATION_THRESHOLDS) {
    if (score >= tier.min) return tier.classification;
  }
  return 'do_not_contact';
}

/** Average of the numeric (non-null) values in an audit scores object. */
function auditAverage(auditScores) {
  if (!auditScores) return null;
  const vals = Object.entries(auditScores)
    .filter(([k, v]) => !k.startsWith('_') && typeof v === 'number')
    .map(([, v]) => v);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * Score a prospect.
 *
 * @param {object} input
 * @param {string|null} [input.platform]              detected platform name, if any
 * @param {boolean} [input.isTargetPlatform]           Wix / GoDaddy Website Builder
 * @param {object|null} [input.auditScores]            website-audit.js's `scores` object
 * @param {object[]} [input.problems]                  website-audit.js's `problems` array
 * @param {number|null} [input.googleRating]
 * @param {number|null} [input.googleReviewCount]
 * @param {boolean} [input.hasActiveSocial]
 * @param {'high'|'medium'|'low'|null} [input.industryValueTier]
 * @param {boolean} [input.hasContactInfo]
 * @param {boolean} [input.hasWebsite]                 defaults true; set false for "no website" prospects
 * @param {object} [weights] override of DEFAULT_WEIGHTS
 * @returns {{score: number, breakdown: {factor: string, points: number, reason: string}[], classification: string}}
 */
function calculateOpportunityScore(input = {}, weights = DEFAULT_WEIGHTS) {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const breakdown = [];
  let total = w.BASE_SCORE;
  breakdown.push({ factor: 'Base score', points: w.BASE_SCORE, reason: 'Starting point for every prospect' });

  // ── Platform fit ─────────────────────────────────────────────────────────
  if (input.hasWebsite === false) {
    total += w.NO_WEBSITE_AT_ALL_PENALTY;
    breakdown.push({ factor: 'No website found', points: w.NO_WEBSITE_AT_ALL_PENALTY, reason: 'This pitch targets an existing website to rebuild; no website changes the pitch entirely' });
  } else if (input.isTargetPlatform) {
    total += w.TARGET_PLATFORM_BONUS;
    breakdown.push({ factor: 'On a target platform', points: w.TARGET_PLATFORM_BONUS, reason: `Detected platform "${input.platform}" is a primary rebuild-pitch target (Wix / GoDaddy Website Builder)` });
  } else if (input.platform) {
    total += w.NON_TARGET_KNOWN_PLATFORM_BONUS;
    breakdown.push({ factor: 'On a known (non-primary) platform', points: w.NON_TARGET_KNOWN_PLATFORM_BONUS, reason: `Detected platform "${input.platform}" is a website builder/CMS, just not the primary target` });
  } else {
    breakdown.push({ factor: 'Platform not detected', points: w.UNKNOWN_PLATFORM_BONUS, reason: 'No known platform signature matched — neither a bonus nor a penalty' });
  }

  // ── Website audit weakness (worse site = bigger opportunity) ────────────
  const avg = auditAverage(input.auditScores);
  if (avg !== null) {
    const weaknessBonus = Math.round(w.AUDIT_WEAKNESS_MAX_BONUS * ((100 - avg) / 100));
    total += weaknessBonus;
    breakdown.push({ factor: 'Website audit weakness', points: weaknessBonus, reason: `Average audit score across measured categories is ${Math.round(avg)}/100 — the weaker the site, the bigger the rebuild opportunity` });
  }

  const problems = Array.isArray(input.problems) ? input.problems : [];
  if (problems.length) {
    const countBonus = Math.min(problems.length * w.PROBLEM_COUNT_POINTS, w.PROBLEM_COUNT_MAX_BONUS);
    total += countBonus;
    breakdown.push({ factor: 'Website problems identified', points: countBonus, reason: `${problems.length} concrete issue(s) found on the site during the audit` });

    const highCount = problems.filter(p => p.severity === 'high').length;
    if (highCount) {
      const highBonus = Math.min(highCount * w.HIGH_SEVERITY_PROBLEM_POINTS, w.HIGH_SEVERITY_PROBLEM_MAX_BONUS);
      total += highBonus;
      breakdown.push({ factor: 'High-severity problems', points: highBonus, reason: `${highCount} of those issue(s) are high severity` });
    }
  }

  // ── Business health signals ──────────────────────────────────────────────
  if (typeof input.googleRating === 'number' && input.googleRating > 0) {
    if (input.googleRating < w.VERY_LOW_RATING_THRESHOLD) {
      total += w.VERY_LOW_RATING_PENALTY;
      breakdown.push({ factor: 'Very low Google rating', points: w.VERY_LOW_RATING_PENALTY, reason: `Google rating of ${input.googleRating} is below ${w.VERY_LOW_RATING_THRESHOLD} — a real reputation risk, not just an opportunity` });
    } else {
      const ratingBonus = Math.round(w.GOOGLE_RATING_MAX_BONUS * (input.googleRating / 5));
      total += ratingBonus;
      breakdown.push({ factor: 'Google rating', points: ratingBonus, reason: `Verified Google rating of ${input.googleRating}/5 indicates an established, well-regarded business` });
    }
  }

  if (typeof input.googleReviewCount === 'number' && input.googleReviewCount > 0) {
    const volBonus = Math.round(reviewVolumeBonus(input.googleReviewCount, w.GOOGLE_REVIEW_VOLUME_MAX_BONUS));
    if (volBonus) {
      total += volBonus;
      breakdown.push({ factor: 'Google review volume', points: volBonus, reason: `${input.googleReviewCount} Google reviews on file — more reviews signals a more established, higher-traffic business` });
    }
  }

  if (input.hasActiveSocial) {
    total += w.ACTIVE_SOCIAL_BONUS;
    breakdown.push({ factor: 'Active social presence', points: w.ACTIVE_SOCIAL_BONUS, reason: 'Business has an active, discoverable social media presence' });
  }

  if (input.hasContactInfo) {
    total += w.CONTACT_INFO_BONUS;
    breakdown.push({ factor: 'Verified contact info', points: w.CONTACT_INFO_BONUS, reason: 'Real contact information (phone/email) was found for this business' });
  }

  // ── Industry value tier ──────────────────────────────────────────────────
  const tier = input.industryValueTier;
  if (tier === 'high') {
    total += w.INDUSTRY_HIGH_BONUS;
    breakdown.push({ factor: 'High-value industry', points: w.INDUSTRY_HIGH_BONUS, reason: 'Industry is in the high-value tier (e.g. roofing, HVAC, solar, legal, mortgage, construction, dental) — typically higher deal value and faster close' });
  } else if (tier === 'medium') {
    total += w.INDUSTRY_MEDIUM_BONUS;
    breakdown.push({ factor: 'Medium-value industry', points: w.INDUSTRY_MEDIUM_BONUS, reason: 'Industry is in the medium-value tier (e.g. plumbing, electrical, landscaping, physio, automotive)' });
  } else if (tier === 'low') {
    total += w.INDUSTRY_LOW_PENALTY;
    breakdown.push({ factor: 'Low-value industry', points: w.INDUSTRY_LOW_PENALTY, reason: 'Industry is in the low-value tier (e.g. small cafes, low-ticket retail, hobby shops) — typically lower deal value' });
  } else {
    breakdown.push({ factor: 'Industry not classified', points: w.INDUSTRY_UNKNOWN_BONUS, reason: 'Industry is unknown or not in the curated tier table — treated as neutral, not guessed' });
  }

  const score = Math.max(0, Math.min(100, Math.round(total)));
  return { score, breakdown, classification: classify(score) };
}

module.exports = {
  DEFAULT_WEIGHTS,
  CLASSIFICATION_THRESHOLDS,
  INDUSTRY_TIERS,
  calculateOpportunityScore,
  industryValueTier,
};
