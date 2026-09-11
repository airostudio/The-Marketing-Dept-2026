/**
 * api/builtwith-unlock.js — the password gate for the internal BuiltWith
 * research tool (web/tools/builtwith-research.html).
 *
 * POST { password }
 * Returns: { success, token, expiresAt } on match, 401 on mismatch, 500 if
 * BUILTWITH_TOOL_PASSWORD is not configured.
 *
 * This is an ADDITIONAL gate on top of normal Audema login (requireUser runs
 * first, below), never a replacement for it — a customer who is not signed
 * in never even reaches the password check. It exists because BuiltWith
 * spends the team's own paid API quota and should only be reachable by
 * whoever the team hands this shared password to, not by every customer
 * account.
 */

'use strict';

const crypto = require('crypto');

const { requireUser } = require('./_lib/require-user.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
const { rateLimited } = require('./_lib/rate-limit.js');
const { issueToken } = require('./_lib/builtwith-access-token.js');

/**
 * Constant-time string compare. Buffer.compare/timingSafeEqual both require
 * equal-length inputs, and a length mismatch is itself a valid (if crude)
 * timing signal — so a mismatch on length is treated as "wrong password"
 * without ever touching timingSafeEqual on unequal buffers, rather than
 * throwing or falling back to `===`.
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = withFailureReporting('api/builtwith-unlock', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Must already be logged into Audema — this endpoint layers a second
  // secret on top of that, it never substitutes for it.
  const auth = await requireUser(req, res);
  if (!auth) return;

  // Tight on purpose: this endpoint's whole job is resisting a
  // password-guessing loop against a single shared secret.
  if (rateLimited(req, res, { name: 'builtwith-unlock', max: 5, windowMs: 60 * 1000, auth })) return;

  const configured = process.env.BUILTWITH_TOOL_PASSWORD;
  if (!configured) {
    return res.status(500).json({
      error: 'BUILTWITH_TOOL_PASSWORD is not configured. The research tool cannot be unlocked ' +
             'until it is set — refusing to accept any password rather than silently letting ' +
             'everyone through.',
      code: 'not_configured',
    });
  }

  const { password } = req.body || {};
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'password is required' });
  }

  if (!safeEqual(password, configured)) {
    // Generic on purpose — never reveal whether the account or setup is
    // otherwise valid, only whether the password matched.
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  const issued = issueToken(auth.userId);
  if (!issued) {
    return res.status(500).json({
      error: 'Could not issue an access token (BUILTWITH_TOOL_SECRET / SUPABASE_SERVICE_ROLE_KEY ' +
             'missing). Password was correct, but nothing was unlocked.',
      code: 'token_not_configured',
    });
  }

  return res.status(200).json({ success: true, token: issued.token, expiresAt: issued.expiresAt });
});
