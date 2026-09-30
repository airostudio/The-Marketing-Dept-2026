/**
 * api/site-structure-map.js — map a site's real page structure: which
 * pages it actually has (from its own sitemap.xml, or real homepage links
 * when there's no sitemap — never a guessed list of common paths), each
 * page's headings/sections/images, its navigation, and its real brand
 * colours/fonts.
 *
 * This is the discovery step behind "migrate this site" workflows (a
 * GoDaddy/Wix/Squarespace rebuild pitch needs to know what the site
 * actually contains before anything can be regenerated), but it's
 * deliberately generic — mapping any site's structure is useful on its
 * own, independent of any specific migration target.
 *
 * POST { url: string }
 * Returns: { success, origin, brand: {colors, fonts}, navigation: [{label, path}],
 *   pages: [{url, path, meta: {title, description}, sections: [...], images: [...]}],
 *   pagesDiscovered, pagesCrawled }
 *
 * A genuinely expensive call (up to 20 page fetches + linked stylesheets),
 * so rate limited more tightly than a single-page lookup.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { mapSiteStructure } = require('./_lib/site-structure.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 6;

module.exports = withFailureReporting('api/site-structure-map', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Every path below reaches this server's own crawler against a caller-
  // named URL, up to 20 times. Identify the caller before spending any of
  // it; a rate limit caps the speed, not the entitlement.
  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'site-structure-map', max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, auth })) return;

  const { url } = req.body || {};
  if (!url || !String(url).trim()) return res.status(400).json({ error: 'url is required' });

  try {
    const structure = await mapSiteStructure(String(url).trim());
    return res.json({ success: true, ...structure });
  } catch (e) {
    return res.status(422).json({ success: false, error: e.message });
  }
});
