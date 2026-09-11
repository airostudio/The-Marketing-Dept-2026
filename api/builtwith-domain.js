/**
 * api/builtwith-domain.js — BuiltWith Domain API proxy for the internal
 * research tool (web/tools/builtwith-research.html).
 *
 * POST { domain }
 * Returns: { success, domain, technologies: [{name, category, firstDetected,
 *            lastDetected}], raw }
 *
 * See the large warning block at the top of api/_lib/builtwith-client.js —
 * the request/response shape used here was reconstructed from web search
 * results, not a direct read of BuiltWith's live docs (blocked in this
 * session) or a real API call. `raw` always carries the full unmodified
 * upstream body so nothing the real API returns is hidden by a wrong guess
 * at field names in normalizeDomainResult() below.
 *
 * Gated by BOTH normal Audema login (requireUser, inside
 * requireBuiltWithAccess) AND the separate BuiltWith unlock token — never
 * one without the other.
 */

'use strict';

const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { requireBuiltWithAccess } = require('./_lib/builtwith-access-token.js');
const { callBuiltWith } = require('./_lib/builtwith-client.js');

/**
 * Best-effort flatten of the Domain API's technology list into
 * {name, category, firstDetected, lastDetected}. UNVERIFIED nesting — see
 * the warning block in api/_lib/builtwith-client.js. Tries a couple of
 * plausible shapes rather than assuming one, and never throws on a shape it
 * does not recognise — it just returns fewer normalized rows, while `raw`
 * still carries everything.
 */
function normalizeDomainResult(data) {
  const technologies = [];
  try {
    const results = Array.isArray(data && data.Results) ? data.Results : [];
    for (const r of results) {
      const paths = Array.isArray(r && r.Result && r.Result.Paths) ? r.Result.Paths : [];
      for (const p of paths) {
        const techs = Array.isArray(p && p.Technologies) ? p.Technologies : [];
        for (const t of techs) {
          technologies.push({
            name: t.Name || t.name || null,
            category: (Array.isArray(t.Categories) && t.Categories[0] && (t.Categories[0].Name || t.Categories[0])) ||
                      t.Tag || t.category || null,
            firstDetected: t.FirstDetected || t.firstDetected || null,
            lastDetected: t.LastDetected || t.lastDetected || null,
          });
        }
      }
    }
  } catch (e) {
    // Shape did not match any of the guesses above — leave technologies as
    // whatever was collected so far; `raw` still has everything.
  }
  return technologies;
}

module.exports = withFailureReporting('api/builtwith-domain', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-BuiltWith-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireBuiltWithAccess(req, res);
  if (!auth) return;

  if (rateLimited(req, res, { name: 'builtwith-domain', max: 20, windowMs: 60 * 1000, auth })) return;

  const { domain } = req.body || {};
  if (!domain || !String(domain).trim()) return res.status(400).json({ error: 'domain is required' });

  const result = await callBuiltWith('domain', String(domain).trim());
  if (!result.ok) {
    return res.status(result.status && result.status >= 400 ? 502 : 503).json({
      error: `BuiltWith Domain lookup failed: ${result.reason}`,
      code: 'builtwith_upstream_error',
      raw: result.raw ?? null,
    });
  }

  return res.status(200).json({
    success: true,
    domain: String(domain).trim(),
    technologies: normalizeDomainResult(result.data),
    raw: result.data,
  });
});
