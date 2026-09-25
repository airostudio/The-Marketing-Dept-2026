/**
 * api/_lib/tech-detect.js — signature-based website technology detection for
 * the Webese Prospect Hunter (Chase / Sales Intelligence, Phase 1).
 *
 * Not a Vercel route; api/_lib/ is excluded from routing.
 *
 * ── What this is ────────────────────────────────────────────────────────
 *
 * A small, explicitly extensible signature catalog — the same shape as
 * api/_lib/nancy-providers.js's adapters: a call either succeeds with real
 * evidence or comes back {available: false, reason}, and it NEVER fabricates
 * a "no technology found" result when the page could not actually be
 * fetched. Distinguishing "we could not check" from "we checked and found
 * nothing" is the whole point of the `checked` flag below — a caller that
 * only looked at `technologies.length === 0` would otherwise treat a
 * blocked/unreachable site exactly like a hand-built static site with no
 * detectable platform, which is a different, and much more actionable,
 * fact for a salesperson.
 *
 * ── Signature catalog ───────────────────────────────────────────────────
 *
 * These are hand-written against publicly documented/observable markers
 * (asset hostnames, meta generator tags, response headers) — not lifted
 * from any proprietary fingerprint database. Wix and GoDaddy carry the most
 * signatures/confidence because they are this feature's launch focus (the
 * "website builder → easy rebuild pitch" prospects); everything else is a
 * deliberately minimal starting point. Add more by pushing onto
 * SIGNATURES — nothing else in this file, or any caller, needs to change.
 */

'use strict';

const { safeFetchText } = require('./safe-fetch.js');

const FETCH_TIMEOUT_MS = 10000;
const MAX_BYTES = 500_000;

/**
 * @typedef {object} Signature
 * @property {string} name        e.g. 'Wix'
 * @property {string} category    'website-builder' | 'cms' | 'ecommerce' | 'analytics' | 'hosting' | 'live-chat'
 * @property {(html: string, headers: {server: string, poweredBy: string, cookieNames: string[]}) => string|null} test
 *   Returns the matched evidence string, or null when it does not match.
 *   Returning the actual matched text (not a boolean) is what lets the
 *   caller report real evidence instead of an invented one.
 * @property {'high'|'medium'|'low'} confidence
 */

