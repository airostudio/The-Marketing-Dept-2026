/**
 * api/_lib/website-quickcheck.js — the fast heuristic website-health check
 * used by Blade (api/blade-website-check.js) and the daily Sales Intel
 * sweep (api/cron-sales-intel-sweep.js): a single fetch + regex pass that
 * buckets a site into 'no_website' / 'outdated' / 'modern' / 'unreachable'.
 *
 * Deliberately NOT the same module as api/_lib/website-audit.js, which is
 * Chase's full multi-axis audit (SEO/mobile/conversion/content/local-SEO +
 * PageSpeed performance) — that's a much heavier, more accurate call
 * (a full crawl + tech-detect + PageSpeed) suited to auditing one lead a
 * human is about to act on, not triaging ~100-150 candidates a day inside
 * a single cron invocation's time budget. This file is the fast triage
 * pass; Chase's website-audit.js is the deep one.
 */

'use strict';

const { safeFetch } = require('./safe-fetch.js');

const PAGE_TIMEOUT_MS = 7000;
const CURRENT_YEAR = new Date().getFullYear();
const OLD_COPYRIGHT_THRESHOLD_YEARS = 4;

const VIEWPORT_RE = /<meta[^>]+name=["']viewport["']/i;
const COPYRIGHT_RE = /(?:©|&copy;|copyright)\s*(?:\d{4}\s*-\s*)?(\d{4})/i;
const GENERATOR_RE = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i;
const FLASH_RE = /\.swf\b|application\/x-shockwave-flash/i;

const OLD_GENERATOR_PATTERNS = [
  /WordPress\s+([0-3]\.\d)/i,
  /WordPress\s+4\.[0-6]\b/i,
  /Joomla!?\s+[12]\./i,
  /Drupal\s+[1-6]\b/i,
];

// GoDaddy, Wix and Squarespace — the three platforms the user asked Sales
// Intelligence to prioritize (a business already paying monthly for a
// template builder is a proven website *buyer*, just an unhappy one).
const PLATFORM_PATTERNS = [
  { id: 'wix', label: 'Wix', tests: [
    /<meta[^>]+name=["']generator["'][^>]+content=["']Wix\.com[^"']*["']/i,
    /static\.wixstatic\.com/i,
    /\bwixBiSession\b|\bwixCodeUserId\b|_wixCIDX/i,
  ] },
  { id: 'squarespace', label: 'Squarespace', tests: [
    /<meta[^>]+name=["']generator["'][^>]+content=["']Squarespace[^"']*["']/i,
    /static1\.squarespace\.com|squarespace-cdn\.com/i,
    /\bSquarespace\.(?:Constants|SQUARESPACE_CONTEXT)\b/i,
  ] },
  { id: 'godaddy', label: 'GoDaddy Website Builder', tests: [
    /<meta[^>]+name=["']generator["'][^>]+content=["']GoDaddy[^"']*["']/i,
    /\.godaddysites\.com/i,
    /img\d?\.wsimg\.com|websitebuilder\.secureserver\.net/i,
  ] },
];

function detectPlatform(html, finalUrl) {
  const haystack = `${finalUrl}\n${html}`;
  for (const platform of PLATFORM_PATTERNS) {
    if (platform.tests.some((re) => re.test(haystack))) return platform.id;
  }
  return null;
}

function parseTarget(raw) {
  const withProto = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  const target = new URL(withProto);
  if (!target.hostname.includes('.')) throw new Error('Invalid hostname');
  return target;
}

function analyseHtml(html, finalUrl) {
  const signals = {
    hasViewport: VIEWPORT_RE.test(html),
    https: /^https:/i.test(finalUrl),
    copyrightYear: null,
    oldGenerator: null,
    hasFlash: FLASH_RE.test(html),
    platform: detectPlatform(html, finalUrl),
  };

  const copyrightMatch = html.match(COPYRIGHT_RE);
  if (copyrightMatch) {
    const year = parseInt(copyrightMatch[1], 10);
    if (year >= 1995 && year <= CURRENT_YEAR) signals.copyrightYear = year;
  }

  const generatorMatch = html.match(GENERATOR_RE);
  if (generatorMatch && OLD_GENERATOR_PATTERNS.some(re => re.test(generatorMatch[1]))) {
    signals.oldGenerator = generatorMatch[1];
  }

  const reasons = [];
  let score = 0;
  if (!signals.hasViewport) { score += 2; reasons.push('No mobile-responsive (viewport) tag'); }
  if (signals.copyrightYear && CURRENT_YEAR - signals.copyrightYear >= OLD_COPYRIGHT_THRESHOLD_YEARS) {
    score += 2; reasons.push(`Footer copyright still says ${signals.copyrightYear}`);
  }
  if (signals.hasFlash) { score += 3; reasons.push('Uses Flash (dead technology)'); }
  if (!signals.https) { score += 1; reasons.push('Not served over HTTPS'); }
  if (signals.oldGenerator) { score += 2; reasons.push(`Running an outdated platform (${signals.oldGenerator})`); }
  if (signals.platform) {
    const label = PLATFORM_PATTERNS.find(p => p.id === signals.platform).label;
    score += 2;
    reasons.push(`Built on ${label} — already paying for a website that isn't fully theirs`);
  }

  return { status: score >= 2 ? 'outdated' : 'modern', signals, reasons };
}

/**
 * Fetch and quick-check a single business website.
 *
 * Never throws: an unreachable/misconfigured site is a real, honest result
 * ('unreachable'), not an exception.
 *
 * @returns {Promise<{status:'unreachable'|'outdated'|'modern', signals:object, reasons:string[]}>}
 */
async function quickCheckWebsite(rawUrl) {
  let target;
  try {
    target = parseTarget(rawUrl);
  } catch (e) {
    return { status: 'unreachable', signals: {}, reasons: [e.message] };
  }

  try {
    const response = await safeFetch(target.href, {
      method: 'GET',
      timeoutMs: PAGE_TIMEOUT_MS,
      headers: { 'User-Agent': 'NancyJamFancy/1.0 (+content research bot)', 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' },
    });

    if (response.status < 200 || response.status >= 300) {
      return { status: 'unreachable', signals: {}, reasons: [`Site responded with ${response.status}`] };
    }

    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return { status: 'modern', signals: {}, reasons: [] };

    const html = (await response.text()).slice(0, 300_000);
    return analyseHtml(html, response.url || target.href);
  } catch {
    return { status: 'unreachable', signals: {}, reasons: ['Site did not respond'] };
  }
}

module.exports = { quickCheckWebsite, analyseHtml, detectPlatform, parseTarget, PLATFORM_PATTERNS };
