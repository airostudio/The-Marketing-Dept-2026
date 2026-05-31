/**
 * OAuth 2.0 Authorization Code Issuer
 *
 * Called by the consent screen (web/oauth/authorize.html) after the user
 * clicks "Allow".  Issues a short-lived signed auth code that Webese
 * exchanges at /api/oauth-token.
 *
 * Env vars required:
 *   OAUTH_JWT_SECRET      — HMAC-SHA256 signing secret (≥ 32 chars)
 *   WEBESE_CLIENT_ID      — Webese's registered client_id
 *   WEBESE_REDIRECT_URIS  — Comma-separated allowed redirect URIs
 */

const crypto = require('crypto');

const CODE_TTL_SEC  = 10 * 60;   // auth code valid 10 minutes
const BRAND_MAX_LEN = 4096;       // cap brand snapshot bytes in JWT

const ALLOWED_SCOPES = new Set(['brand:read', 'generate:write', 'seo:read']);

// ── JWT helpers (no external deps) ───────────────────────────────────────────

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signJWT(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body   = b64url(JSON.stringify(payload));
  const sig    = crypto.createHmac('sha256', secret)
    .update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

// ── CORS helper ───────────────────────────────────────────────────────────────

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  process.env.WEBESE_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.OAUTH_JWT_SECRET;
  if (!secret || secret.length < 32) {
    return res.status(500).json({ error: 'OAuth not configured' });
  }

  const {
    client_id,
    redirect_uri,
    scope      = 'brand:read generate:write',
    state,
    user_email,
    user_id,
    brand_snapshot,
  } = req.body || {};

  // ── Validate client ───────────────────────────────────────────────────────
  if (client_id !== process.env.WEBESE_CLIENT_ID) {
    return res.status(400).json({ error: 'invalid_client' });
  }

  const allowedUris = (process.env.WEBESE_REDIRECT_URIS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!allowedUris.includes(redirect_uri)) {
    return res.status(400).json({ error: 'invalid_redirect_uri' });
  }

  // ── Validate scopes ───────────────────────────────────────────────────────
  const requestedScopes = scope.split(' ').filter(s => ALLOWED_SCOPES.has(s));
  if (requestedScopes.length === 0) {
    return res.status(400).json({ error: 'invalid_scope' });
  }

  // ── Validate user fields ──────────────────────────────────────────────────
  if (!user_email || !user_id) {
    return res.status(400).json({ error: 'missing user identity' });
  }

  // ── Trim brand snapshot to cap JWT size ───────────────────────────────────
  let brand = null;
  if (brand_snapshot && typeof brand_snapshot === 'object') {
    const raw = JSON.stringify(brand_snapshot);
    brand = raw.length <= BRAND_MAX_LEN
      ? brand_snapshot
      : _trimBrand(brand_snapshot);
  }

  // ── Issue signed auth code ────────────────────────────────────────────────
  const now  = Math.floor(Date.now() / 1000);
  const code = signJWT({
    iss:          'aduma',
    sub:          user_id,
    email:        user_email,
    client_id,
    redirect_uri,
    scope:        requestedScopes.join(' '),
    brand,
    iat:          now,
    exp:          now + CODE_TTL_SEC,
    jti:          crypto.randomBytes(12).toString('hex'),
  }, secret);

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code',  code);
  if (state) redirectUrl.searchParams.set('state', state);

  return res.status(200).json({ code, redirect_url: redirectUrl.toString() });
};

// ── Keep only essential brand fields to stay under JWT size cap ───────────────
function _trimBrand(b) {
  const pos = b.positioning || {};
  const icp = b.icp        || {};
  return {
    company: {
      name:     b.company?.name     || '',
      industry: b.company?.industry || '',
      stage:    b.company?.stage    || '',
    },
    positioning: {
      uniqueValue:     pos.uniqueValue     || '',
      differentiation: (pos.differentiation || []).slice(0, 5),
      voiceAndTone:    (pos.voiceAndTone   || []).slice(0, 5),
      thingsWeNeverSay: pos.thingsWeNeverSay || '',
    },
    icp: {
      primaryBuyer: {
        role:        icp.primaryBuyer?.role        || '',
        companySize: icp.primaryBuyer?.companySize || '',
      },
      painPoints: (icp.painPoints || []).slice(0, 5),
      biggestFear: icp.biggestFear || '',
    },
  };
}
