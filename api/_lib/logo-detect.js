/**
 * api/_lib/logo-detect.js — deterministic, zero-AI logo URL detection from a
 * homepage's HTML.
 *
 * Mirrors nancy-colours.js's approach: hand-rolled regex extraction, no AI
 * call and no fabrication — a candidate is only ever returned when the HTML
 * actually names one. Priority order (highest-confidence first):
 *
 *   1. An <img> whose class/id/alt/src mentions "logo" — the single most
 *      reliable signal on real marketing sites.
 *   2. og:image / twitter:image meta tags — usually the brand mark or a
 *      branded social card, a reasonable fallback when no explicit logo
 *      image exists.
 *   3. apple-touch-icon link — a higher-resolution icon most sites already
 *      ship for iOS home-screen bookmarks, often the same mark as the logo.
 *   4. A plain favicon link, or the default /favicon.ico — last resort, low
 *      resolution but better than nothing.
 *
 * Every candidate URL is resolved to an absolute URL against the page's own
 * URL before being returned, so a relative path like "/img/logo.svg" becomes
 * a fetchable link. Returns { logoUrl: null, reason } rather than guessing
 * when nothing is found — a missing logo should read as "not detected", not
 * as a broken image.
 */

'use strict';

function resolve(href, baseUrl) {
  try {
    const abs = new URL(href, baseUrl);
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return null;
    return abs.href;
  } catch {
    return null;
  }
}

/** Pulls every <img ...> tag's attributes out without a full HTML parser. */
function findLogoImg(html, baseUrl) {
  const imgRe = /<img\b[^>]*>/gi;
  const candidates = [];
  for (const tag of html.match(imgRe) || []) {
    const cls = (tag.match(/class\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const id = (tag.match(/\bid\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const alt = (tag.match(/alt\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const src = (tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i) || [])[1] ||
                (tag.match(/data-src\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    if (!src) continue;
    const haystack = `${cls} ${id} ${alt} ${src}`.toLowerCase();
    if (/logo/.test(haystack)) {
      // A header/nav logo is weighted above one buried elsewhere on the page,
      // but this function only sees the tag itself — position scoring is left
      // to "first match wins", since logos overwhelmingly appear near the top
      // of the document (header/nav markup comes first in real markup).
      candidates.push(src);
    }
  }
  return candidates[0] || null;
}

function findMetaContent(html, propertyNames) {
  for (const prop of propertyNames) {
    const re = new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${prop}["'][^>]*>`, 'i');
    const tag = (html.match(re) || [])[0];
    if (!tag) continue;
    const content = (tag.match(/content\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (content) return content;
  }
  return null;
}

function findLinkHref(html, relPattern) {
  const linkRe = /<link\b[^>]*>/gi;
  for (const tag of html.match(linkRe) || []) {
    const rel = (tag.match(/rel\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    if (!relPattern.test(rel)) continue;
    const href = (tag.match(/href\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (href) return href;
  }
  return null;
}

/**
 * @param {string} html the homepage's raw HTML
 * @param {string} baseUrl the homepage's final (post-redirect) URL, used to
 *   resolve relative paths
 * @returns {{logoUrl: string, source: string} | {logoUrl: null, reason: string}}
 */
function detectLogo(html, baseUrl) {
  const logoImgSrc = findLogoImg(html, baseUrl);
  if (logoImgSrc) {
    const abs = resolve(logoImgSrc, baseUrl);
    if (abs) return { logoUrl: abs, source: 'img[logo]' };
  }

  const ogImage = findMetaContent(html, ['og:image', 'twitter:image', 'twitter:image:src']);
  if (ogImage) {
    const abs = resolve(ogImage, baseUrl);
    if (abs) return { logoUrl: abs, source: 'og:image' };
  }

  const appleTouchIcon = findLinkHref(html, /apple-touch-icon/i);
  if (appleTouchIcon) {
    const abs = resolve(appleTouchIcon, baseUrl);
    if (abs) return { logoUrl: abs, source: 'apple-touch-icon' };
  }

  const favicon = findLinkHref(html, /(^|\s)icon(\s|$)|shortcut icon/i);
  if (favicon) {
    const abs = resolve(favicon, baseUrl);
    if (abs) return { logoUrl: abs, source: 'favicon' };
  }

  const defaultFavicon = resolve('/favicon.ico', baseUrl);
  if (defaultFavicon) return { logoUrl: defaultFavicon, source: 'default favicon (unverified)' };

  return { logoUrl: null, reason: 'No logo image, og:image, apple-touch-icon, or favicon link found on this page.' };
}

module.exports = { detectLogo };
