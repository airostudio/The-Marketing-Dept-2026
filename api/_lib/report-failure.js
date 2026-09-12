/**
 * api/_lib/report-failure.js — tell somebody when something breaks.
 *
 * Not a Vercel route; api/_lib/ is excluded from routing.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * A lot of work in this codebase went into making failures honest: a PageSpeed
 * scan that cannot run shows no score and says what failed, rather than a
 * fabricated 15/100. That is the right thing for the customer and only half
 * the job, because the customer now sees a truthful "this did not work" and
 * nobody who could fix it ever hears about it. A key expires on a Tuesday and
 * the product quietly degrades until somebody complains.
 *
 * Every failure path calls in here. The failure is grouped by fingerprint,
 * counted, given whatever is known about repairing it, and — when it is new or
 * still going an hour later — emailed to the administrators.
 *
 * ── Three rules this module must never break ───────────────────────────────
 *
 * 1. It must never throw. It is called from catch blocks. A reporter that
 *    throws turns a handled failure into an unhandled one, which is the exact
 *    opposite of its job.
 *
 * 2. It must never delay the response. Reporting is fire-and-forget: the
 *    promise is deliberately not awaited by callers, and every path inside is
 *    wrapped so a rejection cannot surface as an unhandled rejection either.
 *
 * 3. It must never record a secret. Failure detail is the most tempting place
 *    in a codebase to dump "everything we had" — request bodies, headers,
 *    config. scrub() below removes anything that looks like a credential, and
 *    the callers pass shaped detail rather than whole objects.
 */

'use strict';

const { sbRest } = require('./supabase-rest.js');

/** Cap on any single string stored, so one enormous message cannot fill a row. */
const MAX_FIELD = 2000;

/**
 * Causes we recognise, with what to do about them.
 *
 * The value of an alert is entirely in whether the person reading it knows
 * what to do next. "PageSpeed returned HTTP 429" is a fact; "Google is rate-
 * limiting us because GOOGLE_PAGESPEED_API_KEY is unset, so requests go out
 * unauthenticated — set it in Vercel" is a repair.
 *
 * selfHealing marks the ones that recover without a person, so the console can
 * say "this is expected to clear on its own" instead of demanding attention
 * that is not needed.
 */
const KNOWN_CAUSES = [
  {
    match: /is not configured|not configured in environment|_API_KEY|_SECRET is not|not set/i,
    kind: 'config_missing',
    severity: 'critical',
    remedy: env =>
      `An environment variable this feature depends on is missing${env ? ` (${env})` : ''}. ` +
      `Set it in Vercel → Settings → Environment Variables and redeploy. Until then this ` +
      `feature is off for every customer, not just the one who reported it.`,
  },
  {
    match: /\b429\b|rate.?limit|quota exceeded|too many requests/i,
    kind: 'upstream_error',
    severity: 'warning',
    selfHealing: true,
    recovery: 'Retries after the provider’s window resets. If it persists, the plan or key is undersized for current traffic.',
    remedy: () =>
      `A third-party provider is rate-limiting us. This usually clears on its own; if it ` +
      `does not, either the key is missing (unauthenticated requests get much lower limits) ` +
      `or the account’s plan needs raising.`,
  },
  {
    match: /\b40[13]\b|unauthorized|forbidden|invalid api key|authentication failed/i,
    kind: 'integration_failure',
    severity: 'critical',
    remedy: () =>
      `A provider rejected our credentials. The key is wrong, expired, or has lost a ` +
      `permission. This does not recover on its own — the key has to be replaced.`,
  },
  {
    match: /timeout|timed out|TimeoutError|AbortError|ETIMEDOUT/i,
    kind: 'upstream_timeout',
    severity: 'warning',
    selfHealing: true,
    recovery: 'Transient by nature. Worth attention only if the occurrence count keeps climbing.',
    remedy: () =>
      `A provider did not answer in time. One of these is noise; a rising count means the ` +
      `provider is degraded or our timeout is too tight for the work being asked of it.`,
  },
  {
    match: /\b5\d\d\b|internal server error|bad gateway|service unavailable/i,
    kind: 'upstream_error',
    severity: 'error',
    selfHealing: true,
    recovery: 'Recovers when the provider does. Check their status page if it persists.',
    remedy: () => `A provider returned a server error. Usually theirs to fix, not ours.`,
  },
  {
    match: /does not exist|relation .* does not exist|PGRST|schema cache/i,
    kind: 'database_error',
    severity: 'critical',
    remedy: () =>
      `A table or function this feature needs is not in the database. Run the migration ` +
      `it belongs to — supabase-install-all.sql contains all of them and is safe to re-run.`,
  },
];

