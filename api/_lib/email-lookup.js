/**
 * api/_lib/email-lookup.js — find a real contact email for a domain, split
 * out of api/seo-backlink-find-email.js so api/cron-sales-intel-sweep.js can
 * call it directly for a business it just discovered itself, without an
 * internal HTTP round-trip.
 *
 * See api/seo-backlink-find-email.js for the full reasoning — this is a
 * verbatim extraction, not a rewrite. Two-step: crawl the business's own
 * site first (fast, no LLM, most trustworthy — 'real'), then fall back to a
 * live search only if that finds nothing ('estimate'). Never guesses or
 * invents an address in a plausible-looking format.
 */

'use strict';

const { parseTarget, htmlToText } = require('./nancy-crawl.js');
const { safeFetchText } = require('./safe-fetch.js');
const { searchProvider } = require('./nancy-providers.js');

const CANDIDATE_PATHS = ['/contact', '/contact-us', '/about', '/about-us', ''];
const PAGE_TIMEOUT_MS = 8000;

const PREFERRED_LOCAL_PARTS = ['contact', 'hello', 'hi', 'press', 'media', 'editor', 'partnerships', 'marketing', 'outreach', 'info', 'team'];

const JUNK_DOMAIN_FRAGMENTS = [
  'sentry.io', 'wixpress.com', 'godaddy.com', 'domainsbyproxy.com', 'cloudflare.com',
  'schema.org', 'example.com', 'yourdomain.com', 'w3.org', '.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp',
];

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
    const r = await safeFetchText(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes: 400_000,
      headers: { 'User-Agent': 'NancyJamFancy/1.0 (+content research bot)', 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8' },
    });
    if (r.status < 200 || r.status >= 300) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
    return r.text;
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

/**
 * @returns {Promise<{email: string|null, dataSource: 'real'|'estimate'|'not_found'}>}
 * Never throws — an individual crawl/search failure just falls through to
 * the next step, same as api/seo-backlink-find-email.js's own handler.
 */
async function findContactEmail(domain) {
  try {
    const found = await crawlForEmail(domain);
    if (found) return { email: found, dataSource: 'real' };
  } catch (e) {
    console.warn('[email-lookup] crawl failed:', e.message);
  }

  try {
    const found = await searchForEmail(domain);
    if (found) return { email: found, dataSource: 'estimate' };
  } catch (e) {
    console.warn('[email-lookup] search fallback failed:', e.message);
  }

  return { email: null, dataSource: 'not_found' };
}

module.exports = { findContactEmail, crawlForEmail, searchForEmail };
