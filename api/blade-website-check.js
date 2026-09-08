/**
 * api/blade-website-check.js — Blade: fast heuristic website-health check
 * for a single scraped business, so results can be filtered into
 * "no website" / "outdated" / "modern" / "unreachable" buckets.
 *
 * POST { website }
 * Returns: { success, status: 'unreachable'|'outdated'|'modern',
 *   signals: { hasViewport, https, copyrightYear, oldGenerator, hasFlash },
 *   reasons: string[] }
 *
 * This is deliberately a single fast fetch + regex pass, not a full
 * PageSpeed/Lighthouse audit (api/pagespeed.js) — that endpoint alone can
 * take up to 90s per URL, which is a non-starter when Blade needs to
 * triage dozens of businesses per search inside Vercel's 60s ceiling.
 * The signals here are honest heuristics (stale copyright year, missing
 * mobile viewport tag, ancient CMS generator, no HTTPS, Flash embeds) —
 * good enough to sort "needs a rebuild" leads from "looks fine" ones,
 * not a certified audit.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { safeFetch } = require('./_lib/safe-fetch.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 40;


const PAGE_TIMEOUT_MS = 7000;
const CURRENT_YEAR = new Date().getFullYear();
const OLD_COPYRIGHT_THRESHOLD_YEARS = 4;

const VIEWPORT_RE = /<meta[^>]+name=["']viewport["']/i;
const COPYRIGHT_RE = /(?:©|&copy;|copyright)\s*(?:\d{4}\s*-\s*)?(\d{4})/i;
const GENERATOR_RE = /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i;
const FLASH_RE = /\.swf\b|application\/x-shockwave-flash/i;

// Generator strings whose leading version number is old enough to be a
// reliable "this hasn't been touched in years" signal.
const OLD_GENERATOR_PATTERNS = [
  /WordPress\s+([0-3]\.\d)/i,
  /WordPress\s+4\.[0-6]\b/i,
  /Joomla!?\s+[12]\./i,
  /Drupal\s+[1-6]\b/i,
];

// Shape check only. The address check that matters lives in
// api/_lib/safe-fetch.js and runs at fetch time below, because it has to
// resolve the hostname and re-check each redirect — neither of which a
// synchronous string test can do.
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

  return { status: score >= 2 ? 'outdated' : 'modern', signals, reasons };
}

module.exports = async function handler(req, res) {
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

  if (rateLimited(req, res, { name: 'blade-website-check', max: 40, windowMs: 60 * 1000, auth })) return;

  const { website } = req.body || {};
  if (!website || !String(website).trim()) return res.status(400).json({ error: 'website is required' });

  let target;
  try {
    target = parseTarget(website);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    const response = await safeFetch(target.href, {
      method: 'GET',
      timeoutMs: PAGE_TIMEOUT_MS,
      headers: { 'User-Agent': 'NancyJamFancy/1.0 (+content research bot)', 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' },
    });

    if (response.status < 200 || response.status >= 300) {
      return res.json({ success: true, status: 'unreachable', signals: {}, reasons: [`Site responded with ${response.status}`] });
    }

    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('text/html')) {
      return res.json({ success: true, status: 'modern', signals: {}, reasons: [] });
    }

    const html = (await response.text()).slice(0, 300_000);
    const analysis = analyseHtml(html, response.url || target.href);
    return res.json({ success: true, ...analysis });
  } catch (e) {
    return res.json({ success: true, status: 'unreachable', signals: {}, reasons: ['Site did not respond'] });
  }
};
