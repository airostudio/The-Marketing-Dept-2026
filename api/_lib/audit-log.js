/**
 * The record of what administrators did.
 *
 * admin_activity_log has existed in the schema since the admin console was
 * built, with three indexes and an RLS policy, and nothing ever wrote a row
 * to it. So an administrator could change someone's plan, promote an account
 * to super_admin, or delete a customer outright, and there was no record that
 * it happened, who did it, or when.
 *
 * That matters more here than in most products: an admin on this platform can
 * read across every tenant's data. "Who looked, and what did they change" is
 * the first question any customer's security review asks, and until now the
 * honest answer was that nobody knew.
 *
 * ── Rules this file follows ────────────────────────────────────────────────
 *
 * Never throw. A failure to write the audit row must not fail the action the
 * administrator asked for — but it must not pass silently either, so a failed
 * write is reported through the same failure pipeline as everything else and
 * lands in the admin console.
 *
 * Record after the fact succeeded, never before. An entry saying a user was
 * deleted, written next to a delete that then failed, is worse than no entry:
 * it is a confident record of something that did not happen.
 *
 * Store the email as well as the id. Ids are foreign keys to auth.users and
 * go to NULL when an account is removed; the email is what makes the row
 * still mean something a year later.
 *
 * Never store a secret in `details`. It is written by callers and read back
 * into an admin page, so it holds what was changed, not what it was changed
 * with — no passwords, no tokens.
 */

'use strict';

const { sbRest } = require('./supabase-rest.js');
const { reportFailureAsync } = require('./report-failure.js');

/** The action vocabulary. Anything outside it is still recorded, but this is
 *  what the console knows how to label. */
const ACTIONS = {
  USER_CREATED:   'user_created',
  USER_DELETED:   'user_deleted',
  ROLE_GRANTED:   'role_granted',
  PLAN_CHANGED:   'plan_changed',
  OWNER_CLAIMED:  'owner_claimed',
  TICKET_UPDATED: 'ticket_updated',
};

/**
 * The caller's IP, for the audit row.
 *
 * Same reasoning as the rate limiter: x-forwarded-for is a client-supplied
 * list and only the hop nearest our proxy can be trusted, so take the last
 * entry rather than the first.
 */
function callerIp(req) {
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  const fwd = req.headers['x-forwarded-for'];
  if (!fwd) return null;
  const hops = String(fwd).split(',').map(s => s.trim()).filter(Boolean);
  return hops.length ? hops[hops.length - 1] : null;
}

/**
 * Record one administrative action.
 *
 * @param {object}  opts
 * @param {object}  opts.req           the request, for IP and user agent
 * @param {string}  opts.adminId       the administrator's user id
 * @param {string} [opts.adminEmail]
 * @param {string}  opts.action        one of ACTIONS, or a snake_case verb
 * @param {string} [opts.targetUserId] the account acted upon, if any
 * @param {string} [opts.targetEmail]
 * @param {object} [opts.details]      what changed — never how
 * @returns {Promise<boolean>} whether the row was written
 */
async function recordAdminAction(opts) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return false;

  const { req, adminId, adminEmail, action, targetUserId, targetEmail, details } = opts || {};
  if (!action) return false;

  const row = {
    admin_id: adminId || null,
    admin_email: adminEmail || null,
    action: String(action).slice(0, 120),
    target_user_id: targetUserId || null,
    target_email: targetEmail || null,
    details: details && typeof details === 'object' ? details : {},
    ip_address: req ? callerIp(req) : null,
    user_agent: req ? String(req.headers['user-agent'] || '').slice(0, 500) : null,
  };

  try {
    const res = await sbRest(supabaseUrl, serviceKey, 'POST', '/admin_activity_log', row);
    if (!res.ok) {
      // The action happened; the record of it did not. That is itself an
      // incident — an unrecorded admin action is exactly what this exists to
      // prevent — so it goes to the failure console rather than a log line
      // nobody reads.
      reportFailureAsync({
        source: 'api/_lib/audit-log',
        message: `Could not record admin action "${row.action}": ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`,
        severity: 'error',
        detail: { action: row.action, adminId: row.admin_id },
      });
      return false;
    }
    return true;
  } catch (err) {
    reportFailureAsync({
      source: 'api/_lib/audit-log',
      message: `Could not record admin action "${row.action}": ${err && err.message}`,
      severity: 'error',
      detail: { action: row.action },
    });
    return false;
  }
}

module.exports = { recordAdminAction, callerIp, ACTIONS };
