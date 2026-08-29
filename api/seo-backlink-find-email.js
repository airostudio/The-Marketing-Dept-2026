/**
 * api/seo-backlink-find-email.js — SEO Pipeline: find a real contact email
 * for a backlink prospect's domain.
 *
 * POST { domain, page_url? }
 * Returns: { success, email: string|null, contact_name: string|null,
 *   data_source: 'real'|'estimate'|'not_found', source_url? }
 *
 * Backlink prospects (from seo-backlink-prospects.js / seo-backlink-structure.js)
 * never had a contact_email populated — the column existed in the schema but
 * nothing wrote to it, so every outreach draft showed just the domain with no
 * way to actually send it. This finds one:
 *
 *   1. Crawl the prospect's own site (homepage + likely contact/about pages)
 *      for a real mailto: link or a visible email address — this is a single
 *      cheap fetch pass, no LLM call, so it stays fast even run for many
 *      prospects. 'real' — found on the business's own site.
 *   2. If nothing turns up, fall back to a live Perplexity search for the
 *      domain's contact email. 'estimate' — inferred, not confirmed on-site.
 *
 * Always returns 200 with data_source:'not_found' rather than erroring when
 * nothing is found — the user fills it in manually in that case, same as
 * every other "no real data available" path in this app.
 */

'use strict';

const { parseTarget, htmlToText } = require('./_lib/nancy-crawl.js');
const { searchProvider } = require('./_lib/nancy-providers.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 15;
const rateBuckets = new Map();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}
function checkRateLimit(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now - b.windowStart > RATE_LIMIT_WINDOW_MS) { b = { windowStart: now, count: 0 }; rateBuckets.set(ip, b); }
  b.count++;
  return b.count <= RATE_LIMIT_MAX;
}

const CANDIDATE_PATHS = ['/contact', '/contact-us', '/about', '/about-us', ''];
const PAGE_TIMEOUT_MS = 8000;

// Role-style local parts, in the order we'd rather write outreach to.
const PREFERRED_LOCAL_PARTS = ['contact', 'hello', 'hi', 'press', 'media', 'editor', 'partnerships', 'marketing', 'outreach', 'info', 'team'];

// Addresses that are technically emails but never a real contact —
// analytics/privacy-proxy/placeholder junk that regex matching picks up.
const JUNK_DOMAIN_FRAGMENTS = [
  'sentry.io', 'wixpress.com', 'godaddy.com', 'domainsbyproxy.com', 'cloudflare.com',
  'schema.org', 'example.com', 'yourdomain.com', 'w3.org', '.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp',
];

// EMAIL_RE (global) is only ever used with .match() to pull matches out of a
// larger text blob — String.match() resets a global regex's lastIndex itself
// on each call, so that usage is safe. EMAIL_VALID_RE is separate and
// non-global specifically for .test() — reusing one global-flagged RegExp
// object across repeated .test() calls is stateful (lastIndex persists
// between calls), which silently drops or keeps candidates depending on
// call order rather than the actual string. Two regexes, not one, on purpose.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const EMAIL_VALID_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const MAILTO_RE = /mailto:([^"'?\s]+)/gi;

function isJunkEmail(email) {
  const lower = email.toLowerCase();
  return JUNK_DOMAIN_FRAGMENTS.some(frag => lower.includes(frag));
}

function scoreEmail(email, siteHostname) {
  const [local, domain] = email.toLowerCase().split('@');
  if (!domain) return -1;
  let score = 0;
  if (siteHostname && (domain === siteHostname || domain.endsWith('.' + siteHostname) || siteHostname.endsWith('.' + domain))) score += 5;
  const prefIdx = PREFERRED_LOCAL_PARTS.indexOf(local);
  if (prefIdx >= 0) score += (PREFERRED_LOCAL_PARTS.length - prefIdx);
  return score;
}

function pickBestEmail(candidates, siteHostname) {
  const unique = [...new Set(candidates.map(e => e.trim().replace(/[.,;:]+$/, '')))]
    .filter(e => EMAIL_VALID_RE.test(e) && !isJunkEmail(e));
  if (!unique.length) return null;
  unique.sort((a, b) => scoreEmail(b, siteHostname) - scoreEmail(a, siteHostname));
  return unique[0];
}

async function fetchRawHtml(url) {
  try {
    const res = await fetch(url, {
      method: 'GET', redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: { 'User-Agent': 'NancyJamFancy/1.0 (+content research bot)', 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
    return (await res.text()).slice(0, 400_000);
  } catch {
    return null;
  }
}

async function crawlForEmail(rawDomain) {
  const target = parseTarget(rawDomain);
  const origin = target.origin;

  const pages = await Promise.all(CANDIDATE_PATHS.map(path => fetchRawHtml(`${origin}${path}`)));

  const candidates = [];
  for (const html of pages) {
    if (!html) continue;
    const mailtoMatches = [...html.matchAll(MAILTO_RE)].map(m => decodeURIComponent(m[1]));
    candidates.push(...mailtoMatches);
    // Plain-text emails are a weaker signal (easy to pick up a stray
    // third-party address) — only look at them if no mailto: was found.
    if (!mailtoMatches.length) {
      const text = htmlToText(html);
      candidates.push(...(text.match(EMAIL_RE) || []));
    }
  }

  if (!candidates.length) return null;
  return pickBestEmail(candidates, target.hostname.replace(/^www\./, ''));
}

async function searchForEmail(domain) {
  const result = await searchProvider(`What is the contact email address for ${domain}? Look for a press, media, or general contact email published on their own site or press materials.`, {
    systemPrompt: 'Find a real, specific contact email address. Only report an email you actually found in a source — never guess or invent one in a plausible-looking format.',
    maxTokens: 400,
  });
  if (!result.available || !result.text) return null;
  const found = result.text.match(EMAIL_RE) || [];
  return pickBestEmail(found, domain.replace(/^www\./, ''));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) return res.status(429).json({ error: 'Too many requests. Slow down.' });

  const { domain } = req.body || {};
  if (!domain || !String(domain).trim()) return res.status(400).json({ error: 'domain is required' });

  // Step 1: crawl the prospect's own site — fast, no LLM, most trustworthy.
  try {
    const found = await crawlForEmail(domain);
    if (found) return res.json({ success: true, email: found, contact_name: null, data_source: 'real' });
  } catch (e) {
    console.warn('[seo-backlink-find-email] crawl failed:', e.message);
  }

  // Step 2: live search fallback — only if the site itself yielded nothing.
  try {
    const found = await searchForEmail(domain);
    if (found) return res.json({ success: true, email: found, contact_name: null, data_source: 'estimate' });
  } catch (e) {
    console.warn('[seo-backlink-find-email] search fallback failed:', e.message);
  }

  return res.json({ success: true, email: null, contact_name: null, data_source: 'not_found' });
};
