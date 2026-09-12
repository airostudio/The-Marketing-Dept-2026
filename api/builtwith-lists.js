/**
 * api/builtwith-lists.js — BuiltWith Lists API proxy (reverse lookup: every
 * domain using a given technology) for the internal research tool
 * (web/tools/builtwith-research.html). This is the highest-value endpoint —
 * the actual capability upgrade over the existing per-URL tech-detect
 * module — so treat its normalized output as best-effort and lean on `raw`.
 *
 * POST { technology, filters? }
 *   filters may include: since (e.g. "30 Days Ago"), offset (pagination
 *   cursor from a previous call's totalCount/raw.NextOffset), country —
 *   only pass through filters BuiltWith's Lists API is documented to
 *   support; do not invent params it does not have.
 * Returns: { success, technology, domains: [{domain, ...}], totalCount, raw }
 *
 * See the large warning block at the top of api/_lib/builtwith-client.js.
 * Two things there matter most for this endpoint specifically:
 *   1. The Lists API is believed to be SYNCHRONOUS (return results directly,
 *      no submit-then-poll flow) based on every source found — but this was
 *      not confirmed against live docs or a real key, and some bulk export
 *      APIs elsewhere do use submit-then-poll, so if a real call comes back
 *      with something like {status:"queued", jobId:...} instead of results,
 *      this file needs a poll loop added before it can be trusted.
 *   2. The exact URL version segment (guessed as "lists1") and the exact
 *      response field names (guessed as Results[].Domain, NextOffset) are
 *      UNVERIFIED — confirm both against a real call before production use.
 *
 * Gated by BOTH normal Audema login AND the separate BuiltWith unlock token.
 */

'use strict';

const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { requireInternalToolsAccess } = require('./_lib/internal-tools-access-token.js');
const { callBuiltWith } = require('./_lib/builtwith-client.js');

// Only filters found described in BuiltWith's Lists API materials. Anything
// else in the request body's `filters` is dropped rather than forwarded, so
// a typo or an invented param never silently reaches (and is silently
// ignored by, or worse misinterpreted by) the real API.
const SUPPORTED_FILTER_PARAMS = {
  since: 'SINCE',       // e.g. "30 Days Ago", "Last January"
  offset: 'OFFSET',     // pagination cursor — pass back a prior NextOffset verbatim
  country: 'COUNTRY',   // UNVERIFIED — not directly confirmed in sources found; left
                         // in behind this allowlist in case a real response error names
                         // the correct key, rather than guessing further at call time.
  includeMetaData: 'includeMetaData',
};

function buildParams(filters) {
  const params = {};
  if (!filters || typeof filters !== 'object') return params;
  for (const [key, upstreamKey] of Object.entries(SUPPORTED_FILTER_PARAMS)) {
    if (filters[key] !== undefined && filters[key] !== null && filters[key] !== '') {
      params[upstreamKey] = String(filters[key]);
    }
  }
  return params;
}

/**
 * Best-effort flatten of the Lists API's per-domain results. UNVERIFIED
 * shape — see warning block. Passes through whatever per-domain metadata
 * fields exist under whatever key they arrive under, so a customer-visible
 * field is never silently dropped even if this guesses the field's name
 * wrong at the top level.
 */
function normalizeListsResult(data) {
  const rows = Array.isArray(data && data.Results) ? data.Results
             : Array.isArray(data && data.Domains) ? data.Domains
             : Array.isArray(data) ? data
             : [];
  const domains = rows.map(r => {
    if (typeof r === 'string') return { domain: r };
    return {
      domain: r.Domain || r.domain || r.URL || r.url || null,
      ...r, // keep every field the real API actually returned, whatever it's called
    };
  });
  const totalCount = (data && (data.Total || data.TotalCount || data.Count)) ?? domains.length;
  return { domains, totalCount };
}

module.exports = withFailureReporting('api/builtwith-lists', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-BuiltWith-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireInternalToolsAccess(req, res);
  if (!auth) return;

  // Moderate — an internal tool, but still a real external API with a real,
  // paid quota behind it.
  if (rateLimited(req, res, { name: 'builtwith-lists', max: 20, windowMs: 60 * 1000, auth })) return;

  const { technology, filters } = req.body || {};
  if (!technology || !String(technology).trim()) {
    return res.status(400).json({ error: 'technology is required' });
  }

  const result = await callBuiltWith('lists', String(technology).trim(), buildParams(filters));
  if (!result.ok) {
    return res.status(result.status && result.status >= 400 ? 502 : 503).json({
      error: `BuiltWith Lists lookup failed: ${result.reason}`,
      code: 'builtwith_upstream_error',
      raw: result.raw ?? null,
    });
  }

  const { domains, totalCount } = normalizeListsResult(result.data);

  return res.status(200).json({
    success: true,
    technology: String(technology).trim(),
    domains,
    totalCount,
    raw: result.data,
  });
});
