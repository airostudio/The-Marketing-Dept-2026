/**
 * api/brand-kit-auto-detect.js — "as we have the website url, grab the logo
 * and colors and as much other info that it can before the user needs to do
 * all the work" — auto-populate the Brand Kit from the business's own site.
 *
 * POST { url: string, projectId?: string, intelProfileId?: string }
 * Returns: { success, detected: { logoUrl, logoSource, colours, fonts,
 *            websiteUrl, warnings } }
 *
 * Deliberately does NOT save anything to brand_kits itself. Every other
 * AI/scrape-derived surface in this codebase (Nancy's research, Scotty's
 * mission plans, the SEO audit findings) hands its output back for the human
 * to review before it becomes the account's canonical data — the logo/colors
 * detected here could be wrong (wrong page section, a stale cached
 * favicon, a competitor's colors bleeding into the page), so this returns a
 * proposal and the existing brand-kit-upload-logo.js / BrandKitStore.saveBrandKit
 * calls persist whatever the user actually confirms via "Save Brand Kit".
 *
 * Reuses the exact building blocks Nancy already crawls the web with —
 * crawlSite() for the SSRF-safe fetch, extractColours()/extractFontHints()
 * for the deterministic regex extraction — rather than re-implementing any
 * of it or making a second AI call that would just guess at the same thing
 * these already measure directly from the page's own markup.
 */

'use strict';

const { requireUser, callerOwnsScope } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { crawlSite, parseTarget } = require('./_lib/nancy-crawl.js');
const { extractColours, extractFontHints } = require('./_lib/nancy-colours.js');
const { detectLogo } = require('./_lib/logo-detect.js');
const { safeFetch } = require('./_lib/safe-fetch.js');
const { uploadToR2, isR2Configured } = require('./_lib/r2.js');

const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** Re-hosts a detected logo to R2 so it's a stable, reusable URL — the
 *  original is on a third-party site the user doesn't control and could
 *  change or disappear. Returns null (not an error) on any failure — a
 *  failed re-host just means the caller falls back to the original URL for
 *  preview, same "never let an optional step fail the whole request"
 *  pattern used everywhere else in this file. */
async function rehostLogo(logoUrl, scopeKey) {
  if (!isR2Configured()) return null;
  try {
    const res = await safeFetch(logoUrl, { timeoutMs: 10000 });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/png';
    if (!/^image\//.test(contentType)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > MAX_LOGO_BYTES) return null;
    const ext = (contentType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'png';
    return await uploadToR2(`brand-kit-logos/${scopeKey}/detected-${Date.now()}.${ext}`, buf, contentType);
  } catch {
    return null;
  }
}

module.exports = withFailureReporting('api/brand-kit-auto-detect', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireUser(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'brand-kit-auto-detect', max: 10, windowMs: 60 * 1000, auth })) return;

  const { url, projectId, intelProfileId } = req.body || {};
  if (!projectId && !intelProfileId) {
    return res.status(400).json({ error: 'projectId or intelProfileId is required' });
  }
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });

  const owns = await callerOwnsScope(auth.userId, { projectId, intelProfileId });
  if (!owns) return res.status(403).json({ error: 'You do not have access to this business.' });

  let target;
  try {
    target = parseTarget(url);
  } catch {
    return res.status(400).json({ error: 'That does not look like a valid website address.' });
  }

  let crawl;
  try {
    crawl = await crawlSite(target.href);
  } catch (err) {
    return res.status(422).json({ error: `Could not read ${target.hostname}: ${err.message}` });
  }

  const warnings = [];
  const html = crawl.homepageHtml || '';
  const css = crawl.homepageCss || '';

  const colourResult = extractColours(html, css);
  const fontHints = extractFontHints(html, css);
  if (!colourResult.primary) warnings.push('No brand colours could be detected on the homepage — none were declared in its CSS.');
  if (!fontHints.length) warnings.push('No font names could be detected on the homepage.');

  let logoUrl = null;
  let logoSource = null;
  if (html) {
    const logoResult = detectLogo(html, crawl.homepageUrl || target.href);
    if (logoResult.logoUrl) {
      logoUrl = logoResult.logoUrl;
      logoSource = logoResult.source;
      const scopeKey = intelProfileId ? `profile-${intelProfileId}` : `project-${projectId}`;
      const rehosted = await rehostLogo(logoUrl, scopeKey);
      if (rehosted) { logoUrl = rehosted; logoSource += ' (re-hosted)'; }
      else warnings.push('A logo was found but could not be re-hosted — using the original link, which may break if the site changes.');
    } else {
      warnings.push(logoResult.reason);
    }
  } else {
    warnings.push('Could not read the homepage HTML.');
  }

  return res.json({
    success: true,
    detected: {
      logoUrl,
      logoSource,
      websiteUrl: target.href,
      colours: {
        primary: colourResult.primary || undefined,
        secondary: colourResult.secondary[0] || undefined,
        accent: colourResult.accent[0] || undefined,
      },
      fonts: {
        heading: fontHints[0] || undefined,
        body: fontHints[1] || fontHints[0] || undefined,
      },
      warnings,
    },
  });
});
