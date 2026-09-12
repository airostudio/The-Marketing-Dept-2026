/**
 * api/builtwith-relationships.js — BuiltWith Relationships API proxy for the
 * internal research tool (web/tools/builtwith-research.html).
 *
 * POST { domain }
 * Returns: { success, subject, related: [{...}], raw }
 *
 * See the large warning block at the top of api/_lib/builtwith-client.js.
 * Search results confirmed this product keys on a DOMAIN via LOOKUP (not a
 * technology) — "The LOOKUP parameter accepts domains and sub-domains" — and
 * an explicit worked example URL
 * (.../rv4/api.json?KEY=..&LOOKUP=<domain>) was found, so the endpoint and
 * the key parameter are on firmer ground than Lists. The response JSON's
 * exact field names are still UNVERIFIED and must be checked against a real
 * call before production use.
 *
 * Gated by BOTH normal Audema login AND the separate BuiltWith unlock token.
 */

'use strict';

const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { requireInternalToolsAccess } = require('./_lib/internal-tools-access-token.js');
const { callBuiltWith } = require('./_lib/builtwith-client.js');

/**
 * Best-effort flatten of the Relationships API's related-site list.
 * UNVERIFIED shape — "what sites are linked together, by what and for how
 * long" is the only description found, not a field-level schema.
 */
function normalizeRelationshipsResult(data) {
  const rows = Array.isArray(data && data.Relationships) ? data.Relationships
             : Array.isArray(data && data.Results) ? data.Results
             : Array.isArray(data) ? data
             : [];
  return rows.map(r => ({
    domain: r.Domain || r.domain || r.URL || r.url || null,
    type: r.Type || r.type || r.Relationship || null,
    firstDetected: r.FirstIndexed || r.FirstDetected || r.firstDetected || null,
    lastDetected: r.LastIndexed || r.LastDetected || r.lastDetected || null,
    ...r,
  }));
}

module.exports = withFailureReporting('api/builtwith-relationships', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-BuiltWith-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireInternalToolsAccess(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'builtwith-relationships', max: 20, windowMs: 60 * 1000, auth })) return;

  const { domain } = req.body || {};
  if (!domain || !String(domain).trim()) {
    return res.status(400).json({ error: 'domain is required' });
  }

  const result = await callBuiltWith('relationships', String(domain).trim());
  if (!result.ok) {
    return res.status(result.status && result.status >= 400 ? 502 : 503).json({
      error: `BuiltWith Relationships lookup failed: ${result.reason}`,
      code: 'builtwith_upstream_error',
      raw: result.raw ?? null,
    });
  }

  return res.status(200).json({
    success: true,
    subject: String(domain).trim(),
    related: normalizeRelationshipsResult(result.data),
    raw: result.data,
  });
});
