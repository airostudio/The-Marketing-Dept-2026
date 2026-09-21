/**
 * api/admin-users.js — Privileged user management for the admin dashboard
 *
 * The two actions that genuinely require Supabase's Admin API (which only
 * the service-role key can call) and therefore can't be done safely from
 * the browser:
 *
 *   - create: provisioning a real, pre-confirmed auth.users account for
 *     someone else. The client-side self-service `auth.signUp()` call
 *     (what admin/users.html used before this file existed) operates on
 *     the CALLER's own Supabase client session — calling it from the admin
 *     dashboard risks swapping the admin's own browser session over to the
 *     brand-new account, and leaves the account unconfirmed if email
 *     confirmation is on.
 *   - delete: removing the actual auth.users row. Deleting only the
 *     `profiles` row (what the dashboard used to do) leaves an orphaned
 *     auth account that can still log in with a missing/broken profile.
 *
 * - update: changing another user's role/plan/name. The "Admins can
 *   view/update all profiles" RLS policies in database/admin-setup.sql are
 *   self-referencing (a policy on `profiles` that queries `profiles` again
 *   inside its own USING clause to check the caller's role) — a well-known
 *   Postgres footgun that surfaces as "infinite recursion detected in
 *   policy for relation \"profiles\"" and made the old client-side edit
 *   path in admin/users.html unreliable. Routing through the service key
 *   here bypasses RLS entirely, the same way create/delete already do.
 *
 * POST { action: 'create', email, password, firstname?, lastname?, role?, plan? }
 * POST { action: 'update', userId, firstname?, lastname?, role?, plan? }
 * POST { action: 'delete', userId }
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *   (from window.Supabase.Auth.getSession() — this is the same JWT the
 *   browser already holds for every authenticated request, not a new
 *   credential exposure.)
 *
 * The service-role key itself never leaves this file — it's used here only
 * to (a) verify the caller's own role via the profiles table and (b) call
 * Supabase's Auth Admin REST API on the caller's behalf once verified.
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

'use strict';

const { sbRest } = require('./_lib/supabase-rest.js');
const { recordAdminAction, ACTIONS } = require('./_lib/audit-log.js');
const { withFailureReporting } = require('./_lib/report-failure.js');
async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function getCallerRole(supabaseUrl, serviceKey, userId) {
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=role`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(10000),
  });
  const rows = await res.json().catch(() => []);
  return rows?.[0]?.role || null;
}

async function createUser(supabaseUrl, serviceKey, { email, password, firstname, lastname, role, plan }) {
  const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true, // admin-created accounts are pre-confirmed — no confirmation email round-trip
      user_metadata: { firstname, lastname, first_name: firstname, last_name: lastname },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    throw new Error(createData.msg || createData.message || `Auth admin create failed (${createRes.status})`);
  }

  const newUserId = createData.id;

  // The on_auth_user_created trigger inserts a default profiles row
  // (role='user', plan='free') right after this — patch it to whatever
  // role/plan the admin actually picked in the form.
  if (role || plan) {
    await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${newUserId}`, {
      method: 'PATCH',
      headers: {
        'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ role: role || 'user', plan: plan || 'free' }),
      signal: AbortSignal.timeout(10000),
    });
  }

  return { id: newUserId, email: createData.email };
}

async function updateUser(supabaseUrl, serviceKey, userId, { firstname, lastname, role, plan }) {
  const patch = {};
  if (firstname !== undefined) patch.firstname = firstname;
  if (lastname !== undefined) patch.lastname = lastname;
  if (role !== undefined) patch.role = role;
  if (plan !== undefined) patch.plan = plan;
  if (Object.keys(patch).length === 0) return;

  const res = await sbRest(supabaseUrl, serviceKey, 'PATCH', `/profiles?id=eq.${encodeURIComponent(userId)}`, patch);
  if (!res.ok) {
    throw new Error((res.data && (res.data.message || res.data.msg)) || `Profile update failed (${res.status})`);
  }
  if (!res.data || !res.data.length) {
    throw new Error('No such user.');
  }
  return res.data[0];
}

async function deleteUser(supabaseUrl, serviceKey, userId) {
  // profiles.id REFERENCES auth.users(id) ON DELETE CASCADE — deleting the
  // auth user takes the profile row with it in one call.
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok && res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.msg || data.message || `Auth admin delete failed (${res.status})`);
  }
}

module.exports = withFailureReporting('api/admin-users', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header.' });

  const caller = await getCallerFromToken(supabaseUrl, serviceKey, accessToken);
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session.' });

  const callerRole = await getCallerRole(supabaseUrl, serviceKey, caller.id);
  if (callerRole !== 'admin' && callerRole !== 'super_admin') {
    return res.status(403).json({ error: 'Admin privileges required.' });
  }

  const { action } = req.body || {};

  try {
    if (action === 'create') {
      const { email, password, firstname = '', lastname = '', role = 'user', plan = 'free' } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
      if (role === 'super_admin' && callerRole !== 'super_admin') {
        return res.status(403).json({ error: 'Only a super_admin can create another super_admin.' });
      }
      const user = await createUser(supabaseUrl, serviceKey, { email, password, firstname, lastname, role, plan });
      // After the account exists, never before: a record of a creation that
      // then failed is worse than no record. Note what was set, not the
      // password it was set with.
      await recordAdminAction({
        req, adminId: caller.id, adminEmail: caller.email,
        action: ACTIONS.USER_CREATED,
        targetUserId: user && user.id, targetEmail: email,
        details: { role, plan, firstname, lastname },
      });
      if (role === 'admin' || role === 'super_admin') {
        await recordAdminAction({
          req, adminId: caller.id, adminEmail: caller.email,
          action: ACTIONS.ROLE_GRANTED,
          targetUserId: user && user.id, targetEmail: email,
          details: { role, grantedAtCreation: true },
        });
      }
      return res.json({ success: true, user });
    }

    if (action === 'update') {
      const { userId, firstname, lastname, role, plan } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId is required' });

      let targetBefore = null;
      try {
        const before = await sbRest(supabaseUrl, serviceKey, 'GET',
          `/profiles?id=eq.${encodeURIComponent(userId)}&select=email,role,plan&limit=1`);
        targetBefore = (before.ok && before.data && before.data[0]) || null;
      } catch (e) { /* fall through — updateUser() below will 404 if the user truly doesn't exist */ }
      if (!targetBefore) return res.status(404).json({ error: 'No such user.' });

      if (role !== undefined && role !== targetBefore.role) {
        if (role === 'super_admin' && callerRole !== 'super_admin') {
          return res.status(403).json({ error: 'Only a super_admin can grant super_admin.' });
        }
        if (userId === caller.id) {
          return res.status(400).json({ error: "You can't change your own role — ask another admin." });
        }
      }

      const updated = await updateUser(supabaseUrl, serviceKey, userId, { firstname, lastname, role, plan });

      if (role !== undefined && role !== targetBefore.role) {
        await recordAdminAction({
          req, adminId: caller.id, adminEmail: caller.email,
          action: ACTIONS.ROLE_GRANTED,
          targetUserId: userId, targetEmail: targetBefore.email,
          details: { from: targetBefore.role, to: role },
        });
      }
      if (plan !== undefined && plan !== targetBefore.plan) {
        await recordAdminAction({
          req, adminId: caller.id, adminEmail: caller.email,
          action: ACTIONS.PLAN_CHANGED,
          targetUserId: userId, targetEmail: targetBefore.email,
          details: { from: targetBefore.plan, to: plan },
        });
      }
      return res.json({ success: true, user: updated });
    }

    if (action === 'delete') {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId is required' });
      if (userId === caller.id) return res.status(400).json({ error: "You can't delete your own account from here." });
      // Read the email before the account goes, or the audit row records a
      // uuid that now resolves to nothing.
      let targetEmail = null;
      try {
        const before = await sbRest(supabaseUrl, serviceKey, 'GET',
          `/profiles?id=eq.${encodeURIComponent(userId)}&select=email&limit=1`);
        targetEmail = (before.ok && before.data && before.data[0] && before.data[0].email) || null;
      } catch (e) { /* the delete still proceeds; the row just carries no email */ }

      await deleteUser(supabaseUrl, serviceKey, userId);
      await recordAdminAction({
        req, adminId: caller.id, adminEmail: caller.email,
        action: ACTIONS.USER_DELETED,
        targetUserId: userId, targetEmail,
        details: {},
      });
      return res.json({ success: true });
    }

    return res.status(400).json({ error: `Unknown action "${action}". Use 'create', 'update' or 'delete'.` });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});
