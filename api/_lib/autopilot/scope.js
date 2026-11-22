/**
 * api/_lib/autopilot/scope.js — which business a request is for, and whose
 * records it lives under. Records for a shared business profile are owned
 * by the profile's owner, so the whole team works from one set.
 */

'use strict';

const { sbRest, isUuid } = require('../supabase-rest.js');
const { canAccessRecord } = require('../profile-access.js');

/**
 * @returns {Promise<{ownerId, intel_profile_id, project_id, filter} | {err: {http, error, code?}}>}
 */
async function scopeFor(callerId, b, { requireEdit = true } = {}) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (b.intelProfileId) {
    if (!isUuid(b.intelProfileId)) return { err: { http: 400, error: 'intelProfileId is not a valid id.' } };
    if (!(await canAccessRecord(url, key, callerId, { user_id: null, intel_profile_id: b.intelProfileId }, { requireEdit }))) return { err: { http: 403, error: 'You do not have access to that business profile.' } };
    const p = await sbRest(url, key, 'GET', `/intelligence_profiles?id=eq.${b.intelProfileId}&select=owner_id&limit=1`);
    return { ownerId: (p.ok && p.data && p.data[0] && p.data[0].owner_id) || callerId, intel_profile_id: b.intelProfileId, project_id: null, filter: `intel_profile_id=eq.${b.intelProfileId}` };
  }
  if (b.projectId) {
    if (!isUuid(b.projectId)) return { err: { http: 400, error: 'projectId is not a valid id.' } };
    const pr = await sbRest(url, key, 'GET', `/projects?id=eq.${b.projectId}&user_id=eq.${callerId}&select=id&limit=1`);
    if (!(pr.ok && pr.data && pr.data[0])) return { err: { http: 403, error: 'That project is not yours.' } };
    return { ownerId: callerId, intel_profile_id: null, project_id: b.projectId, filter: `project_id=eq.${b.projectId}` };
  }
  return { err: { http: 409, code: 'no_scope', error: 'Pick a business profile or project first.' } };
}

/** May this caller act on this row (autopilot, connection, job…)? */
async function canAct(callerId, row, requireEdit = true) {
  if (!row) return false;
  return canAccessRecord(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, callerId, row, { requireEdit });
}

module.exports = { scopeFor, canAct };
