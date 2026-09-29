/**
 * api/seo-backlink-find-email.js — SEO Pipeline: find a real contact email
 * for a backlink prospect's domain.
 *
 * POST { domain, page_url? }
 * Returns: { success, email: string|null, contact_name: string|null,
 *   data_source: 'real'|'estimate'|'not_found', source_url? }
 *
 * The lookup itself lives in api/_lib/email-lookup.js — shared with
 * api/cron-sales-intel-sweep.js, which needs the identical lookup for a
 * business it just discovered itself, without an internal HTTP round-trip
 * to this endpoint. See that file for the full two-step reasoning (crawl the
 * business's own site first, fall back to a live search only if that finds
 * nothing).
 *
 * Always returns 200 with data_source:'not_found' rather than erroring when
 * nothing is found — the user fills it in manually in that case, same as
 * every other "no real data available" path in this app.
 */

'use strict';

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { findContactEmail } = require('./_lib/email-lookup.js');

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 15;

module.exports = withFailureReporting('api/seo-backlink-find-email', async function handler(req, res) {
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

  if (rateLimited(req, res, { name: 'seo-backlink-find-email', max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, auth })) return;

  const { domain } = req.body || {};
  if (!domain || !String(domain).trim()) return res.status(400).json({ error: 'domain is required' });

  const { email, dataSource } = await findContactEmail(domain);
  return res.json({ success: true, email, contact_name: null, data_source: dataSource });
});
