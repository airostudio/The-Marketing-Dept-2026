/**
 * api/_lib/unsubscribe-token.js — signs/verifies the token embedded in every
 * campaign's List-Unsubscribe link (api/unsubscribe.js) so that link can be
 * trusted without requiring the clicker to be logged in.
 *
 * Not a Vercel route (api/_lib/ is excluded from routing) — imported by
 * api/send-campaign.js (signs) and api/unsubscribe.js (verifies).
 */

'use strict';

const crypto = require('crypto');

function secret() {
  // A dedicated UNSUBSCRIBE_SECRET is preferred; falling back to the
  // Supabase service-role key means this works with zero extra setup for
  // anyone who already has Supabase configured (which every deployment of
  // this app needs anyway), rather than silently disabling the feature.
  return process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function sign(contactId, email) {
  const s = secret();
  if (!s) return null;
  return crypto
    .createHmac('sha256', s)
    .update(`${contactId || '-'}:${String(email).toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);
}

function verify(contactId, email, token) {
  const expected = sign(contactId, email);
  if (!expected || !token) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { sign, verify, isConfigured: () => !!secret() };
