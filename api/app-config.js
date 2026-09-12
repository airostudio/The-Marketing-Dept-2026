const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
/**
 * api/app-config.js
 * Serves public frontend configuration from Vercel environment variables.
 * Safe to expose: Supabase anon key is designed to be public.
 *
 * GET /api/app-config          → { supabaseUrl, supabaseKey, configured }
 * GET /api/app-config?probe=1  → the above, plus a `serverAuth` block
 *
 * ── Why the probe is here, and unauthenticated ─────────────────────────────
 *
 * /api/health answers this and much more, but it requires an admin — and an
 * admin is identified by requireUser(), which is the thing that fails when
 * the server's own Supabase credentials are wrong. The diagnostic was
 * unreachable in exactly the situation it existed for: every request
 * returning "your session has expired" with no way to find out why.
 *
 * So this answers one question, for anybody: can the server authenticate
 * ITSELF to Supabase? It returns booleans and a coarse reason. It does not
 * return key names, key lengths, environment variable names, or any part of
 * a secret — nothing that is not already implied by the outage the caller is
 * currently experiencing.
 */

/**
 * Ask Supabase to validate a token we know is invalid.
 *
 * The point is not the token — it is which complaint comes back:
 *
 *   "Invalid API key"  → our apikey header is wrong. SUPABASE_SERVICE_ROLE_KEY
 *                        is missing, truncated, or belongs to a different
 *                        project than SUPABASE_URL. Every customer's request
 *                        fails, no matter how fresh their session.
 *
 *   invalid JWT        → our credentials are fine and Supabase is answering
 *                        properly. A customer seeing "session expired" really
 *                        does need to sign in again.
 */
async function probeServerAuth() {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl) return { ok: false, reason: 'SUPABASE_URL is not set' };
  if (!serviceKey) return { ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY is not set' };

  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: 'Bearer probe.invalid.token' },
      signal: AbortSignal.timeout(8000),
    });
    const body = await r.json().catch(() => null);
    const msg = String((body && (body.msg || body.message || body.error_description || body.error)) || '');

    if (/invalid api key|no api key/i.test(msg)) {
      return {
        ok: false,
        reason: 'Supabase rejected the server\'s own API key. SUPABASE_SERVICE_ROLE_KEY ' +
                'is missing, truncated, or belongs to a different project than SUPABASE_URL. ' +
                'Signing in again will not help any customer until this is corrected.',
      };
    }
    if (r.status === 404) {
      return { ok: false, reason: 'SUPABASE_URL does not point at a Supabase project (404 from /auth/v1/user).' };
    }
    // A complaint about the token is the healthy answer: it means the key was
    // accepted and Supabase got as far as reading the token we sent.
    return { ok: true, reason: 'The server\'s Supabase credentials are accepted.' };
  } catch (e) {
    return { ok: false, reason: 'Supabase is unreachable from the server: ' + String(e && e.message).slice(0, 120) };
  }
}

module.exports = withFailureReporting('api/app-config', async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
    const configured  = !!(supabaseUrl && supabaseKey);

    if (req.query && (req.query.probe === '1' || req.query.probe === 'true')) {
      // The probe makes an outbound request, so it is bounded far more
      // tightly than the cached config read below. Keyed on the address
      // because there is no account here to key on.
      if (rateLimited(req, res, { name: 'app-config-probe', max: 6, windowMs: 60_000 })) return;
      const serverAuth = await probeServerAuth();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ supabaseUrl, supabaseKey, configured, serverAuth });
    }

    // Cache for 5 minutes — public keys don't change often
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ supabaseUrl, supabaseKey, configured });
});
