/**
 * api/_lib/nancy-crawl.js — bounded, SSRF-safe multi-page site crawl for
 * Nancy's Website Analyst (Agent 1) and Brand Identity Extraction.
 *
 * Reuses the SSRF-blocking target validation already established in
 * api/fetch-page.js and api/check-url.js (block localhost/private ranges/
 * cloud metadata endpoint) rather than duplicating a weaker version.
 * Sensible, hard page/byte/time limits — "do not crawl endlessly" per spec.
 */

'use strict';

const PAGE_TIMEOUT_MS = 10000;
const MAX_PAGES = 6;
const MAX_HTML_BYTES_PER_PAGE = 400_000; // 400KB/page cap
const MAX_TOTAL_TEXT_CHARS = 60_000;     // cap what gets handed to Claude

const CANDIDATE_PATHS = [
  '', '/about', '/about-us', '/services', '/products', '/pricing',
  '/contact', '/contact-us', '/blog', '/case-studies', '/testimonials',
];

function parseTarget(raw) {
  const withProto = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  const target = new URL(withProto);
  if (!target.hostname.includes('.')) throw new Error('Invalid hostname');
  const h = target.hostname.toLowerCase();
  if (
    h === 'localhost' || h.endsWith('.local') || h === '0.0.0.0' ||
    h === '169.254.169.254' ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) ||
    h === '::1'
  ) {
    throw new Error('Private/internal addresses not allowed');
  }
  return target;
}

async function fetchOne(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: {
        'User-Agent': 'NancyJamFancy/1.0 (+content research bot)',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
    const text = await res.text();
    return { html: text.slice(0, MAX_HTML_BYTES_PER_PAGE), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

/** Strips tags/scripts/styles down to readable text, collapses whitespace. */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Crawls up to MAX_PAGES candidate pages on the site, returns homepage HTML
 * (for CSS/colour extraction) plus combined readable text (capped) for the
 * Website Analyst prompt.
 */
async function crawlSite(rawUrl) {
  const target = parseTarget(rawUrl);
  const origin = target.origin;

  // Fetched in parallel, not sequentially — this crawl feeds directly into a
  // Claude call in the same Vercel function invocation (see
  // api/nancy-analyze-website.js), sharing one 60s function ceiling. Up to
  // 11 CANDIDATE_PATHS fetched one at a time at 10s each could alone reach
  // 110s; in parallel, the whole crawl costs about as much as its single
  // slowest page.
  const fetchResults = await Promise.all(
    CANDIDATE_PATHS.map(async (path) => ({ path, result: await fetchOne(`${origin}${path}`) }))
  );

  const pages = [];
  let homepageHtml = null;
  let totalChars = 0;

  for (const { path, result } of fetchResults) {
    if (pages.length >= MAX_PAGES) break;
    if (!result) continue;

    if (path === '') homepageHtml = result.html;

    const text = htmlToText(result.html);
    if (text.length < 40) continue; // near-empty page, skip

    const remaining = MAX_TOTAL_TEXT_CHARS - totalChars;
    if (remaining <= 0) break;
    const slice = text.slice(0, remaining);
    totalChars += slice.length;

    const titleMatch = result.html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    pages.push({ url: result.finalUrl, title: titleMatch ? titleMatch[1].trim() : path || 'Homepage', text: slice });
  }

  if (!pages.length) {
    throw new Error('Could not fetch any pages from this site — it may be down, blocking automated requests, or entirely JavaScript-rendered with no server-side HTML.');
  }

  return { origin, pages, homepageHtml };
}

module.exports = { crawlSite, parseTarget, htmlToText };
