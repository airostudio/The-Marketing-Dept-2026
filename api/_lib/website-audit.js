/**
 * api/_lib/website-audit.js — full website audit orchestrator for the
 * Webese Prospect Hunter (Chase / Sales Intelligence, Phase 1).
 *
 * Not a Vercel route; api/_lib/ is excluded from routing.
 *
 * Combines:
 *   - a bounded crawl of the homepage (api/_lib/nancy-crawl.js — the same
 *     SSRF-safe fetcher every other tool in this codebase uses)
 *   - deterministic regex checks against that HTML (SEO / mobile /
 *     conversion / content / a heuristic local-SEO pass)
 *   - technology detection (api/_lib/tech-detect.js)
 *   - Google PageSpeed Insights, via the same client api/pagespeed.js uses
 *     (api/_lib/pagespeed-client.js), for the performance score
 *
 * ── The one rule that matters most here ─────────────────────────────────
 *
 * This codebase already fixed exactly this class of bug once (seo-pulse.html
 * fabricating a 15/100 when PageSpeed failed). Every score in `scores` is
 * computed ONLY from inputs that actually succeeded; a category with no
 * usable input is `null`, never a guessed number, and its name is listed in
 * `scores._partial` (or `scores._missing` when nothing at all could be
 * computed for it) so a caller can render "not enough data" instead of
 * treating null-that-got-coerced-to-0 as a real score.
 */

'use strict';

const { crawlSite } = require('./nancy-crawl.js');
const { detectTechnology, matchSignatures, shapeHeaders } = require('./tech-detect.js');
const { fetchPageSpeed } = require('./pagespeed-client.js');
const { safeFetch } = require('./safe-fetch.js');
const { extractColours } = require('./nancy-colours.js');

const CURRENT_YEAR = new Date().getFullYear();
const STALE_COPYRIGHT_YEARS = 2;

