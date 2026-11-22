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


// Third-party platforms whose own addresses show up in search results about a
// business — never the business's contact.
const SEARCH_JUNK_DOMAINS = new Set([
  'facebook.com', 'facebookmail.com', 'instagram.com', 'google.com', 'yelp.com', 'linkedin.com',
  'yellowpages.com', 'tripadvisor.com', 'twitter.com', 'x.com', 'tiktok.com', 'youtube.com',
]);
const MAX_CITATIONS_TO_VERIFY = 3;

function plausibleBusinessEmail(email) {
  if (!EMAIL_VALID_RE.test(email) || isJunkEmail(email)) return false;
  const [local, domain] = email.toLowerCase().split('@');
  if (SEARCH_JUNK_DOMAINS.has(domain)) return false;
  return !/^(no-?reply|do-?not-?reply|donotreply)$/.test(local);
}

/**
 * Find a contact email for a business by searching the open web and social
 * listings for it — for the many small businesses that have no website, or
 * whose site hides its address, but publish a gmail/outlook address on a
 * Facebook page, Google Business Profile or directory listing.
 *
 * Search results are the one place an address could be invented, so an
 * address is never taken on the model's word:
 *   - it must literally appear in the response text, with the response citing
 *     at least one page (an address with no cited source has no provenance);
 *   - each cited page is then fetched, and if the address is really on it the
 *     result is 'search_verified'. A logged-in-only social page often can't be
 *     fetched, so an address that appears in cited results but could not be
 *     confirmed on the page comes back as 'estimate' — shown to the user as
 *     unverified, never as confirmed.
 * Nothing found is 'not_found'; no search key is 'unavailable'. Never throws.
 *
 * @returns {Promise<{email: string|null, dataSource: 'search_verified'|'estimate'|'not_found'|'unavailable', source: string|null}>}
 */
async function findEmailByBusiness({ businessName, area, country, website } = {}) {
  const name = String(businessName || '').trim();
  if (!name) return { email: null, dataSource: 'not_found', source: null };

  const where = [area, country].filter(Boolean).join(', ');
  let result;
  try {
    result = await searchProvider(
      `What contact email address does the business "${name}"${where ? ` in ${where}` : ''}${website ? ` (website: ${website})` : ''} publish? ` +
      `Check its Google Business Profile, Facebook, Instagram, LinkedIn and local directory listings. A gmail, outlook or yahoo address is fine if the business itself published it. ` +
      `Quote the address exactly as published and name the page it is on.`,
      {
        systemPrompt: 'Find a real contact email address that this specific business has published on a real page. Only report an address you can see published — never guess, infer from the business name, or invent one in a plausible-looking format. If you cannot find one, say so plainly.',
        maxTokens: 500,
      });
  } catch {
    return { email: null, dataSource: 'not_found', source: null };
  }
  if (!result.available) return { email: null, dataSource: 'unavailable', source: null };

  const text = String(result.text || '');
  const citations = (Array.isArray(result.citations) ? result.citations : [])
    .map(c => (typeof c === 'string' ? c : c && c.url))
    .filter(u => typeof u === 'string' && /^https?:\/\//i.test(u));

  const candidates = [...new Set((text.match(EMAIL_RE) || []).map(e => e.trim().replace(/[.,;:]+$/, '')))]
    .filter(plausibleBusinessEmail);
  // No cited page means nothing to trace an address back to.
  if (!candidates.length || !citations.length) return { email: null, dataSource: 'not_found', source: null };

  const pages = await Promise.all(citations.slice(0, MAX_CITATIONS_TO_VERIFY).map(async (url) => {
    const html = await fetchRawHtml(url);
    return { url, html: html ? html.toLowerCase() : '' };
  }));
  for (const email of candidates) {
    const hit = pages.find(p => p.html.includes(email.toLowerCase()));
    if (hit) return { email, dataSource: 'search_verified', source: hit.url };
  }
  return { email: candidates[0], dataSource: 'estimate', source: citations[0] };
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

module.exports = { findContactEmail, findEmailByBusiness, crawlForEmail, searchForEmail };
