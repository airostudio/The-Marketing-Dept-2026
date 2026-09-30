/**
 * api/_lib/site-structure.js — maps the real page structure of a site:
 * which pages it actually has (from its own sitemap, or real nav links —
 * never a guessed list of common paths), plus a per-page breakdown of
 * headings/sections/images and the site's real brand colours/fonts.
 *
 * The gap this fills: api/_lib/nancy-crawl.js's crawlSite() already
 * multi-page-crawls a site, but by *guessing* a fixed list of common paths
 * (CANDIDATE_PATHS: '/about', '/services', ...) — it works well enough to
 * feed a copywriting prompt, but it is not a real map of the site, and it
 * will both miss real pages and "find" pages that don't exist. This module
 * discovers the site's actual pages first (sitemap.xml, falling back to the
 * real links on its own homepage), then crawls exactly those.
 *
 * No headless browser: this is a bounded fetch + regex pass, same
 * discipline as every other crawl in this codebase (no npm dependencies in
 * api/*.js, Vercel's function-duration ceiling). A JS-rendered site with no
 * server-side HTML will come back with thin/empty pages, same honest
 * limitation crawlSite() already has — this module does not pretend to
 * run a browser it doesn't have.
 */

'use strict';

const { safeFetchText } = require('./safe-fetch.js');
const { parseTarget, fetchLinkedStylesheets, htmlToText } = require('./nancy-crawl.js');
const { extractColours, extractFontHints } = require('./nancy-colours.js');

const PAGE_TIMEOUT_MS = 10000;
const MAX_PAGES = 20;
const MAX_HTML_BYTES_PER_PAGE = 400_000;
const FETCH_CONCURRENCY = 5;
const MAX_SITEMAPS_TO_FOLLOW = 3; // a sitemap index can point at many child sitemaps; only the first few are worth the extra fetches

async function fetchText(url, { maxBytes = MAX_HTML_BYTES_PER_PAGE, accept = 'text/html,application/xhtml+xml,*/*;q=0.8' } = {}) {
  try {
    const r = await safeFetchText(url, {
      timeoutMs: PAGE_TIMEOUT_MS,
      maxBytes,
      headers: { 'User-Agent': 'NancyJamFancy/1.0 (+content research bot)', Accept: accept },
    });
    if (r.status < 200 || r.status >= 300) return null;
    return { text: r.text, finalUrl: r.url || url, contentType: r.headers.get('content-type') || '' };
  } catch {
    return null;
  }
}

/** Every <loc> in a sitemap XML — a sitemap index's <loc>s are child sitemap URLs, a urlset's are real pages. Same regex works for both; the caller decides which it got by whether the URLs it returns are themselves sitemaps. */
function extractLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]);
}

/**
 * Real pages, discovered rather than guessed — sitemap.xml first (following
 * one level of sitemap-index nesting), falling back to the real links found
 * on the homepage itself when there's no usable sitemap. Always same-origin
 * only; always capped at MAX_PAGES.
 */
