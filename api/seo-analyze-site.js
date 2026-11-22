/**
 * api/seo-analyze-site.js — SEO Pipeline Stage 1: Business & Site Analysis
 *
 * POST { url: string }
 * Returns: { success, profile: { business_summary, products_services,
 *   target_customer, existing_topics, primary_offer }, pagesFetched }
 *
 * Crawls the business's own site (same bounded, SSRF-safe crawler Nancy
 * uses — api/_lib/nancy-crawl.js is generic, not Nancy-specific) and asks
 * Claude to extract what the business actually sells and what topics it has
 * already published on, so the content plan generated later doesn't
 * duplicate existing coverage or invent products that don't exist.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
// The crawl, the untrusted-content fencing and the prompt live in the shared
// engine, which SEO Autopilot's background jobs also use.
const { analyzeSite } = require('./_lib/seo-engine.js');

module.exports = withFailureReporting('api/seo-analyze-site', async function handler(req, res) {
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

  if (rateLimited(req, res, { name: 'seo-analyze-site', max: 6, windowMs: 60 * 1000, auth })) return;

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    const { profile, pagesFetched } = await analyzeSite(url);
    return res.json({ success: true, profile, pagesFetched });
  } catch (err) {
    return res.status(err.kind === 'site_unreachable' ? 422 : 502).json({ success: false, error: err.message });
  }
});
