/**
 * api/builtwith-trends.js — BuiltWith Trends API proxy for the internal
 * research tool (web/tools/builtwith-research.html).
 *
 * POST { technology }
 * Returns: { success, technology, trend: [{period, count}], raw }
 *
 * See the large warning block at the top of api/_lib/builtwith-client.js.
 * The endpoint URL and an explicit worked example for this product were
 * both found in web search results (.../trends/v6/api.json?KEY=..&TECH=..),
 * so this one is on somewhat firmer ground than Lists — but the response
 * JSON's exact field names are still UNVERIFIED and must be checked against
 * a real call before production use.
 *
 * Gated by BOTH normal Audema login AND the separate BuiltWith unlock token.
 */

'use strict';

const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { requireBuiltWithAccess } = require('./_lib/builtwith-access-token.js');
const { callBuiltWith } = require('./_lib/builtwith-client.js');

/**
 * Best-effort flatten of the Trends API's time series. UNVERIFIED shape.
 */
function normalizeTrendResult(data) {
  const rows = Array.isArray(data && data.Results) ? data.Results
             : Array.isArray(data && data.Trend) ? data.Trend
             : Array.isArray(data) ? data
             : [];
  return rows.map(r => ({
    period: r.Date || r.date || r.Month || r.month || r.Period || null,
    count: r.Count || r.count || r.Total || r.total || r.Share || r.share || null,
    ...r,
  }));
}

module.exports = withFailureReporting('api/builtwith-trends', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-BuiltWith-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireBuiltWithAccess(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'builtwith-trends', max: 20, windowMs: 60 * 1000, auth })) return;

  const { technology } = req.body || {};
  if (!technology || !String(technology).trim()) {
    return res.status(400).json({ error: 'technology is required' });
  }

  const result = await callBuiltWith('trends', String(technology).trim());
  if (!result.ok) {
    return res.status(result.status && result.status >= 400 ? 502 : 503).json({
      error: `BuiltWith Trends lookup failed: ${result.reason}`,
      code: 'builtwith_upstream_error',
      raw: result.raw ?? null,
    });
  }

  return res.status(200).json({
    success: true,
    technology: String(technology).trim(),
    trend: normalizeTrendResult(result.data),
    raw: result.data,
  });
});
