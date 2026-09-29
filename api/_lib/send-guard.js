/**
 * api/_lib/send-guard.js — who is sending, who must not be sent to, and how
 * much they have left today.
 *
 * Not a Vercel route; api/_lib/ is excluded from routing.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * api/send-campaign.js and api/send-email.js were unauthenticated. They took
 * a subject, an HTML body and a recipient list from anyone who could reach
 * the URL, and sent it through the account's Resend key from its verified
 * sending domain. `Access-Control-Allow-Origin: *` meant any page on the
 * internet could call them from a browser. That is an open relay on a domain
 * with earned deliverability — the most valuable thing to a phisher.
 *
 * They also never checked whether a recipient had opted out. The only
 * suppression gate was in the browser, in a function whose behaviour depends
 * on how a segment was configured. Suppression has to live in the code path
 * that actually calls the mail provider, because that is the only place that
 * cannot be gone around.
 */

'use strict';

const { sbRest } = require('./supabase-rest.js');

/** Fallback ceiling when the account has no explicit daily_send_limit. */
const DEFAULT_DAILY_SEND_LIMIT = 500;

/**
 * Identify the caller from their own Supabase access token.
 *
 * Returns { userId, profile } or null. Never trusts anything in the body:
 * a request that names its own user id is a request that can name someone
 * else's.
 */
async function authenticateSender(req) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return { error: 'server_unconfigured' };

  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'no_token' };

  let user = null;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) user = await res.json();
  } catch (e) {
    return { error: 'auth_unreachable' };
  }
  if (!user || !user.id) return { error: 'invalid_token' };

  const p = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/profiles?id=eq.${user.id}&select=id,plan,daily_send_limit&limit=1`);
  return {
    userId: user.id,
    profile: (p.ok && p.data && p.data[0]) || {},
  };
}

/**
 * Split a recipient list into those who may be emailed and those who may not.
 *
 * One query for the whole batch. A per-recipient check would be a round trip
 * each, and a send of several hundred would either exceed the function
 * timeout or get quietly skipped under load — and a suppression check that is
 * skipped under load is not a suppression check.
 *
 * Fails CLOSED. If the suppression list cannot be read, nothing is sent:
 * being unable to tell who opted out is not permission to email everyone.
 * The one exception is a missing table, which means the migration has not
 * been run — that is reported distinctly so an operator sees a setup problem
 * rather than a silent halt.
 */
async function filterSuppressed(userId, recipients) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const addresses = recipients.map(r => String(r.to || '').trim().toLowerCase());
  const res = await sbRest(supabaseUrl, serviceKey, 'POST', '/rpc/suppressed_emails', {
    uid: userId,
    addresses,
  });

  if (!res.ok) {
    if (res.status === 404) {
      return { ok: false, code: 'not_installed',
               error: 'Suppression is not installed. Run supabase-email-suppression.sql in the ' +
                      'Supabase SQL editor. Refusing to send until the opt-out list can be checked.' };
    }
    return { ok: false, code: 'suppression_unreadable',
             error: `Could not read the suppression list (HTTP ${res.status}). Nothing was sent — ` +
                    'not being able to tell who has opted out is not permission to email everyone.' };
  }

  const byEmail = new Map();
  (res.data || []).forEach(row => {
    if (row && row.email) byEmail.set(String(row.email).toLowerCase(), row.reason || 'suppressed');
  });

  const allowed = [];
  const suppressed = [];
  recipients.forEach(r => {
    const key = String(r.to || '').trim().toLowerCase();
    const reason = byEmail.get(key);
    if (reason) suppressed.push({ to: r.to, reason });
    else allowed.push(r);
  });

  return { ok: true, allowed, suppressed };
}

/**
 * Claim up to `want` sends against this account's quota for today.
 *
 * Returns the number granted, which can be fewer than asked for. Claiming
 * before sending rather than counting afterwards means two concurrent sends
 * cannot both spend the last of the budget.
 */
async function claimQuota(userId, want, profile) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // daily_send_limit is a nullable column with no default, so an account
  // that has never had it explicitly set comes back as `null` — and
  // Number(null) is 0, not NaN. Left unguarded, that reads as "this
  // account's real cap is zero" instead of "unset, use the default", and
  // every such account is blocked from sending anything, forever.
  const raw = profile && profile.daily_send_limit;
  const cap = raw !== null && raw !== undefined
    && Number.isFinite(Number(raw)) && Number(raw) >= 0
      ? Number(raw)
      : DEFAULT_DAILY_SEND_LIMIT;

  const res = await sbRest(supabaseUrl, serviceKey, 'POST', '/rpc/claim_send_quota', {
    uid: userId, want, cap,
  });

  if (!res.ok) {
    if (res.status === 404) {
      return { ok: false, code: 'not_installed',
               error: 'Send quota is not installed. Run supabase-email-suppression.sql.' };
    }
    return { ok: false, code: 'quota_unreadable',
             error: `Could not claim send quota (HTTP ${res.status}).` };
  }

  const granted = Number(Array.isArray(res.data) ? res.data[0] : res.data) || 0;
  return { ok: true, granted, cap };
}

/** Hand back quota that was claimed but not spent, e.g. after a failed batch. */
async function releaseQuota(userId, n) {
  if (!n || n <= 0) return;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Negative want with a cap high enough to be irrelevant: claim_send_quota
  // clamps at zero, so this cannot drive the counter below zero.
  await sbRest(supabaseUrl, serviceKey, 'POST', '/rpc/claim_send_quota', {
    uid: userId, want: -n, cap: Number.MAX_SAFE_INTEGER,
  }).catch(() => {});
}

/** Record an address as suppressed. Idempotent — a repeat is not an error. */
async function suppressEmail(userId, email, reason, source) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey || !userId || !email) return false;
  const res = await sbRest(supabaseUrl, serviceKey, 'POST',
    '/email_suppressions?on_conflict=user_id,email', {
      user_id: userId, email: String(email).trim().toLowerCase(),
      reason: reason || 'unsubscribed', source: source || null,
    });
  return res.ok || res.status === 409;
}

module.exports = {
  DEFAULT_DAILY_SEND_LIMIT,
  authenticateSender, filterSuppressed, claimQuota, releaseQuota, suppressEmail,
};