const VIEWPORT_RE = /<meta[^>]+name=["']viewport["']/i;
const TITLE_RE = /<title[^>]*>([^<]*)<\/title>/i;
const META_DESC_RE = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i;
const CANONICAL_RE = /<link[^>]+rel=["']canonical["']/i;
const H1_RE = /<h1\b[^>]*>/gi;
const OG_RE = /<meta[^>]+property=["']og:[a-z:]+["']/gi;
const LOCAL_BUSINESS_SCHEMA_RE = /"@type"\s*:\s*"(?:[A-Za-z]+\/)?LocalBusiness"|itemtype=["'][^"']*schema\.org\/LocalBusiness["']/i;
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const IMG_ALT_RE = /\balt\s*=\s*["'][^"']*["']/i;
const TEL_LINK_RE = /href\s*=\s*["']tel:/i;
const FORM_RE = /<form\b/i;
const BOOKING_RE = /\b(book\s+(a\s+)?(appointment|now|consult|demo|call)|get\s+a\s+quote|free\s+quote|request\s+(a\s+)?quote|schedule\s+(a\s+)?(consult|call|appointment))\b/i;
const COPYRIGHT_RE = /(?:©|&copy;|copyright)\s*(?:\d{4}\s*-\s*)?(\d{4})/i;
// Heuristic NAP (Name/Address/Phone) presence — a phone-number-shaped string
// plus something that looks like a street address token. Deliberately loose;
// callers get 'low' confidence on this one, see buildLocalSeo() below.
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;
const ADDRESS_HINT_RE = /\b\d{1,6}\s+[A-Za-z0-9.'\s]{2,40}\b(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|suite|ste\.?)\b/i;
const SERVICE_AREA_RE = /\b(serving|service area|we serve|proudly serving|areas we serve|serving the .*(area|region|county))\b/i;

/** Clamp to the 0-100 range and round to a whole number. */
function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Build the SEO score + any problems, from raw HTML alone.
 * Every deduction has a matching problems[] entry with real evidence.
 */
function auditSeo(html) {
  const problems = [];
  let points = 100;

  const titleMatch = html.match(TITLE_RE);
  const title = titleMatch ? titleMatch[1].trim() : '';
  if (!title) {
    points -= 20;
    problems.push({ issue: 'Missing page title', severity: 'high', evidence: 'No <title> tag found in the homepage HTML', potentialImpact: 'Search engines and browser tabs show no descriptive title, hurting click-through from search results', recommendation: 'Add a concise, descriptive <title> tag (50-60 characters)' });
  } else if (title.length < 10 || title.length > 70) {
    points -= 8;
    problems.push({ issue: 'Page title is an unusual length', severity: 'low', evidence: `<title> is ${title.length} characters: "${title.slice(0, 80)}"`, potentialImpact: 'Very short or very long titles are often truncated or under-optimized in search results', recommendation: 'Aim for a title between roughly 50-60 characters' });
  }

  const descMatch = html.match(META_DESC_RE);
  const desc = descMatch ? descMatch[1].trim() : '';
  if (!desc) {
    points -= 15;
    problems.push({ issue: 'Missing meta description', severity: 'medium', evidence: 'No <meta name="description"> tag found', potentialImpact: 'Search engines generate their own snippet, which is often less compelling and lowers click-through', recommendation: 'Add a meta description (roughly 120-160 characters) summarizing the page' });
  }

  const h1Matches = html.match(H1_RE) || [];
  if (h1Matches.length === 0) {
    points -= 15;
    problems.push({ issue: 'No H1 heading found', severity: 'medium', evidence: 'No <h1> tag found in the homepage HTML', potentialImpact: 'Missing a clear primary heading makes it harder for search engines to understand the page topic', recommendation: 'Add exactly one <h1> that states the primary topic/offer of the page' });
  } else if (h1Matches.length > 1) {
    points -= 5;
    problems.push({ issue: 'Multiple H1 headings found', severity: 'low', evidence: `Found ${h1Matches.length} <h1> tags on the homepage`, potentialImpact: 'Multiple top-level headings can dilute the page\'s topical focus for search engines', recommendation: 'Use a single <h1> per page; demote the others to <h2>/<h3>' });
  }

  if (!CANONICAL_RE.test(html)) {
    points -= 5;
    problems.push({ issue: 'No canonical tag', severity: 'low', evidence: 'No <link rel="canonical"> tag found', potentialImpact: 'Without a canonical URL, duplicate-content variants (with/without trailing slash, query params) can split search ranking signals', recommendation: 'Add a <link rel="canonical"> pointing at the preferred URL for this page' });
  }

  if (!LOCAL_BUSINESS_SCHEMA_RE.test(html)) {
    points -= 10;
    problems.push({ issue: 'No LocalBusiness structured data', severity: 'medium', evidence: 'No JSON-LD or microdata @type LocalBusiness schema found in the homepage HTML', potentialImpact: 'Local businesses without structured data are less likely to be picked up for rich results and local search panels', recommendation: 'Add JSON-LD LocalBusiness schema with name, address, phone, and hours' });
  }

  const ogMatches = html.match(OG_RE) || [];
  if (ogMatches.length === 0) {
    points -= 5;
    problems.push({ issue: 'No OpenGraph tags', severity: 'low', evidence: 'No <meta property="og:*"> tags found', potentialImpact: 'Links shared on social media/messaging apps show no preview image or description', recommendation: 'Add og:title, og:description, and og:image meta tags' });
  }

  const imgTags = html.match(IMG_TAG_RE) || [];
  if (imgTags.length > 0) {
    const withAlt = imgTags.filter(tag => IMG_ALT_RE.test(tag)).length;
    const ratio = withAlt / imgTags.length;
    if (ratio < 0.7) {
      points -= 5;
      problems.push({ issue: 'Many images missing alt text', severity: 'low', evidence: `${withAlt} of ${imgTags.length} <img> tags on the homepage have an alt attribute`, potentialImpact: 'Missing alt text hurts accessibility and image-search visibility', recommendation: 'Add descriptive alt text to every meaningful image' });
    }
  }

  return { score: clampScore(points), problems };
}

function auditMobile(html) {
  const problems = [];
  const hasViewport = VIEWPORT_RE.test(html);
  if (!hasViewport) {
    problems.push({ issue: 'No mobile viewport tag', severity: 'high', evidence: 'No <meta name="viewport"> tag found in the homepage HTML', potentialImpact: 'The page is likely to render zoomed-out and hard to use on phones, where most local searches happen', recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">' });
  }
  return { score: clampScore(hasViewport ? 100 : 30), problems };
}

function auditConversion(html) {
  const problems = [];
  let points = 100;

  const hasTel = TEL_LINK_RE.test(html);
  if (!hasTel) {
    points -= 25;
    problems.push({ issue: 'No click-to-call phone link', severity: 'medium', evidence: 'No href="tel:" link found in the homepage HTML', potentialImpact: 'Mobile visitors have to manually copy/dial the number instead of tapping to call', recommendation: 'Add a tel: link on the phone number, e.g. <a href="tel:+15551234567">' });
  }

  const hasForm = FORM_RE.test(html);
  const hasBooking = BOOKING_RE.test(html);
  if (!hasForm && !hasBooking) {
    points -= 30;
    problems.push({ issue: 'No contact form or booking/quote call-to-action', severity: 'high', evidence: 'No <form> tag and no booking/quote-request language found on the homepage', potentialImpact: 'Visitors ready to convert have no clear low-friction next step', recommendation: 'Add a short contact/quote-request form or a prominent "Book Now" / "Get a Quote" CTA' });
  }

  const liveChatHit = matchSignatures(html, shapeHeaders(new Headers())).find(t => t.category === 'live-chat');
  if (!liveChatHit) {
    points -= 10;
    problems.push({ issue: 'No live chat widget detected', severity: 'low', evidence: 'No known live-chat signature (Intercom, Drift, Tawk.to) found in the homepage HTML', potentialImpact: 'Visitors with quick questions have no immediate way to get an answer, and may leave instead of converting', recommendation: 'Consider adding a live-chat widget for real-time visitor questions' });
  }

  return { score: clampScore(points), problems };
}

function auditContent(html) {
  const problems = [];
  let points = 100;

  const m = html.match(COPYRIGHT_RE);
  if (m) {
    const year = parseInt(m[1], 10);
    if (year >= 1995 && year <= CURRENT_YEAR && CURRENT_YEAR - year >= STALE_COPYRIGHT_YEARS) {
      points -= 20;
      problems.push({ issue: 'Outdated copyright year', severity: 'low', evidence: `Footer copyright reads ${year}, which is ${CURRENT_YEAR - year} years old`, potentialImpact: 'Signals to visitors that the site is not actively maintained', recommendation: `Update the footer copyright year to ${CURRENT_YEAR}` });
    }
  }

  return { score: clampScore(points), problems };
}

/**
 * Local SEO is the softest of these checks — a regex cannot really know
 * whether a business's name/address/phone are consistently presented, only
 * whether something shaped like an address/phone appears at all. Labeled
 * with an explicit confidence so a caller does not over-claim precision it
 * does not have.
 */
function auditLocalSeo(html) {
  const problems = [];
  let points = 100;

  const hasPhone = PHONE_RE.test(html);
  const hasAddressHint = ADDRESS_HINT_RE.test(html);
  const hasServiceArea = SERVICE_AREA_RE.test(html);

  if (!hasPhone) {
    points -= 30;
    problems.push({ issue: 'No phone number detected on the homepage', severity: 'medium', evidence: 'No phone-number-shaped text found in the homepage HTML', potentialImpact: 'Local customers expect to find a phone number immediately', recommendation: 'Display the business phone number prominently, ideally in the header/footer' });
  }
  if (!hasAddressHint) {
    points -= 25;
    problems.push({ issue: 'No street address detected on the homepage', severity: 'medium', evidence: 'No address-shaped text (street/avenue/road/suite, etc.) found in the homepage HTML', potentialImpact: 'A missing on-page address weakens local-search relevance and trust signals', recommendation: 'Display the full business address, matching Google Business Profile exactly' });
  }
  if (!hasServiceArea) {
    points -= 10;
    problems.push({ issue: 'No service-area language detected', severity: 'low', evidence: 'No "serving [area]" style language found in the homepage HTML', potentialImpact: 'Local-intent searchers get a weaker relevance signal for the areas actually served', recommendation: 'Add a line naming the specific cities/regions served' });
  }

  return { score: clampScore(points), problems, confidence: 'low' /* heuristic, not a verified NAP audit */ };
}

/**
 * Run the full audit.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.pagespeedApiKey] GOOGLE_PAGESPEED_API_KEY
 * @returns {Promise<object>} see file header / task spec for exact shape
 */
async function auditWebsite(url, opts = {}) {
  const { pagespeedApiKey } = opts;
  const checkedAt = new Date().toISOString();

  let crawl;
  try {
    crawl = await crawlSite(url);
  } catch (err) {
    // Nothing at all could be fetched — every score is null, honestly.
    return {
      url, checkedAt,
      scores: {
        performance: null, mobile: null, seo: null,
        localSeo: null, conversion: null, content: null,
        _missing: ['performance', 'mobile', 'seo', 'localSeo', 'conversion', 'content'],
      },
      problems: [{ issue: 'Site could not be crawled', severity: 'high', evidence: err.message, potentialImpact: 'No audit data could be gathered at all', recommendation: 'Verify the URL is correct and the site is publicly reachable' }],
      raw: { pagespeed: null, technologies: [] },
      brandColors: null,
    };
  }

  const html = crawl.homepageHtml || '';
  const partial = [];

  // Piggybacks on the crawl this function already did for the HTML checks
  // above — no second fetch. Low-risk, since it only reads the homepage
  // markup/CSS this function already has in memory; a lead with no usable
  // colour signal just gets brandColors:null rather than an invented palette.
  const brandColors = html
    ? (() => {
        const c = extractColours(html, crawl.homepageCss);
        const swatch = [c.primary, ...c.secondary, ...c.accent].filter(Boolean);
        return swatch.length ? swatch.slice(0, 5) : null;
      })()
    : null;

  const seo = html ? auditSeo(html) : null;
  const mobile = html ? auditMobile(html) : null;
  const conversion = html ? auditConversion(html) : null;
  const content = html ? auditContent(html) : null;
  const localSeo = html ? auditLocalSeo(html) : null;
  if (!html) partial.push('seo', 'mobile', 'conversion', 'content', 'localSeo');

  // Technology detection — reuse the crawl's own fetch cost is avoidable, but
  // simplicity and independent testability win here (see task notes): a
  // second bounded fetch of the homepage is cheap relative to the crawl and
  // PageSpeed calls this function already makes.
  let technologies = [];
  try {
    const tech = await detectTechnology(url);
    if (tech.available) technologies = tech.technologies;
  } catch { /* tech-detect never throws in practice; defensive only */ }

  // PageSpeed — the fabrication bug this must never repeat. No key, or the
  // call fails: performance stays null, with a note, never a guessed number.
  let pagespeedRaw = null;
  let performanceScore = null;
  if (!pagespeedApiKey) {
    partial.push('performance');
  } else {
    try {
      const { data } = await fetchPageSpeed(url, 'mobile', pagespeedApiKey);
      pagespeedRaw = data;
      const perf = data && data.lighthouseResult && data.lighthouseResult.categories && data.lighthouseResult.categories.performance;
      if (perf && typeof perf.score === 'number') {
        performanceScore = clampScore(perf.score * 100);
      } else {
        partial.push('performance');
      }
    } catch (err) {
      partial.push('performance');
      pagespeedRaw = { error: err.message };
    }
  }

  const problems = [
    ...(seo ? seo.problems : []),
    ...(mobile ? mobile.problems : []),
    ...(conversion ? conversion.problems : []),
    ...(content ? content.problems : []),
    ...(localSeo ? localSeo.problems : []),
  ];
  if (performanceScore !== null && performanceScore < 50) {
    problems.push({
      issue: 'Slow page load performance',
      severity: performanceScore < 30 ? 'high' : 'medium',
      evidence: `Google PageSpeed Insights (mobile) performance score: ${performanceScore}/100`,
      potentialImpact: 'Slow-loading pages lose visitors and rank worse in mobile search',
      recommendation: 'Optimize images, reduce render-blocking scripts, and enable caching/compression',
    });
  }

  return {
    url,
    checkedAt,
    scores: {
      performance: performanceScore,
      mobile: mobile ? mobile.score : null,
      seo: seo ? seo.score : null,
      localSeo: localSeo ? localSeo.score : null,
      conversion: conversion ? conversion.score : null,
      content: content ? content.score : null,
      ...(partial.length ? { _partial: [...new Set(partial)] } : {}),
    },
    problems,
    raw: { pagespeed: pagespeedRaw, technologies },
    brandColors,
  };
}

module.exports = { auditWebsite, auditSeo, auditMobile, auditConversion, auditContent, auditLocalSeo, clampScore };
