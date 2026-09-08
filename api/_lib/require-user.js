/**
 * api/_lib/require-user.js — an endpoint that spends money needs to know who
 * is spending it.
 *
 * Not a Vercel route; api/_lib/ is excluded from routing.
 *
 * ── Why ──────────────────────────────────────────────────────────────────
 *
 * The enrichment endpoints call Apollo, Hunter.io, Perplexity and Claude on
 * the account's own API keys, and none of them checked who was calling. An
 * unauthenticated enrichment endpoint is not a data leak so much as a direct
 * line into the owner's billing: anyone who found the URL could run Apollo
 * lookups, Hunter verifications and Perplexity searches indefinitely, paid
 * for by the account, and could equally use it as a free proxy to those
 * services.
 *
 * A rate limit is not a substitute. It caps how fast the money goes, not
 * whether the caller was ever entitled to spend it.
 *
 * Usage:
 *   const { requireUser } = require('./_lib/require-user.js');
 *   const auth = await requireUser(req, res);
 *   if (!auth) return;              // requireUser already answered
 *   const { userId, profile } = auth;
 */

'use strict';

const { sbRest } = require('./supabase-rest.js');

/**
 * Identify the caller, or answer the request and return null.
 *
 * Returns { userId, profile } on success. On failure it writes the response
 * itself and returns null, so a caller that forgets to check cannot
 * accidentally continue with no user — the worst outcome would be spending
 * money for an unidentified caller, which is the thing being prevented.
 *
 * Deliberately fails CLOSED when Supabase is unreachable. Being unable to
 * verify a caller is not the same as verifying them, and treating it as such
 * would reopen the hole every time the database had a bad minute.
 */
