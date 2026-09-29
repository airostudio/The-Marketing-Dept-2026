/**
 * api/blade-website-check.js — Blade: fast heuristic website-health check
 * for a single scraped business, so results can be filtered into
 * "no website" / "outdated" / "modern" / "unreachable" buckets.
 *
 * POST { website }
 * Returns: { success, status: 'unreachable'|'outdated'|'modern',
 *   signals: { hasViewport, https, copyrightYear, oldGenerator, hasFlash, platform },
 *   reasons: string[] }
 *
 * The check itself lives in api/_lib/website-quickcheck.js — shared with
 * api/cron-sales-intel-sweep.js, which needs the identical heuristic
 * without an internal HTTP round-trip to this endpoint. See that file for
 * why this is a single fast fetch + regex pass, not Chase's full PageSpeed
 * audit (api/_lib/website-audit.js), and why `signals.platform`
 * (GoDaddy/Wix/Squarespace) is its own deliberately-prioritized signal.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { quickCheckWebsite } = require('./_lib/website-quickcheck.js');

module.exports = withFailureReporting('api/blade-website-check', async function handler(req, res) {
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

  if (rateLimited(req, res, { name: 'blade-website-check', max: 40, windowMs: 60 * 1000, auth })) return;

  const { website } = req.body || {};
  if (!website || !String(website).trim()) return res.status(400).json({ error: 'website is required' });

  const result = await quickCheckWebsite(String(website).trim());
  return res.json({ success: true, ...result });
});
