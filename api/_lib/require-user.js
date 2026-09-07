/**
 * api/_lib/require-user.js — an endpoint that spends money needs to know who
 * is spending it.
 *
 * Not a Vercel route; api/_lib/ is excluded from routing.
 *
 * ── Why ──────────────────────────────────────────────────────────────────
 *
 * The enrichment endpoints call Apollo, Hunter.io, Perplexity and Claude on
 * the account's own API keys, and none of them checked who was calling. An
 * unauthenticated enrichment endpoint is not a data leak so much as a direct
 * line into the owner's billing: anyone who found the URL could run Apollo
 * lookups, Hunter verifications and Perplexity searches indefinitely, paid
 * for by the account, and could equally use it as a free proxy to those
 * services.
 *
 * A rate limit is not a substitute. It caps how fast the money goes, not
 * whether the caller was ever entitled to spend it.
 *
 * Usage:
 *   const { requireUser } = require('./_lib/require-user.js');
 *   const auth = await requireUser(req, res);
 *   if (!auth) return;              // requireUser already answered
 *   const { userId, profile } = auth;
 */

'use strict';

const { sbRest } = require('./supabase-rest.js');

/**
 * Identify the caller, or answer the request and return null.
 *
 * Returns { userId, profile } on success. On failure it writes the response
 * itself and returns null, so a caller that forgets to check cannot
 * accidentally continue with no user — the worst outcome would be spending
 * money for an unidentified caller, which is the thing being prevented.
 *
 * Deliberately fails CLOSED when Supabase is unreachable. Being unable to
 * verify a caller is not the same as verifying them, and treating it as such
 * would reopen the hole every time the database had a bad minute.
 */
async function requireUser(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({
      error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured, so the caller ' +
             'cannot be identified. Refusing to spend API credits for an unknown caller.',
    });
    return null;
  }

  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in to use this.', code: 'no_token' });
    return null;
  }

  let user = null;
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) user = await r.json();
  } catch (e) {
    res.status(503).json({
      error: 'Could not verify your session, so nothing was run.',
      code: 'auth_unreachable',
    });
    return null;
  }

  if (!user || !user.id) {
    res.status(401).json({ error: 'Your session has expired. Sign in again.', code: 'invalid_token' });
    return null;
  }

  const p = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/profiles?id=eq.${user.id}&select=id,plan,role&limit=1`);

  return { userId: user.id, profile: (p.ok && p.data && p.data[0]) || {} };
}

module.exports = { requireUser };
