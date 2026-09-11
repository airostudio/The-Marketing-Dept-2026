/**
 * api/_lib/builtwith-access-token.js — signed, time-limited "unlock" token for
 * the internal BuiltWith research tool (web/tools/builtwith-research.html).
 *
 * Not a Vercel route (api/_lib/ is excluded from routing) — imported by
 * api/builtwith-unlock.js (issues) and by every api/builtwith-*.js proxy
 * endpoint (verifies, via requireBuiltWithAccess below).
 *
 * ── Why a second gate on top of normal login ────────────────────────────────
 *
 * Every signed-in Audema customer already clears requireUser(). BuiltWith is
 * a paid, metered subscription the team holds for its own research — it must
 * not be reachable by every customer account, only by whoever the team hands
 * the shared password to. So this is deliberately a SEPARATE secret and a
 * SEPARATE short-lived token, layered on top of (never instead of) the normal
 * Supabase session check. Losing this token leaks nothing but "can spend
 * BuiltWith quota"; it is not a login credential and is never treated as one.
 *
 * Same shape as api/_lib/unsubscribe-token.js: HMAC-SHA256 via Node's
 * `crypto`, `crypto.timingSafeEqual` for verification, a dedicated env var
 * with a documented fallback so this works with zero extra setup for anyone
 * who already has Supabase configured.
 */

'use strict';

const crypto = require('crypto');

function secret() {
  // BUILTWITH_TOOL_SECRET is preferred. Falling back to the Supabase
  // service-role key is the same precedent as unsubscribe-token.js — every
  // deployment of this app already has that configured, so the tool works
  // out of the box rather than silently refusing to issue tokens.
  return process.env.BUILTWITH_TOOL_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function b64urlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64url');
}

function b64urlDecode(str) {
  return Buffer.from(String(str), 'base64url').toString('utf8');
}

function sign(payloadB64) {
  const s = secret();
  if (!s) return null;
  return crypto.createHmac('sha256', s).update(payloadB64).digest('hex').slice(0, 32);
}

/**
 * Issue a signed unlock token for userId, valid for ttlMs (default 8 hours).
 * Returns { token, expiresAt } — expiresAt is a millisecond epoch timestamp,
 * safe to expose to the client for a friendly "your unlock expired" state.
 * Returns null if no secret is configured (caller must treat that as a
 * config error, never as "issue an unverifiable token").
 */
function issueToken(userId, ttlMs = 8 * 60 * 60 * 1000) {
  if (!userId) return null;
  const s = secret();
  if (!s) return null;

  const expiresAt = Date.now() + ttlMs;
  const payloadB64 = b64urlEncode(JSON.stringify({ userId, exp: expiresAt }));
  const sig = sign(payloadB64);
  if (!sig) return null;

  return { token: `${payloadB64}.${sig}`, expiresAt };
}

/**
 * Verify a token string. Returns { valid: true, userId, expiresAt } or
 * { valid: false, reason }. The signature is checked BEFORE anything in the
 * payload is trusted — a forged or altered payload never reaches the exp
 * check, let alone the caller.
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return { valid: false, reason: 'missing_token' };

  const dot = token.lastIndexOf('.');
  if (dot < 1 || dot === token.length - 1) return { valid: false, reason: 'malformed_token' };

  const payloadB64 = token.slice(0, dot);
  const givenSig = token.slice(dot + 1);

  const expectedSig = sign(payloadB64);
  if (!expectedSig) return { valid: false, reason: 'not_configured' };

  const a = Buffer.from(expectedSig);
  const b = Buffer.from(givenSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch (e) {
    return { valid: false, reason: 'malformed_payload' };
  }

  if (!payload || typeof payload.exp !== 'number' || !payload.userId) {
    return { valid: false, reason: 'malformed_payload' };
  }
  if (Date.now() > payload.exp) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, userId: payload.userId, expiresAt: payload.exp };
}

/**
 * Two-layer check every BuiltWith-spending endpoint must run before touching
 * BuiltWith or spending anything: normal Supabase auth (requireUser), AND
 * this tool's own unlock token in the X-BuiltWith-Token header. Either layer
 * failing answers the request itself and returns null, so a caller that
 * forgets to check cannot accidentally spend BuiltWith quota for a caller who
 * never entered the password.
 */
async function requireBuiltWithAccess(req, res) {
  const { requireUser } = require('./require-user.js');

  const auth = await requireUser(req, res);
  if (!auth) return null;

  const token = req.headers['x-builtwith-token'];
  const check = verifyToken(token);
  if (!check.valid) {
    res.status(403).json({
      error: 'BuiltWith research tool is locked. Enter the access password.',
      code: 'builtwith_locked',
    });
    return null;
  }

  return auth;
}

module.exports = { issueToken, verifyToken, requireBuiltWithAccess, isConfigured: () => !!secret() };
