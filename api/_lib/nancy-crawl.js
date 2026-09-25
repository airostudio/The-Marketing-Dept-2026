/**
 * api/_lib/nancy-crawl.js — bounded, SSRF-safe multi-page site crawl for
 * Nancy's Website Analyst (Agent 1) and Brand Identity Extraction.
 *
 * Every request goes through api/_lib/safe-fetch.js, which is the one place
 * that decides whether an address the caller named may be connected to. This
 * file used to carry its own copy of a hostname blocklist, alongside three
 * other copies elsewhere that had already drifted apart; that copy is gone.
 * Sensible, hard page/byte/time limits — "do not crawl endlessly" per spec.
 */

'use strict';

const { safeFetchText } = require('./safe-fetch.js');

const PAGE_TIMEOUT_MS = 10000;
const MAX_PAGES = 6;
const MAX_HTML_BYTES_PER_PAGE = 400_000; // 400KB/page cap
const MAX_TOTAL_TEXT_CHARS = 60_000;     // cap what gets handed to Claude

// Brand colours are read out of CSS. Almost no real site ships its CSS in a
// <style> block — Squarespace, Shopify, WordPress and every build tool emit
// linked stylesheets — so reading the HTML alone found nothing on the very
// sites customers actually have, and the colour "extracted from CSS" was
// whatever the model guessed from the domain name. These are fetched with
// the same bounds as the pages.
const MAX_STYLESHEETS = 4;
const MAX_CSS_BYTES_PER_SHEET = 500_000;

const CANDIDATE_PATHS = [
  '', '/about', '/about-us', '/services', '/products', '/pricing',
  '/contact', '/contact-us', '/blog', '/case-studies', '/testimonials',
];

/**
 * Parse and shape-check a target, synchronously.
 *
 * This is the fast, callable-anywhere check: it is imported by several
 * endpoints that need a URL object before they do anything else. It is NOT
 * the SSRF boundary — that lives in api/_lib/safe-fetch.js, which resolves
 * the hostname and re-checks every redirect hop, and which every fetch below
 * goes through. A synchronous string test cannot see what a name resolves to,
 * so it cannot be the thing relied on.
 */
function parseTarget(raw) {
  const withProto = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
  const target = new URL(withProto);
  if (!target.hostname.includes('.')) throw new Error('Invalid hostname');
  return target;
}

async function fetchOne(url) {
  try {
    const r = await safeFetchText(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes: MAX_HTML_BYTES_PER_PAGE,
      headers: {
        'User-Agent': 'NancyJamFancy/1.0 (+content research bot)',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });
    if (r.status < 200 || r.status >= 300) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
    return { html: r.text, finalUrl: r.url || url };
  } catch {
    return null;
  }
}

/** Fetches one stylesheet. Returns '' rather than throwing — a missing
 *  stylesheet degrades the colour read, it does not fail the crawl. */
async function fetchCss(url) {
  try {
    const r = await safeFetchText(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes: MAX_CSS_BYTES_PER_SHEET,
      headers: { 'User-Agent': 'NancyJamFancy/1.0 (+content research bot)', Accept: 'text/css,*/*;q=0.1' },
    });
    if (r.status < 200 || r.status >= 300) return '';
    return r.text;
  } catch {
    return '';
  }
}

/**
 * Collects the stylesheets a page links to, in document order, capped at
 * MAX_STYLESHEETS. Cross-origin sheets are included deliberately: a CDN-hosted
 * theme stylesheet is where a hosted site's brand colours actually live, and
 * this is a public GET of a public asset, not a credentialed request.
 */
async function fetchLinkedStylesheets(html, pageUrl) {
  const hrefs = [];
  const linkRe = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkRe) || []) {
    if (!/rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) continue;
    const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    try {
      const abs = new URL(href, pageUrl);
      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
      hrefs.push(abs.href);
    } catch { /* an unparseable href is not a stylesheet we can read */ }
    if (hrefs.length >= MAX_STYLESHEETS) break;
  }
  if (!hrefs.length) return '';
  const sheets = await Promise.all(hrefs.map(fetchCss));
  return sheets.filter(Boolean).join('\n');
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
  let homepageUrl = origin;
  let totalChars = 0;

  for (const { path, result } of fetchResults) {
    if (pages.length >= MAX_PAGES) break;
    if (!result) continue;

    if (path === '') { homepageHtml = result.html; homepageUrl = result.finalUrl; }

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

  // A site whose "/" redirects or 404s but whose /about answers is still a
  // site we can read the CSS of. Dead-ending the whole brand step because one
  // path missed threw away a crawl that had otherwise worked.
  if (!homepageHtml) {
    const first = fetchResults.find(r => r.result);
    if (first) { homepageHtml = first.result.html; homepageUrl = first.result.finalUrl; }
  }

  const homepageCss = homepageHtml
    ? await fetchLinkedStylesheets(homepageHtml, homepageUrl)
    : '';

  return { origin, pages, homepageHtml, homepageUrl, homepageCss };
}

module.exports = { crawlSite, parseTarget, htmlToText, fetchLinkedStylesheets };
