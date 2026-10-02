/**
 * api/_lib/profile-access.js — shared-profile awareness for the service-
 * role endpoints (api/ab-tests.js, api/email-flows.js) that bypass RLS and
 * do their own ownership check. Extending the RLS policies alone
 * (supabase-team-access-extend.sql) does nothing for these: without this,
 * a teammate invited onto a shared intelligence profile would still get a
 * flat 404 from these endpoints, RLS access or not.
 *
 *   node tests/profile-access/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

function mockModule(relPath, exportsObj) {
  const p = require.resolve(path.join(REPO, relPath));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

const OWNER = 'owner-1', EDITOR = 'editor-1', VIEWER = 'viewer-1', STRANGER = 'stranger-1';
const PROFILE = 'profile-1';

const db = {
  profiles: [{ id: PROFILE, owner_id: OWNER }],
  members: [
    { profile_id: PROFILE, user_id: EDITOR, role: 'editor' },
    { profile_id: PROFILE, user_id: VIEWER, role: 'viewer' },
  ],
};

mockModule('api/_lib/supabase-rest.js', {
  isUuid: () => true,
  sbRest: async (url, key, method, pathAndQuery) => {
    if (pathAndQuery.startsWith('/intelligence_profiles?')) {
      const m = pathAndQuery.match(/owner_id=eq\.([^&]+)/);
      if (m) return { ok: true, data: db.profiles.filter(p => p.owner_id === m[1]) };
      const idm = pathAndQuery.match(/id=eq\.([^&]+)/);
      return { ok: true, data: db.profiles.filter(p => p.id === idm[1]) };
    }
    if (pathAndQuery.startsWith('/intelligence_profile_members?')) {
      const pidm = pathAndQuery.match(/profile_id=eq\.([^&]+)/);
      const uidm = pathAndQuery.match(/user_id=eq\.([^&]+)/);
      let rows = db.members;
      if (pidm) rows = rows.filter(m => m.profile_id === pidm[1]);
      if (uidm) rows = rows.filter(m => m.user_id === uidm[1]);
      return { ok: true, data: rows };
    }
    return { ok: true, data: [] };
  },
});

const { canAccessRecord, accessibleProfileIds, ownedOrSharedFilter } = require(path.join(REPO, 'api/_lib/profile-access.js'));

(async () => {

console.log('\n──── canAccessRecord: outright ownership ────');
check('the record owner always has access', await canAccessRecord('u', 'k', OWNER, { user_id: OWNER, intel_profile_id: null }));
check('a stranger with no profile link has no access', !(await canAccessRecord('u', 'k', STRANGER, { user_id: OWNER, intel_profile_id: null })));

console.log('\n──── canAccessRecord: shared via an intelligence profile ────');
check('the profile\'s owner can edit a row shared through it', await canAccessRecord('u', 'k', OWNER, { user_id: 'someone-else', intel_profile_id: PROFILE }));
check('an editor member can edit it too', await canAccessRecord('u', 'k', EDITOR, { user_id: 'someone-else', intel_profile_id: PROFILE }));
check('a viewer member cannot edit it (requireEdit defaults to true)', !(await canAccessRecord('u', 'k', VIEWER, { user_id: 'someone-else', intel_profile_id: PROFILE })));
check('a viewer member CAN read it when requireEdit is explicitly false', await canAccessRecord('u', 'k', VIEWER, { user_id: 'someone-else', intel_profile_id: PROFILE }, { requireEdit: false }));
check('someone not on the profile at all has no access, viewer or not', !(await canAccessRecord('u', 'k', STRANGER, { user_id: 'someone-else', intel_profile_id: PROFILE }, { requireEdit: false })));

console.log('\n──── accessibleProfileIds / ownedOrSharedFilter ────');
{
  const ids = await accessibleProfileIds('u', 'k', EDITOR);
  check('a member\'s accessible profiles include the one they were added to', ids.includes(PROFILE));
  const ownerIds = await accessibleProfileIds('u', 'k', OWNER);
  check('an owner\'s accessible profiles include their own', ownerIds.includes(PROFILE));
  const strangerIds = await accessibleProfileIds('u', 'k', STRANGER);
  check('someone with no profiles at all gets an empty list, not an error', Array.isArray(strangerIds) && strangerIds.length === 0);
}
{
  const filter = ownedOrSharedFilter(EDITOR, [PROFILE]);
  check('the filter covers both "mine" and "shared with me"', filter.includes(`user_id.eq.${EDITOR}`) && filter.includes(PROFILE));
  const noShares = ownedOrSharedFilter(STRANGER, []);
  check('with no shared profiles, the filter degrades to plain ownership rather than a malformed "in.()"', noShares === `user_id=eq.${STRANGER}`);
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
})();
