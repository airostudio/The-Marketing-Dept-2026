/**
 * Webese Brand Data Endpoint
 *
 * Returns the brand snapshot that was embedded in the OAuth access token
 * at authorization time.  No database required — brand data travels with
 * the token (like an ID token claim set).
 *
 * GET /api/webese-brand
 *   Authorization: Bearer <access_token>
 *
 * Env vars required:
 *   OAUTH_JWT_SECRET — shared signing secret
 */

const crypto = require('crypto');

function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');

  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', secret)
    .update(`${header}.${body}`).digest('base64url');

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

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  process.env.WEBESE_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization');
}

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.OAUTH_JWT_SECRET;
  if (!secret) return res.status(500).json({ error: 'not configured' });

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });

  let claims;
  try {
    claims = verifyJWT(token, secret);
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token', detail: err.message });
  }

  if (!claims.scope?.includes('brand:read')) {
    return res.status(403).json({ error: 'insufficient_scope' });
  }

  return res.status(200).json({
    user: {
      id:    claims.sub,
      email: claims.email,
    },
    brand:  claims.brand || null,
    scope:  claims.scope,
  });
};
