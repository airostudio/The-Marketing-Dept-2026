/**
 * api/nancy-screenshot.js — Nancy Step 3: Live Website Screenshot
 *
 * POST { url: string }
 * Returns: {
 *   success, origin,
 *   screenshot: { available, dataUri?, hostedUrl?, reason?, mimeType? },
 *   colourCandidates: { primary, secondary, accent, allCandidates },
 *   fontHints: string[],
 * }
 *
 * Does exactly ONE slow external call — the screenshot capture — plus a
 * fast, parallelized page crawl for CSS colour/font extraction (see
 * nancy-crawl.js). Split from what used to be nancy-brand-extract.js so the
 * screenshot capture and the Claude vision read (nancy-brand-identity.js)
 * never share one Vercel function's 60s ceiling.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');

const { crawlSite } = require('./_lib/nancy-crawl.js');
const { extractColours, extractFontHints } = require('./_lib/nancy-colours.js');
const { screenshotProvider } = require('./_lib/nancy-providers.js');
const { uploadToR2, isR2Configured } = require('./_lib/r2.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 6;


module.exports = withFailureReporting('api/nancy-screenshot', async function handler(req, res) {
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

  if (rateLimited(req, res, { name: 'nancy-screenshot', max: 6, windowMs: 60 * 1000, auth })) return;

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  let crawl;
  try {
    crawl = await crawlSite(url);
  } catch (err) {
    return res.status(422).json({ success: false, error: err.message });
  }
  if (!crawl.homepageHtml) {
    return res.status(422).json({ success: false, error: 'Could not fetch the homepage to inspect its CSS.' });
  }

  // The site's linked stylesheets, not just its inline CSS — see the note in
  // nancy-crawl.js. Without them this returned no candidates on most real
  // sites, and the brand step went on to name a colour nobody had measured.
  const colourCandidates = extractColours(crawl.homepageHtml, crawl.homepageCss);
  const fontHints = extractFontHints(crawl.homepageHtml, crawl.homepageCss);

  try {
    const shot = await screenshotProvider(crawl.origin);

    let screenshotResult = { available: false, reason: shot.reason };
    if (shot.available) {
      const dataUri = `data:${shot.mimeType};base64,${shot.buffer.toString('base64')}`;
      let hostedUrl = null;
      if (isR2Configured()) {
        try {
          hostedUrl = await uploadToR2(`nancy-screenshots/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`, shot.buffer, shot.mimeType);
        } catch (err) { console.warn('[nancy-screenshot] R2 upload failed:', err.message); }
      }
      screenshotResult = { available: true, dataUri, hostedUrl, mimeType: shot.mimeType };
    }

    return res.json({ success: true, origin: crawl.origin, screenshot: screenshotResult, colourCandidates, fontHints });
  } catch (err) {
    // Defense-in-depth — screenshotProvider itself never throws, but a
    // crash here should still come back as JSON, not a platform error page.
    return res.status(500).json({ success: false, error: err.message || 'Screenshot capture failed unexpectedly.' });
  }
});
