/**
 * OAuth 2.0 Token Endpoint
 *
 * Webese's backend calls this to exchange an auth code for an access token.
 * This is a server-to-server call — no browser involvement.
 *
 * POST /api/oauth-token
 *   grant_type    authorization_code
 *   code          (JWT issued by /api/oauth-authorize)
 *   client_id
 *   client_secret
 *   redirect_uri
 *
 * Returns:
 *   { access_token, token_type, expires_in, scope }
 *
 * Env vars required:
 *   OAUTH_JWT_SECRET     — shared signing secret
 *   WEBESE_CLIENT_ID     — registered client_id
 *   WEBESE_CLIENT_SECRET — registered client_secret
 *   WEBESE_REDIRECT_URIS — comma-separated allowed redirect URIs
 */

const crypto = require('crypto');

const ACCESS_TOKEN_TTL_SEC = 60 * 60; // 1 hour

// ── JWT helpers ───────────────────────────────────────────────────────────────

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

function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');

  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret)
    .update(`${header}.${body}`).digest('base64url');

  // Constant-time compare to prevent timing attacks
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('invalid signature');
  }

  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error('token expired');
  }
  return payload;
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  // Token endpoint is server-to-server; no CORS needed for the POST itself
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma',        'no-cache');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const secret = process.env.OAUTH_JWT_SECRET;
  if (!secret || secret.length < 32) {
    return res.status(500).json({ error: 'server_configuration_error' });
  }

  const { grant_type, code, client_id, client_secret, redirect_uri } = req.body || {};

  // ── Validate grant type ───────────────────────────────────────────────────
  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  // ── Validate client credentials ───────────────────────────────────────────
  const validId     = process.env.WEBESE_CLIENT_ID;
  const validSecret = process.env.WEBESE_CLIENT_SECRET;

  if (!client_id || !client_secret || !validId || !validSecret) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  const idMatch = crypto.timingSafeEqual(
    Buffer.from(client_id.padEnd(64)),
    Buffer.from(validId.padEnd(64))
  );
  const secretMatch = crypto.timingSafeEqual(
    Buffer.from(client_secret.padEnd(128)),
    Buffer.from(validSecret.padEnd(128))
  );
  if (!idMatch || !secretMatch) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  // ── Verify auth code ──────────────────────────────────────────────────────
  let claims;
  try {
    claims = verifyJWT(code, secret);
  } catch (err) {
    return res.status(400).json({ error: 'invalid_grant', detail: err.message });
  }

  if (claims.client_id !== client_id) {
    return res.status(400).json({ error: 'invalid_grant', detail: 'client mismatch' });
  }

  const allowedUris = (process.env.WEBESE_REDIRECT_URIS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!allowedUris.includes(redirect_uri) || claims.redirect_uri !== redirect_uri) {
    return res.status(400).json({ error: 'invalid_grant', detail: 'redirect_uri mismatch' });
  }

  // ── Issue access token ────────────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const accessToken = signJWT({
    iss:       'aduma',
    sub:       claims.sub,
    email:     claims.email,
    client_id: claims.client_id,
    scope:     claims.scope,
    brand:     claims.brand || null,
    iat:       now,
    exp:       now + ACCESS_TOKEN_TTL_SEC,
  }, secret);

  return res.status(200).json({
    access_token: accessToken,
    token_type:   'Bearer',
    expires_in:   ACCESS_TOKEN_TTL_SEC,
    scope:        claims.scope,
  });
};