/** @type {Signature[]} */
const SIGNATURES = [
  // ── Wix — launch-focus platform, most signatures ────────────────────────
  {
    name: 'Wix', category: 'website-builder', confidence: 'high',
    test: (html) => html.includes('static.wixstatic.com') ? 'found static.wixstatic.com in page source' : null,
  },
  {
    name: 'Wix', category: 'website-builder', confidence: 'high',
    test: (html) => html.includes('wix-warmup-data') ? 'found wix-warmup-data inline script marker' : null,
  },
  {
    name: 'Wix', category: 'website-builder', confidence: 'high',
    test: (_html, headers) => {
      const hit = Object.keys(headers.raw || {}).find(h => /^x-wix-/i.test(h));
      return hit ? `found ${hit} response header` : null;
    },
  },
  {
    name: 'Wix', category: 'website-builder', confidence: 'medium',
    test: (html) => /wixsite\.com/i.test(html) ? 'found wixsite.com referenced in page source' : null,
  },
  {
    name: 'Wix', category: 'website-builder', confidence: 'medium',
    test: (_html, headers) => headers.cookieNames.some(c => /^xsrf-token$|^svsession$/i.test(c))
      ? 'found Wix-style svSession/XSRF-TOKEN cookie' : null,
  },

  // ── GoDaddy Website Builder — launch-focus platform, most signatures ─────
  {
    name: 'GoDaddy Website Builder', category: 'website-builder', confidence: 'high',
    test: (html) => html.includes('img1.wsimg.com') ? 'found img1.wsimg.com asset host in page source' : null,
  },
  {
    name: 'GoDaddy Website Builder', category: 'website-builder', confidence: 'high',
    test: (html) => /websitebuilder/i.test(html) ? 'found "websitebuilder" referenced in page source' : null,
  },
  {
    name: 'GoDaddy Website Builder', category: 'website-builder', confidence: 'high',
    test: (html) => {
      const m = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']*godaddy[^"']*)["']/i);
      return m ? `found generator meta tag "${m[1]}"` : null;
    },
  },
  {
    name: 'GoDaddy Website Builder', category: 'website-builder', confidence: 'medium',
    test: (html) => /secureserver\.net/i.test(html) ? 'found secureserver.net (GoDaddy infrastructure) referenced in page source' : null,
  },
  {
    name: 'GoDaddy Website Builder', category: 'website-builder', confidence: 'medium',
    test: (_html, headers) => /godaddy/i.test(headers.server || '') ? `found "godaddy" in Server header ("${headers.server}")` : null,
  },

  // ── Squarespace ──────────────────────────────────────────────────────────
  {
    name: 'Squarespace', category: 'website-builder', confidence: 'high',
    test: (html) => html.includes('static1.squarespace.com') ? 'found static1.squarespace.com in page source' : null,
  },
  {
    name: 'Squarespace', category: 'website-builder', confidence: 'medium',
    test: (html) => /squarespace\.com/i.test(html) ? 'found squarespace.com referenced in page source' : null,
  },

  // ── WordPress ────────────────────────────────────────────────────────────
  {
    name: 'WordPress', category: 'cms', confidence: 'high',
    test: (html) => html.includes('wp-content') ? 'found /wp-content/ path in page source' : null,
  },
  {
    name: 'WordPress', category: 'cms', confidence: 'high',
    test: (html) => html.includes('wp-includes') ? 'found /wp-includes/ path in page source' : null,
  },
  {
    name: 'WordPress', category: 'cms', confidence: 'medium',
    test: (html) => {
      const m = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["'](WordPress[^"']*)["']/i);
      return m ? `found generator meta tag "${m[1]}"` : null;
    },
  },

  // ── Shopify ──────────────────────────────────────────────────────────────
  {
    name: 'Shopify', category: 'ecommerce', confidence: 'high',
    test: (html) => html.includes('cdn.shopify.com') ? 'found cdn.shopify.com in page source' : null,
  },
  {
    name: 'Shopify', category: 'ecommerce', confidence: 'high',
    test: (html) => /Shopify\.theme/i.test(html) ? 'found Shopify.theme inline script marker' : null,
  },
  {
    name: 'Shopify', category: 'ecommerce', confidence: 'high',
    test: (_html, headers) => headers.raw && headers.raw['x-shopid'] ? `found X-ShopId response header (${headers.raw['x-shopid']})` : null,
  },

  // ── Webflow ──────────────────────────────────────────────────────────────
  {
    name: 'Webflow', category: 'website-builder', confidence: 'high',
    test: (html) => /data-wf-site/i.test(html) ? 'found data-wf-site attribute in page source' : null,
  },
  {
    name: 'Webflow', category: 'website-builder', confidence: 'medium',
    test: (html) => /webflow\.js/i.test(html) ? 'found webflow.js script reference in page source' : null,
  },

  // ── Weebly ───────────────────────────────────────────────────────────────
  {
    name: 'Weebly', category: 'website-builder', confidence: 'medium',
    test: (html) => /weebly\.com/i.test(html) ? 'found weebly.com referenced in page source' : null,
  },

  // ── Duda ─────────────────────────────────────────────────────────────────
  {
    name: 'Duda', category: 'website-builder', confidence: 'high',
    test: (html) => html.includes('irp.cdn-website.com') ? 'found irp.cdn-website.com asset host in page source' : null,
  },
  {
    name: 'Duda', category: 'website-builder', confidence: 'medium',
    test: (html) => /\bduda\b/i.test(html) ? 'found "duda" referenced in page source' : null,
  },

  // ── Jimdo ────────────────────────────────────────────────────────────────
  {
    name: 'Jimdo', category: 'website-builder', confidence: 'medium',
    test: (html) => /jimdo\.com/i.test(html) ? 'found jimdo.com referenced in page source' : null,
  },

  // ── Analytics (bonus, trivial to detect, useful signal on its own) ──────
  {
    name: 'Google Analytics', category: 'analytics', confidence: 'high',
    test: (html) => /www\.google-analytics\.com|gtag\(['"]config['"]|googletagmanager\.com\/gtag/i.test(html)
      ? 'found Google Analytics/gtag.js reference in page source' : null,
  },
  {
    name: 'Google Tag Manager', category: 'analytics', confidence: 'high',
    test: (html) => /googletagmanager\.com\/gtm\.js/i.test(html) ? 'found googletagmanager.com/gtm.js in page source' : null,
  },
  {
    name: 'Facebook Pixel', category: 'analytics', confidence: 'high',
    test: (html) => /connect\.facebook\.net\/[^"']*\/fbevents\.js/i.test(html) ? 'found fbevents.js reference in page source' : null,
  },

  // ── Live chat (also reused by website-audit.js's conversion checks) ─────
  {
    name: 'Intercom', category: 'live-chat', confidence: 'high',
    test: (html) => html.includes('widget.intercom.io') ? 'found widget.intercom.io in page source' : null,
  },
  {
    name: 'Drift', category: 'live-chat', confidence: 'high',
    test: (html) => html.includes('js.driftt.com') ? 'found js.driftt.com in page source' : null,
  },
  {
    name: 'Tawk.to', category: 'live-chat', confidence: 'high',
    test: (html) => html.includes('embed.tawk.to') ? 'found embed.tawk.to in page source' : null,
  },
];

/**
 * Shape a fetch response's headers into what the signature tests need.
 * Cookie NAMES only, never values — a session id or auth token has no
 * business being kept around for a fingerprinting pass.
 */
function shapeHeaders(headers) {
  const raw = {};
  for (const [k, v] of headers.entries()) raw[k.toLowerCase()] = v;

  const setCookie = headers.get('set-cookie') || '';
  const cookieNames = setCookie
    .split(/,(?=[^;]+?=)/) // split multiple Set-Cookie values joined by the Headers API
    .map(c => c.split('=')[0].trim())
    .filter(Boolean);

  return {
    raw,
    server: raw['server'] || '',
    poweredBy: raw['x-powered-by'] || '',
    cookieNames,
  };
}

/**
 * Run every signature against one page fetch. Exported separately so
 * website-audit.js (or a future caller that already has the HTML/headers
 * from its own fetch) can run the same catalog without a second network
 * round-trip.
 *
 * @returns {{name: string, category: string, confidence: string, evidence: string}[]}
 */
function matchSignatures(html, headers) {
  const shaped = headers && headers.raw ? headers : shapeHeaders(headers);
  const found = [];
  const seen = new Set(); // one hit per technology name — first (highest-confidence) match wins
  for (const sig of SIGNATURES) {
    if (seen.has(sig.name)) continue;
    let evidence;
    try {
      evidence = sig.test(html, shaped);
    } catch {
      evidence = null; // a malformed page must not crash detection
    }
    if (evidence) {
      found.push({ name: sig.name, category: sig.category, confidence: sig.confidence, evidence });
      seen.add(sig.name);
    }
  }
  return found;
}

/**
 * Detect the technology stack behind a URL.
 *
 * @param {string} url
 * @returns {Promise<{available: boolean, checked: boolean, technologies: object[], reason?: string}>}
 *   available:false means the site could not be fetched at all — never
 *   render that as "no technology detected", which would be a fabricated
 *   negative result about a site nobody actually looked at.
 */
async function detectTechnology(url) {
  let target;
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    target = new URL(withProto);
    if (!target.hostname.includes('.')) throw new Error('invalid hostname');
  } catch {
    return { available: false, checked: false, technologies: [], reason: 'Not a valid URL' };
  }

  let response;
  try {
    response = await safeFetchText(target.href, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      headers: {
        'User-Agent': 'NancyJamFancy/1.0 (+content research bot)',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });
  } catch (err) {
    return { available: false, checked: false, technologies: [], reason: `Could not fetch the site: ${err.message}` };
  }

  if (response.status < 200 || response.status >= 300) {
    return { available: false, checked: false, technologies: [], reason: `Site responded with HTTP ${response.status}` };
  }

  const html = response.text || '';
  const headers = shapeHeaders(response.headers);
  const technologies = matchSignatures(html, headers);

  return { available: true, checked: true, technologies };
}

module.exports = { detectTechnology, matchSignatures, shapeHeaders, SIGNATURES };