/** Which env var a message is complaining about, if it names one. */
function namedEnvVar(message) {
  const m = String(message || '').match(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,5})\b/);
  return m ? m[1] : null;
}

/** Match a message against KNOWN_CAUSES. */
function classify(message, fallbackKind) {
  const text = String(message || '');
  for (const c of KNOWN_CAUSES) {
    if (c.match.test(text)) {
      return {
        kind: c.kind,
        severity: c.severity,
        remedy: c.remedy(namedEnvVar(text)),
        selfHealing: !!c.selfHealing,
        recovery: c.recovery || null,
      };
    }
  }
  return { kind: fallbackKind || 'unhandled_exception', severity: 'error', remedy: null, selfHealing: false, recovery: null };
}

/**
 * Reduce a message to the thing that is actually the same between occurrences.
 *
 * Without this, "Timed out fetching https://a.com" and "Timed out fetching
 * https://b.com" are two incidents, and a broken upstream produces one row per
 * customer instead of one row. Ids, urls, quoted strings and bare numbers all
 * go; what is left is the shape of the problem.
 */
function normalise(message) {
  return String(message || '')
    .replace(/https?:\/\/[^\s"')]+/gi, '<url>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/g, '<email>')
    .replace(/["'`][^"'`]{16,}["'`]/g, '<str>')
    // Four digits and up: timings, byte counts, row counts, ids. No trailing
    // \b, because the number is usually glued to a unit — "8000ms" and
    // "12000ms" are the same incident and a word-boundary rule leaves them as
    // two. Three-digit numbers are left alone on purpose: an HTTP 429 and an
    // HTTP 500 are different problems and must not share a row.
    .replace(/\d{4,}/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** A short, stable id for a group of identical failures. */
function fingerprint(source, kind, message) {
  const basis = `${source}|${kind}|${normalise(message)}`;
  // FNV-1a. A cryptographic hash is not needed — this only has to be stable
  // and collision-resistant enough across a few thousand distinct messages.
  let h = 0x811c9dc5;
  for (let i = 0; i < basis.length; i++) {
    h ^= basis.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${source}:${kind}:${h.toString(16).padStart(8, '0')}`;
}

const SECRET_KEY = /key|token|secret|password|authorization|cookie|credential|bearer/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{8,}|whsec_[A-Za-z0-9]{8,}|re_[A-Za-z0-9]{8,}|eyJ[\w-]{10,}\.[\w-]{10,})/;

/**
 * Remove anything credential-shaped from failure detail.
 *
 * Both halves matter. Keys named like a secret are dropped whatever they hold,
 * and values shaped like a secret are dropped whatever they are called —
 * because the most likely way a key ends up in here is inside a message
 * somebody pasted an upstream response into.
 */
function scrub(value, depth = 0) {
  if (depth > 4) return '<deep>';
  if (value == null) return value;
  if (typeof value === 'string') {
    return (SECRET_VALUE.test(value) ? '<redacted>' : value).slice(0, MAX_FIELD);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(v => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 30)) {
      out[k] = SECRET_KEY.test(k) ? '<redacted>' : scrub(v, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, MAX_FIELD);
}

/**
 * Record a failure. Never throws, never blocks.
 *
 * @param {object} f
 * @param {string} f.source     where it happened — 'api/pagespeed', 'web/seo-pulse.html'
 * @param {string} f.message    what went wrong, in a sentence
 * @param {string} [f.kind]     one of the CHECK-constrained kinds; inferred when omitted
 * @param {string} [f.severity] inferred when omitted
 * @param {object} [f.detail]   status codes, upstream name, truncated stack
 * @param {string} [f.userId]   who hit it, when there is a caller
 * @returns {Promise<{recorded: boolean, failureId?: string, alertDue?: boolean}>}
 */
async function reportFailure(f) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      // Nowhere to record it. Say so on the console, which is the only place
      // left — silently dropping a failure report is how you end up believing
      // a broken system is healthy.
      console.error('[report-failure] no Supabase configured; failure not recorded:',
        f && f.source, f && f.message);
      return { recorded: false };
    }

    const source  = String(f.source || 'unknown').slice(0, 120);
    const message = String(f.message || 'Unknown failure').slice(0, MAX_FIELD);
    const guess   = classify(message, f.kind);

    const kind     = f.kind     || guess.kind;
    const severity = f.severity || guess.severity;

    const res = await sbRest(supabaseUrl, serviceKey, 'POST', '/rpc/record_system_failure', {
      p_fingerprint:     fingerprint(source, kind, message),
      p_source:          source,
      p_kind:            kind,
      p_severity:        severity,
      p_message:         message,
      p_detail:          scrub(f.detail || {}),
      p_remedy:          f.remedy || guess.remedy,
      p_self_healing:    guess.selfHealing,
      p_recovery_action: guess.recovery,
      p_user_id:         f.userId || null,
    });

    if (!res.ok) {
      console.error('[report-failure] could not record failure:', res.status,
        typeof res.data === 'string' ? res.data.slice(0, 200) : res.data);
      return { recorded: false };
    }

    const row = (Array.isArray(res.data) ? res.data[0] : res.data) || {};

    // alert_due is decided in SQL, in the same statement that recorded the
    // occurrence, because a broken upstream breaks for every request at once:
    // a check-then-send here would have a hundred concurrent callers all read
    // "not yet notified" and all send. Exactly one of them gets a true.
    if (row.alert_due === true && row.failure_id && !f.suppressAlert) {
      // Required lazily so the alerter is not loaded on the happy path, and
      // never awaited — an email must not be between a customer and their
      // response.
      try {
        const { alertAdmins } = require('./failure-alert.js');
        Promise.resolve(alertAdmins(row.failure_id)).catch(() => { /* rule 1 */ });
      } catch { /* rule 1 */ }
    }

    return {
      recorded: true,
      failureId: row.failure_id,
      isNew: row.is_new === true,
      occurrences: row.occurrences,
      alertDue: row.alert_due === true,
    };
  } catch (err) {
    // Rule 1. Whatever happened here, the caller's own failure is the
    // important one and must not be replaced by this one.
    try { console.error('[report-failure] reporter itself failed:', err && err.message); } catch { /* nothing left to try */ }
    return { recorded: false };
  }
}

/**
 * Fire-and-forget form, for use inside a catch block on the response path.
 *
 * Returns nothing and swallows everything: the point is that a caller can put
 * this line in front of `return res.status(500)` without thinking about
 * whether it might throw, reject, or add latency.
 */
function reportFailureAsync(f) {
  try {
    Promise.resolve(reportFailure(f)).catch(() => { /* rule 1 */ });
  } catch { /* rule 1 */ }
}

/**
 * Wrap a handler so anything it does not catch itself is recorded.
 *
 * The shared helpers cover the failures the code expects — a provider that
 * refused, a key that is unset. This covers the ones it does not: a null
 * dereference on a shape an upstream changed, a TypeError in a branch nobody
 * exercised. Those are the failures most worth hearing about, because they are
 * the ones nobody wrote a message for.
 *
 * Two things it deliberately does NOT do:
 *
 *   It does not swallow the error. The handler's own behaviour is unchanged
 *   except that a 500 is now sent where the process would otherwise have
 *   returned a rejected promise and the platform would have sent an opaque
 *   error page. The customer gets a response either way; the difference is
 *   that somebody is told.
 *
 *   It does not report a response the handler chose. A 400 or a 401 is the
 *   endpoint working correctly, and an incident log full of "someone typed a
 *   bad URL" is one nobody reads.
 *
 * @param {string} source   e.g. 'api/pagespeed'
 * @param {Function} handler
 */
function withFailureReporting(source, handler) {
  return async function wrapped(req, res) {
    try {
      return await handler(req, res);
    } catch (err) {
      reportFailureAsync({
        source,
        message: (err && err.message) || String(err),
        kind: 'unhandled_exception',
        severity: 'error',
        detail: {
          name: err && err.name,
          // A few frames are enough to find it; a whole stack is mostly noise
          // and is the sort of thing that quietly carries a token in a URL.
          stack: err && err.stack ? String(err.stack).split('\n').slice(0, 6).join('\n') : null,
          method: req && req.method,
          action: req && req.body && typeof req.body.action === 'string' ? req.body.action : undefined,
        },
      });

      // If the handler already answered, adding a second response would throw
      // over the top of the real failure.
      try {
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Something went wrong on our side. It has been reported.',
            code: 'unhandled_error',
          });
        }
      } catch { /* nothing further to do */ }
    }
  };
}

module.exports = {
  reportFailure,
  reportFailureAsync,
  withFailureReporting,
  // Exported for tests and for the browser-side reporter to share the shape.
  fingerprint,
  normalise,
  classify,
  scrub,
};
