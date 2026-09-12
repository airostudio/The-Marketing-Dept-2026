/**
 * api/profile-members.js — share a business (intelligence profile) with
 * teammates.
 *
 * The schema for this has existed since supabase-intelligence-profiles.sql:
 * intelligence_profile_members with owner/editor/viewer roles, RLS policies,
 * and can_edit_intel_profile() already wired into the Business Brain
 * policies. Nothing ever used it, because the one step it needs cannot be
 * done from a browser: intelligence_profile_members.user_id references
 * auth.users, and a client cannot look a person up by email (auth.users
 * isn't client-readable, and profiles RLS only exposes your own row). So
 * "invite alice@example.com" requires a server-side resolve.
 *
 * Authorisation follows api/admin-users.js's shape — decode the caller's own
 * bearer token server-side, then check a real permission — except the
 * permission here is "do you own this profile", not "are you an admin".
 * Ownership is re-checked from the database on every action; it is never
 * taken from the request.
 *
 * POST { action: 'list',       profileId }
 * POST { action: 'invite',     profileId, email, role }
 * POST { action: 'updateRole', profileId, userId, role }
 * POST { action: 'remove',     profileId, userId }
 * Header: Authorization: Bearer <the caller's own Supabase access token>
 *
 * Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

'use strict';

const { sbRest, isUuid } = require('./_lib/supabase-rest.js');
const { withFailureReporting } = require('./_lib/report-failure.js');

const ROLES = ['editor', 'viewer'];   // 'owner' is the profile's owner_id, not a grantable role

async function getCallerFromToken(supabaseUrl, serviceKey, accessToken) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return res.json();
}

/** Resolve an email to an account. Returns null when nobody has that address. */
async function findUserByEmail(supabaseUrl, serviceKey, email) {
  // profiles carries the email and is far cheaper to query than paging the
  // Auth admin user list.
  const res = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/profiles?email=eq.${encodeURIComponent(email)}&select=id,email,firstname,lastname&limit=1`);
  if (res.ok && res.data && res.data[0]) return res.data[0];
  return null;
}

/** Attach emails/names to member rows so the UI can show people, not UUIDs. */
async function decorateMembers(supabaseUrl, serviceKey, members) {
  if (!members.length) return [];
  const ids = members.map(m => m.user_id).join(',');
  const res = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/profiles?id=in.(${ids})&select=id,email,firstname,lastname`);
  const byId = {};
  (res.ok && res.data ? res.data : []).forEach(p => { byId[p.id] = p; });
  return members.map(m => {
    const p = byId[m.user_id] || {};
    const name = [p.firstname, p.lastname].filter(Boolean).join(' ').trim();
    return {
      userId: m.user_id,
      role: m.role,
      email: p.email || null,
      name: name || null,
      addedAt: m.created_at,
    };
  });
}

module.exports = withFailureReporting('api/profile-members', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured.' });
  }

  const accessToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header.' });

  const caller = await getCallerFromToken(supabaseUrl, serviceKey, accessToken);
  if (!caller?.id) return res.status(401).json({ error: 'Invalid or expired session.' });

  const { action, profileId, email, userId, role } = req.body || {};
  if (!profileId) return res.status(400).json({ error: 'profileId is required' });

  // Both ids go straight into PostgREST filter strings below. Anything that
  // is not a uuid could never have matched a row, so rejecting it here costs
  // a real caller nothing and stops a value carrying '&' from adding query
  // parameters to a request it does not own.
  if (!isUuid(profileId)) return res.status(400).json({ error: 'profileId is not a valid id' });
  if (userId !== undefined && userId !== null && !isUuid(userId)) {
    return res.status(400).json({ error: 'userId is not a valid id' });
  }

  // Ownership, read fresh from the database. This endpoint holds the
  // service-role key and so bypasses RLS — the check the database would
  // normally do has to be done explicitly here instead.
  const profRes = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/intelligence_profiles?id=eq.${profileId}&select=id,owner_id,name`);
  const profile = (profRes.ok && profRes.data && profRes.data[0]) || null;
  if (!profile) return res.status(404).json({ error: 'That business profile does not exist.' });
  if (profile.owner_id !== caller.id) {
    return res.status(403).json({ error: 'Only the owner of this business can manage who has access to it.' });
  }

  try {
    if (action === 'list') {
      const r = await sbRest(supabaseUrl, serviceKey, 'GET',
        `/intelligence_profile_members?profile_id=eq.${profileId}&select=user_id,role,created_at&order=created_at.asc`);
      const members = await decorateMembers(supabaseUrl, serviceKey, (r.ok && r.data) || []);
      return res.json({ profile: { id: profile.id, name: profile.name }, members });
    }

    if (action === 'invite') {
      const addr = String(email || '').trim().toLowerCase();
      if (!addr || !addr.includes('@')) return res.status(400).json({ error: 'A valid email address is required.' });
      if (!ROLES.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
      }

      const person = await findUserByEmail(supabaseUrl, serviceKey, addr);
      if (!person) {
        // Say exactly what's wrong and what to do. Membership rows reference
        // auth.users, so there is genuinely nothing to link to until this
        // person has an account — silently doing nothing would be worse.
        return res.status(404).json({
          error: 'no_account',
          message: `No Audema account uses ${addr}. Ask them to sign up first, then invite them — access is granted to an existing account, so there is nothing to attach an invitation to yet.`,
        });
      }
      if (person.id === profile.owner_id) {
        return res.status(400).json({ error: 'That person already owns this business.' });
      }

      const ins = await sbRest(supabaseUrl, serviceKey, 'POST', '/intelligence_profile_members',
        { profile_id: profileId, user_id: person.id, role });
      if (!ins.ok) {
        // (profile_id, user_id) is the primary key, so a repeat invite lands here.
        if (ins.status === 409) {
          return res.status(409).json({ error: 'That person already has access to this business.' });
        }
        return res.status(502).json({ error: 'Could not grant access.', status: ins.status });
      }

      const members = await decorateMembers(supabaseUrl, serviceKey,
        [{ user_id: person.id, role, created_at: new Date().toISOString() }]);
      return res.json({ success: true, member: members[0] });
    }

    if (action === 'updateRole') {
      if (!userId) return res.status(400).json({ error: 'userId is required' });
      if (!ROLES.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
      }
      const upd = await sbRest(supabaseUrl, serviceKey, 'PATCH',
        `/intelligence_profile_members?profile_id=eq.${profileId}&user_id=eq.${userId}`, { role });
      if (!upd.ok) return res.status(502).json({ error: 'Could not update that role.' });
      return res.json({ success: true, userId, role });
    }

    if (action === 'remove') {
      if (!userId) return res.status(400).json({ error: 'userId is required' });
      if (userId === profile.owner_id) {
        return res.status(400).json({ error: "The owner's access cannot be removed." });
      }
      const del = await sbRest(supabaseUrl, serviceKey, 'DELETE',
        `/intelligence_profile_members?profile_id=eq.${profileId}&user_id=eq.${userId}`);
      if (!del.ok) return res.status(502).json({ error: 'Could not remove that person.' });
      return res.json({ success: true, userId });
    }

    return res.status(400).json({
      error: `Unknown action "${action}". Use 'list', 'invite', 'updateRole' or 'remove'.`,
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});