async function discoverPageUrls(origin, homepageHtml) {
  const sitemap = await fetchText(`${origin}/sitemap.xml`, { accept: 'application/xml,text/xml,*/*;q=0.1' });
  if (sitemap && /<urlset|<sitemapindex/i.test(sitemap.text)) {
    let locs = extractLocs(sitemap.text);
    if (/<sitemapindex/i.test(sitemap.text)) {
      const childSitemaps = locs.slice(0, MAX_SITEMAPS_TO_FOLLOW);
      const children = await Promise.all(childSitemaps.map(u => fetchText(u, { accept: 'application/xml,text/xml,*/*;q=0.1' })));
      locs = children.filter(Boolean).flatMap(c => extractLocs(c.text));
    }
    const sameOrigin = locs.filter(u => {
      try { return new URL(u).origin === origin; } catch { return false; }
    });
    if (sameOrigin.length) return [...new Set(sameOrigin)].slice(0, MAX_PAGES);
  }

  // No usable sitemap — fall back to the real links this page actually has,
  // not a guessed list. Every <a href> on the homepage, same-origin, with
  // fragments/query strings stripped for de-duplication (so "/about" and
  // "/about#team" aren't crawled as two different pages).
  if (!homepageHtml) return [origin];
  const hrefs = [...homepageHtml.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  const seen = new Set();
  const pages = [origin];
  seen.add(origin);
  for (const href of hrefs) {
    if (pages.length >= MAX_PAGES) break;
    try {
      const abs = new URL(href, origin);
      if (abs.origin !== origin) continue;
      abs.hash = ''; // same page, not a different one
      const normalized = abs.href.replace(/\/$/, '') || abs.origin;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      pages.push(normalized);
    } catch { /* not a real URL — not a page */ }
  }
  return pages;
}

/** Real <nav>/<header> links only — this is what a visitor can actually click, not every link on the page. */
function extractNavigation(html, pageUrl) {
  const navBlocks = html.match(/<nav\b[\s\S]*?<\/nav>/gi) || html.match(/<header\b[\s\S]*?<\/header>/gi) || [];
  const nav = [];
  const seen = new Set();
  for (const block of navBlocks) {
    const anchors = [...block.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    for (const [, href, inner] of anchors) {
      const label = htmlToText(inner).trim();
      if (!label || !href || href.startsWith('#') || href.startsWith('javascript:')) continue;
      let path;
      try { path = new URL(href, pageUrl).pathname || '/'; } catch { continue; }
      const key = `${label}|${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      nav.push({ label, path });
    }
  }
  return nav;
}

/**
 * Content-bearing blocks on one page — heading + first paragraph + first
 * link/button text, same evidence-only shape as the rest of this codebase
 * (a "type" is only ever assigned where the position genuinely implies it:
 * the very first section on the homepage is labelled 'hero' since that's
 * how the overwhelming majority of sites are actually structured; every
 * other section is labelled by its real HTML tag rather than a guessed
 * category this module has no way to verify).
 */
function extractSections(html, isHomepage) {
  const blocks = html.match(/<(section|header|footer)\b[\s\S]*?<\/\1>|<div\b[^>]*class=["'][^"']*\b(hero|banner|section)\b[^"']*["'][\s\S]*?<\/div>/gi) || [];
  const sections = [];
  blocks.slice(0, 15).forEach((block, i) => {
    const tagMatch = block.match(/^<(\w+)/);
    const tag = tagMatch ? tagMatch[1].toLowerCase() : 'div';
    const headingMatch = block.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
    const heading = headingMatch ? htmlToText(headingMatch[1]).slice(0, 200) : '';
    const paraMatch = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    const text = paraMatch ? htmlToText(paraMatch[1]).slice(0, 500) : '';
    const ctaMatch = block.match(/<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/i);
    const ctaText = ctaMatch ? htmlToText(ctaMatch[1]).slice(0, 80) : '';
    if (!heading && !text) return; // no real content here, not worth reporting as a "section"
    sections.push({
      type: (isHomepage && i === 0 && heading) ? 'hero' : tag,
      heading, text, ctaText,
    });
  });
  return sections;
}

function extractImages(html, pageUrl) {
  const srcs = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  const abs = [];
  const seen = new Set();
  for (const src of srcs) {
    try {
      const u = new URL(src, pageUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      if (seen.has(u.href)) continue;
      seen.add(u.href);
      abs.push(u.href);
    } catch { /* not a real image URL */ }
  }
  return abs;
}

function extractMeta(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  return {
    title: titleMatch ? titleMatch[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : '',
  };
}

async function fetchPageStructure(url, isHomepage) {
  const page = await fetchText(url);
  if (!page || !page.contentType.includes('text/html')) return null;
  return {
    url: page.finalUrl,
    path: (() => { try { return new URL(page.finalUrl).pathname || '/'; } catch { return url; } })(),
    meta: extractMeta(page.text),
    sections: extractSections(page.text, isHomepage),
    images: extractImages(page.text, page.finalUrl),
    html: page.text, // kept only long enough for the homepage's brand-colour pass below; never returned to a caller
  };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function next() {
    while (index < items.length) {
      const i = index++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

/**
 * Map a site's real structure: which pages it has, what's on each, its
 * navigation, and its real brand colours/fonts.
 *
 * @returns {Promise<{origin, brand, navigation, pages: Array}>}
 * @throws if not even the homepage could be fetched.
 */
async function mapSiteStructure(rawUrl) {
  const target = parseTarget(rawUrl);
  const origin = target.origin;

  const homepage = await fetchPageStructure(origin, true);
  if (!homepage) {
    throw new Error('Could not fetch the homepage — it may be down, blocking automated requests, or entirely JavaScript-rendered with no server-side HTML.');
  }

  const pageUrls = await discoverPageUrls(origin, homepage.html);
  // The homepage was already fetched above; don't fetch it twice.
  const otherUrls = pageUrls.filter(u => u.replace(/\/$/, '') !== origin.replace(/\/$/, ''));

  const otherPages = await runWithConcurrency(otherUrls, FETCH_CONCURRENCY, (u) => fetchPageStructure(u, false));

  const navigation = extractNavigation(homepage.html, homepage.url);
  const homepageCss = await fetchLinkedStylesheets(homepage.html, homepage.url);
  const brand = {
    colors: extractColours(homepage.html, homepageCss),
    fonts: extractFontHints(homepage.html, homepageCss),
  };

  const pages = [homepage, ...otherPages.filter(Boolean)]
    .map(({ html, ...rest }) => rest); // drop the raw HTML — it was only needed for the brand pass above

  return { origin, brand, navigation, pages, pagesDiscovered: pageUrls.length, pagesCrawled: pages.length };
}

module.exports = { mapSiteStructure, discoverPageUrls, extractNavigation, extractSections, extractImages, extractMeta };
