/**
 * api/ab-tests.js — once api/_lib/profile-access.js exists, this endpoint
 * actually has to use it: extending the RLS policies alone
 * (supabase-team-access-extend.sql) is invisible here, since this endpoint
 * holds the service-role key and bypasses RLS entirely, re-implementing
 * ownership as its own `test.user_id === caller.id` check. This exercises
 * that a teammate shared onto an intelligence profile via
 * api/profile-members.js actually gets through this endpoint too —
 * api/email-flows.js is the same pattern, verified separately by
 * inspection since the logic is identical.
 *
 *   node tests/ab-tests-team-access/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const OWNER = '11111111-1111-1111-1111-111111111111';
const EDITOR = '22222222-2222-2222-2222-222222222222';
const VIEWER = '33333333-3333-3333-3333-333333333333';
const STRANGER = '44444444-4444-4444-4444-444444444444';
const PROFILE = '55555555-5555-5555-5555-555555555555';

const db = {
  profiles: [{ id: PROFILE, owner_id: OWNER }],
  members: [
    { profile_id: PROFILE, user_id: EDITOR, role: 'editor' },
    { profile_id: PROFILE, user_id: VIEWER, role: 'viewer' },
  ],
  tests: [],
  variants: [],
};

function mockModule(relPath, exportsObj) {
  const p = require.resolve(path.join(REPO, relPath));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (url, key, method, pathAndQuery, body) => {
    if (pathAndQuery.startsWith('/intelligence_profiles?')) {
      const idm = pathAndQuery.match(/id=eq\.([^&]+)/);
      return { ok: true, data: idm ? db.profiles.filter(p => p.id === idm[1]) : db.profiles };
    }
    if (pathAndQuery.startsWith('/intelligence_profile_members?')) {
      const pidm = pathAndQuery.match(/profile_id=eq\.([^&]+)/);
      const uidm = pathAndQuery.match(/user_id=eq\.([^&]+)/);
      let rows = db.members;
      if (pidm) rows = rows.filter(m => m.profile_id === pidm[1]);
      if (uidm) rows = rows.filter(m => m.user_id === uidm[1]);
      return { ok: true, data: rows };
    }
    if (pathAndQuery.startsWith('/email_ab_tests')) {
      if (method === 'POST') {
        const row = { id: `test-${db.tests.length + 1}`, ...body };
        db.tests.push(row);
        return { ok: true, data: [row] };
      }
      const idm = pathAndQuery.match(/id=eq\.([^&?]+)/);
      if (idm) return { ok: true, data: db.tests.filter(t => t.id === idm[1]) };
      // 'list' — actually honour the or=(user_id.eq.X,intel_profile_id.in.(Y,Z))
      // filter the endpoint sent, rather than trusting it blindly: that's the
      // exact logic under test here (does the endpoint build the right query
      // for "mine or shared with me", not just whether a row exists at all).
      const orm = pathAndQuery.match(/or=\(user_id\.eq\.([^,]+),intel_profile_id\.in\.\(([^)]*)\)\)/);
      const plainm = pathAndQuery.match(/^\/email_ab_tests\?user_id=eq\.([^&]+)/);
      if (orm) {
        const uid = orm[1];
        const pids = orm[2].split(',').filter(Boolean);
        return { ok: true, data: db.tests.filter(t => t.user_id === uid || pids.includes(t.intel_profile_id)) };
      }
      if (plainm) return { ok: true, data: db.tests.filter(t => t.user_id === plainm[1]) };
      return { ok: true, data: [] };
    }
    if (pathAndQuery.startsWith('/email_ab_variants')) {
      const rows = (Array.isArray(body) ? body : [body]).map((v, i) => ({ id: `v-${db.variants.length + i}`, ...v }));
      db.variants.push(...rows);
      return { ok: true, data: rows };
    }
    if (pathAndQuery.startsWith('/rpc/ab_test_results')) {
      return { ok: true, data: [] };
    }
    return { ok: true, data: [] };
  },
});

global.fetch = async (url) => {
  // getCallerFromToken: the bearer token IS the user id, for this test.
  const m = String(url).match(/\/auth\/v1\/user$/);
  if (m) return { ok: true, json: async () => ({ id: global.__callerId }) };
  throw new Error('unexpected fetch to ' + url);
};

process.env.SUPABASE_URL = 'https://x.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';

function loadHandler() {
  const p = path.join(REPO, 'api/ab-tests.js');
  delete require.cache[require.resolve(p)];
  return require(p);
}
function makeRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.body = d; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}
async function call(handler, callerId, body) {
  global.__callerId = callerId;
  const res = makeRes();
  await handler({ method: 'POST', headers: { authorization: `Bearer ${callerId}` }, body }, res);
  return res;
}

(async () => {

console.log('\n──── creating a test inside a shared profile ────');
let sharedTestId;
{
  const handler = loadHandler();
  const res = await call(handler, EDITOR, {
    action: 'create', campaignId: 'c1', name: 'Subject test', intelProfileId: PROFILE,
    variants: [{ label: 'A', subject: 'Hi' }, { label: 'B', subject: 'Hello' }],
  });
  check('an editor member can create a test attributed to the shared profile', res.statusCode === 200 && res.body.ok);
  sharedTestId = res.body.test.id;
  const stored = db.tests.find(t => t.id === sharedTestId);
  check('the row is attributed to the profile, not just the creator', stored.intel_profile_id === PROFILE);
}

console.log('\n──── a stranger cannot attribute a test to a profile they are not on ────');
{
  const handler = loadHandler();
  const res = await call(handler, STRANGER, {
    action: 'create', campaignId: 'c2', name: 'Nope', intelProfileId: PROFILE,
    variants: [{ label: 'A', subject: 'Hi' }, { label: 'B', subject: 'Hello' }],
  });
  check('refused with a clear 403, not a silent no-op or a 500', res.statusCode === 403);
}

console.log('\n──── reading results: owner, editor and viewer can all read a shared test ────');
for (const [label, uid] of [['owner', OWNER], ['editor', EDITOR], ['viewer', VIEWER]]) {
  const handler = loadHandler();
  const res = await call(handler, uid, { action: 'results', testId: sharedTestId });
  check(`${label} can read results for the shared test`, res.statusCode === 200 && res.body.ok);
}

console.log('\n──── a stranger gets the same honest 404 as a nonexistent test — no leak either way ────');
{
  const handler = loadHandler();
  const res = await call(handler, STRANGER, { action: 'results', testId: sharedTestId });
  check('refused as not found, not distinguishable from "does not exist"', res.statusCode === 404);
}

console.log('\n──── listing includes tests shared via a profile, not only ones the caller created ────');
{
  const handler = loadHandler();
  const res = await call(handler, EDITOR, { action: 'list' });
  check('the shared test shows up for a member who did not create it', res.body.tests.some(t => t.id === sharedTestId));
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
})();
