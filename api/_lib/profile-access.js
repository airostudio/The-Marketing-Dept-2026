/**
 * api/_lib/profile-access.js — shared-profile awareness for endpoints that
 * hold the Supabase service-role key and so do their OWN ownership check
 * instead of relying on RLS (api/ab-tests.js, api/email-flows.js, and
 * anything else shaped like them).
 *
 * RLS policies (see supabase-team-access-extend.sql) already let an
 * intelligence-profile member read/write a shared row directly from the
 * browser. But several features go through a server endpoint that uses the
 * service-role key — which bypasses RLS entirely — and re-implements the
 * ownership check itself as a plain `row.user_id === caller.id`. Extending
 * the RLS policy alone does nothing for those: the endpoint still 404s a
 * shared teammate before RLS is ever consulted. This is the one place that
 * check gets taught about profile membership, so it does not have to be
 * re-derived (and re-forgotten) in every endpoint that needs it.
 */

'use strict';

const { sbRest } = require('./supabase-rest.js');

/**
 * Can `callerId` act on a row that's either owned outright (`row.user_id`)
 * or shared via an intelligence profile (`row.intel_profile_id`)?
 *
 * @param {object} row - must have user_id and/or intel_profile_id fields.
 * @param {object} opts
 * @param {boolean} [opts.requireEdit=true] - viewers can read a shared
 *   profile's data but not change it; pass false for a read-only action.
 * @returns {Promise<boolean>}
 */
async function canAccessRecord(supabaseUrl, serviceKey, callerId, row, { requireEdit = true } = {}) {
  if (!row) return false;
  if (row.user_id === callerId) return true;
  if (!row.intel_profile_id) return false;

  const r = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/intelligence_profiles?id=eq.${row.intel_profile_id}&select=owner_id&limit=1`);
  const profile = r.ok && r.data && r.data[0];
  if (profile && profile.owner_id === callerId) return true;

  const m = await sbRest(supabaseUrl, serviceKey, 'GET',
    `/intelligence_profile_members?profile_id=eq.${row.intel_profile_id}&user_id=eq.${callerId}&select=role&limit=1`);
  const member = m.ok && m.data && m.data[0];
  if (!member) return false;
  return requireEdit ? (member.role === 'owner' || member.role === 'editor') : true;
}

/**
 * Every profile id `callerId` can act on — their own profiles' ids plus any
 * they're a member of. Used to build a "mine OR shared with me" list query
 * (`user_id=eq.X OR intel_profile_id=in.(...)`), since a service-role query
 * gets no RLS help filtering that for itself.
 *
 * @returns {Promise<string[]>}
 */
async function accessibleProfileIds(supabaseUrl, serviceKey, callerId) {
  const [owned, memberOf] = await Promise.all([
    sbRest(supabaseUrl, serviceKey, 'GET', `/intelligence_profiles?owner_id=eq.${callerId}&select=id`),
    sbRest(supabaseUrl, serviceKey, 'GET', `/intelligence_profile_members?user_id=eq.${callerId}&select=profile_id`),
  ]);
  const ids = new Set();
  (owned.ok && owned.data ? owned.data : []).forEach(p => ids.add(p.id));
  (memberOf.ok && memberOf.data ? memberOf.data : []).forEach(m => ids.add(m.profile_id));
  return [...ids];
}

/**
 * Build the PostgREST filter fragment for "rows I own, or rows shared with
 * me via a profile I can access" — e.g. for a GET /email_ab_tests?... list.
 * Appends to the query string that already has the table/select; caller
 * joins with '&'.
 */
function ownedOrSharedFilter(callerId, profileIds) {
  if (!profileIds.length) return `user_id=eq.${callerId}`;
  return `or=(user_id.eq.${callerId},intel_profile_id.in.(${profileIds.join(',')}))`;
}

module.exports = { canAccessRecord, accessibleProfileIds, ownedOrSharedFilter };
