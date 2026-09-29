/**
 * api/_lib/rate-limit.js — the shared burst guard for this API.
 *
 * Not a Vercel route; api/_lib/ is excluded from routing.
 *
 * ── What this is, and what it is not ───────────────────────────────────────
 *
 * Forty-one endpoints had each grown their own copy of the same thing:
 *
 *     const rateBuckets = new Map();
 *     function getClientIp(req) { ...x-forwarded-for... }
 *     function checkRateLimit(ip) { ...count in the Map... }
 *
 * Two things were wrong with it, and only one of them is fixable here.
 *
 * The Map lives in one serverless instance's memory. Vercel runs as many
 * instances as the traffic needs and recycles them constantly, so a limit of
 * "15 per minute" is really "15 per minute per warm instance" — and the number
 * of instances grows with load. Under exactly the pressure a rate limit exists
 * to handle, the limit loosens. It cannot be fixed by writing the counter
 * better, because the counter is in the wrong place.
 *
 * So this module is honest about being a BURST GUARD: it stops one caller
 * hammering one instance, which is worth having and costs nothing. It is not
 * a quota and must never be the only thing standing between a caller and
 * money. The real ceilings are already elsewhere in this codebase and are
 * database-backed, atomic, and shared across every instance:
 *
 *   - mission_usage / consume_mission_usage()  — Agent Missions per month
 *   - credit_balances / consume_credits()      — AI image credits per site
 *   - profiles.daily_send_limit (send-guard)   — outbound email per day
 *
 * The other problem is fixable, and is the reason this exists. Every copy
 * keyed the bucket on an IP address parsed out of x-forwarded-for. Even where
 * that header is trustworthy, an IP is the wrong key for an endpoint that
 * spends the account's money: it charges a shared office or a mobile carrier's
 * NAT pool as one caller, and lets one account spread its spending across as
 * many addresses as it can reach. Every one of these endpoints authenticates
 * its caller. The account id is the thing being metered, it is derived from a
 * verified token, and unlike an address it cannot be varied by the client.
 */

'use strict';

/** Per-instance buckets, one Map per limiter name. */
const buckets = new Map();

/**
 * Best available client address.
 *
 * x-real-ip is a single value set by the platform. x-forwarded-for is a list,
 * and the leftmost entry is the one furthest from us — the one a client can
 * prepend by sending the header itself. Preferring x-real-ip, and taking the
 * LAST x-forwarded-for hop rather than the first, means what is read is the
 * value our own infrastructure added rather than one the caller supplied.
 *
 * Only used when there is no authenticated caller to key on.
 */
function clientIp(req) {
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();

  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    const hops = fwd.split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Count one request against a burst limit.
 *
 * @param {object}  req
 * @param {object}  opts
 * @param {string}  opts.name       limiter name — separate endpoints get separate buckets
 * @param {number}  opts.max        requests allowed per window
 * @param {number}  opts.windowMs   window length
 * @param {object} [opts.auth]      the result of requireUser(), when there is one
 * @returns {{allowed: boolean, retryAfterSec: number, key: string}}
 */
function rateLimit(req, opts) {
  const { name, max, windowMs, auth } = opts;

  // The account is the thing being metered. Fall back to an address only for
  // the genuinely public endpoints that have no caller to name.
  const key = auth && auth.userId ? `u:${auth.userId}` : `ip:${clientIp(req)}`;

  let bucket = buckets.get(name);
  if (!bucket) { bucket = new Map(); buckets.set(name, bucket); }

  const now = Date.now();
  let entry = bucket.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    entry = { windowStart: now, count: 0 };
    bucket.set(key, entry);
  }
  entry.count++;

  // A Map that only ever grows is a slow leak in a long-lived instance. Sweep
  // expired entries occasionally rather than on every call.
  if (bucket.size > 5000) {
    for (const [k, v] of bucket) if (now - v.windowStart >= windowMs) bucket.delete(k);
  }

  const allowed = entry.count <= max;
  return {
    allowed,
    retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000)),
    key,
  };
}

/**
 * rateLimit(), and send the 429 if it is over.
 *
 * Sets Retry-After, which the previous inline versions did not: a client told
 * only "too many requests" has no way to know whether to come back in a second
 * or a minute, so it retries immediately and makes the problem worse.
 *
 * @returns {boolean} true when the request was refused and a response sent.
 */
function rateLimited(req, res, opts) {
  const result = rateLimit(req, opts);
  if (result.allowed) return false;
  res.setHeader('Retry-After', String(result.retryAfterSec));
  res.status(429).json({
    error: 'Too many requests. Slow down.',
    code: 'rate_limited',
    retryAfterSeconds: result.retryAfterSec,
  });
  return true;
}

/**
 * Forget every count.
 *
 * Only for tests. The buckets used to live inside each endpoint's own module,
 * so a suite that re-required a handler got a clean counter for free; now they
 * are shared and outlive that, which is the point in production and a nuisance
 * in a suite that legitimately calls one endpoint more times than a minute's
 * allowance. Test scenarios reset this the same way they reset their fake
 * database, so one scenario's calls do not spend another's budget.
 */
function resetForTests() {
  buckets.clear();
}

module.exports = { rateLimit, rateLimited, clientIp, resetForTests };