async function requireUser(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    res.status(500).json({
      error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured, so the caller ' +
             'cannot be identified. Refusing to spend API credits for an unknown caller.',
    });
    return null;
  }

  const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Sign in to use this.', code: 'no_token' });
    return null;
  }

  let user = null;
  try {
    const r = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) user = await r.json();
  } catch (e) {
    res.status(503).json({
      error: 'Could not verify your session, so nothing was run.',
      code: 'auth_unreachable',
    });
    return null;
  }

  if (!user || !user.id) {
    res.status(401).json({ error: 'Your session has expired. Sign in again.', code: 'invalid_token' });
    return null;
  }

  const p = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/profiles?id=eq.${user.id}&select=id,plan,role&limit=1`);

  let profile = (p.ok && p.data && p.data[0]) || {};

  // The owner account, designated by email.
  //
  // Bootstrapping the first administrator used to mean opening the Supabase
  // SQL editor and running an UPDATE by hand — the schema still carries that
  // instruction in a comment. That is fine once and awful forever: it is
  // undocumented in the deployment, easy to forget when moving to a new
  // environment, and there is no record of who holds the role or why.
  //
  // OWNER_EMAIL names the account (or accounts, comma separated) that should
  // hold super_admin. Set it, sign in with that address, and the role is
  // yours. Nothing to run.
  profile = await applyOwnerEmail(supabaseUrl, serviceKey, user, profile);

  return { userId: user.id, profile, email: user.email || null };
}

/**
 * Promote the designated owner account, if this is one.
 *
 * Three things this deliberately does NOT do:
 *
 *   It does not trust the email on the profiles row. It uses the address
 *   Supabase verified on the session, because a profile column is data and
 *   an authenticated identity is not.
 *
 *   It does not promote an unconfirmed address. Otherwise anyone who knows
 *   the owner's email could sign up as it and hold super_admin until the
 *   confirmation was noticed — the promotion has to wait for proof the
 *   address belongs to whoever is holding it.
 *
 *   It does not demote. Clearing OWNER_EMAIL removes the automatic grant for
 *   future sign-ins; it does not strip the role from anyone who has it, so a
 *   mistyped variable cannot lock every administrator out of the console.
 */
async function applyOwnerEmail(supabaseUrl, serviceKey, user, profile) {
  const owners = (process.env.OWNER_EMAIL || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!owners.length) return profile;

  const email = String(user.email || '').trim().toLowerCase();
  if (!email || !owners.includes(email)) return profile;

  // Supabase sets email_confirmed_at once the address is proven. Some
  // configurations use confirmed_at instead; accept either, require one.
  if (!user.email_confirmed_at && !user.confirmed_at) return profile;

  if (profile.role === 'super_admin') return profile;

  const res = await sbRest(supabaseUrl, serviceKey, 'PATCH',
    `/profiles?id=eq.${user.id}`, { role: 'super_admin' });

  if (!res.ok) {
    // Worth hearing about: the owner cannot reach their own console.
    console.error('[owner-email] could not promote', email, res.status, res.data);
    return profile;
  }
  console.log('[owner-email] promoted to super_admin:', email);

  // Granting super_admin is the single most consequential thing that happens
  // without a human pressing anything, so it is recorded like any other
  // administrative action. Required lazily: this module is loaded by every
  // authenticated endpoint, and the audit log is only needed on the one
  // request in the lifetime of an account that actually promotes it.
  try {
    const { recordAdminAction, ACTIONS } = require('./audit-log.js');
    await recordAdminAction({
      adminId: user.id, adminEmail: email,
      action: ACTIONS.OWNER_CLAIMED,
      targetUserId: user.id, targetEmail: email,
      details: { role: 'super_admin', previousRole: profile.role || null, grantedBy: 'OWNER_EMAIL' },
    });
  } catch (e) { /* the grant stands; recordAdminAction reports its own failures */ }

  return Object.assign({}, profile, { role: 'super_admin' });
}

/**
 * Identify the caller and require an admin role, or answer and return null.
 *
 * For endpoints whose output is about the deployment rather than about the
 * caller's own data — configuration state, which integrations are wired up,
 * which environment variables exist. That is reconnaissance for anyone else,
 * and it is not information a customer needs about the platform they rent.
 */
async function requireAdmin(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return null;

  const role = auth.profile && auth.profile.role;
  if (role !== 'admin' && role !== 'super_admin') {
    res.status(403).json({
      error: 'This is an operator diagnostic and is limited to administrators.',
      code: 'not_admin',
    });
    return null;
  }
  return auth;
}

/**
 * Confirm the caller may bill, or read, the scope they named.
 *
 * An endpoint that meters credits against an id taken from the request body
 * is only as safe as its check that the caller owns that id. Without one,
 * being signed in is enough to spend somebody else's balance — the account
 * gate stops strangers and does nothing about the customer next door.
 *
 * Accepts an intelligence profile (owner or member) or a project (owner).
 * Returns true when the scope is the caller's, false when it is not, and
 * true when neither id was supplied (there is no scope to protect, and the
 * caller is simply unmetered).
 */
async function callerOwnsScope(userId, { intelProfileId, projectId }) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!intelProfileId && !projectId) return true;
  if (!supabaseUrl || !serviceKey) return false;

  if (intelProfileId) {
    const owned = await sbRest(supabaseUrl, serviceKey, 'GET',
      `/intelligence_profiles?id=eq.${encodeURIComponent(intelProfileId)}` +
      `&owner_id=eq.${userId}&select=id&limit=1`);
    if (owned.ok && owned.data && owned.data.length) return true;

    const member = await sbRest(supabaseUrl, serviceKey, 'GET',
      `/intelligence_profile_members?profile_id=eq.${encodeURIComponent(intelProfileId)}` +
      `&user_id=eq.${userId}&select=profile_id&limit=1`);
    return !!(member.ok && member.data && member.data.length);
  }

  const proj = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/projects?id=eq.${encodeURIComponent(projectId)}&user_id=eq.${userId}&select=id&limit=1`);
  return !!(proj.ok && proj.data && proj.data.length);
}

module.exports = { requireUser, requireAdmin, callerOwnsScope, applyOwnerEmail };
