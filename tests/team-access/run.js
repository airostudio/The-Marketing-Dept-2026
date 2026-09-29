/**
 * Team access checks (api/profile-members.js).
 *
 * The owner/editor/viewer schema has existed since
 * supabase-intelligence-profiles.sql and was never used by any UI, because
 * the one step it needs cannot happen in a browser: membership references
 * auth.users, and a client cannot resolve an email to an account. This
 * endpoint does that resolve server-side — which means it holds the
 * service-role key and therefore bypasses RLS, so the permission check the
 * database would normally enforce has to be done explicitly and correctly
 * here. That is what most of these assertions are about.
 *
 *   node tests/team-access/run.js
 */
const path = require('path');
const REPO = path.resolve(__dirname, '../..');

const fail = [];
const check = (name, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) fail.push(name);
};

const OWNER = 'b1e5a3d2-7c44-4e18-9f02-6a3d5c8e91b7';   // a uuid, for the same reason as PROFILE below
const OTHER = 'someone-else';
// A real uuid, because profile-members now rejects anything that is not one
// before it reaches a PostgREST filter. 'profile-1' would have been refused —
// correctly — and the fixture would have been testing the id check rather
// than the permission model it is here for.
const PROFILE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ALICE   = '9c858901-8a57-4791-81fe-4c455b099bc9';

let state, calls;

const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
require.cache[helperPath] = {
  id: helperPath, filename: helperPath, loaded: true,
  exports: {
    // The id check is real, not stubbed — a fake that always says "valid"
    // would let this suite pass while the endpoint shipped without one.
    isUuid: require(path.join(REPO, 'api/_lib/supabase-rest.js')).isUuid,
    sbRest: async (url, key, method, p, body) => {
      calls.push({ method, path: p, body });

      if (p.startsWith('/intelligence_profiles?')) {
        return state.profileMissing
          ? { ok: true, status: 200, data: [] }
          : { ok: true, status: 200, data: [{ id: PROFILE, owner_id: state.ownerId, name: 'Acme Co' }] };
      }
      if (p.startsWith('/profiles?email=')) {
        const wanted = decodeURIComponent(p.split('email=eq.')[1].split('&')[0]);
        const hit = state.accounts.find(a => a.email === wanted);
        return { ok: true, status: 200, data: hit ? [hit] : [] };
      }
      if (p.startsWith('/profiles?id=in.')) {
        return { ok: true, status: 200, data: state.accounts };
      }
      if (p.startsWith('/intelligence_profile_members') && method === 'GET') {
        return { ok: true, status: 200, data: state.members };
      }
      if (p === '/intelligence_profile_members' && method === 'POST') {
        if (state.members.some(m => m.user_id === body.user_id)) {
          return { ok: false, status: 409, data: null };
        }
        state.members.push({ user_id: body.user_id, role: body.role, created_at: 'now' });
        return { ok: true, status: 201, data: [body] };
      }
      if (p.startsWith('/intelligence_profile_members') && method === 'PATCH') {
        const uid = p.split('user_id=eq.')[1];
        const m = state.members.find(x => x.user_id === uid);
        if (m) m.role = body.role;
        return { ok: true, status: 200, data: [] };
      }
      if (p.startsWith('/intelligence_profile_members') && method === 'DELETE') {
        const uid = p.split('user_id=eq.')[1];
        state.members = state.members.filter(x => x.user_id !== uid);
        return { ok: true, status: 200, data: [] };
      }
      return { ok: false, status: 404, data: null };
    },
  },
};

const handler = require(path.join(REPO, 'api/profile-members.js'));

global.fetch = async (url) => {
  if (String(url).includes('/auth/v1/user')) {
    return state.callerId
      ? { ok: true, json: async () => ({ id: state.callerId, email: 'caller@x.com' }) }
      : { ok: false, json: async () => ({}) };
  }
  throw new Error('unexpected fetch: ' + url);
};

async function call(body, opts) {
  opts = opts || {};
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  calls = [];
  let status = 200, payload = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(o) { payload = o; return this; }, end() { return this; },
  };
  await handler({ method: 'POST', headers: { authorization: opts.noAuth ? '' : 'Bearer t' }, body }, res);
  return { status, body: payload };
}

function reset(overrides) {
  state = Object.assign({
    callerId: OWNER,
    ownerId: OWNER,
    profileMissing: false,
    members: [],
    accounts: [
      { id: ALICE, email: 'alice@example.com', firstname: 'Alice', lastname: 'Ng' },
      { id: OWNER, email: 'owner@example.com', firstname: 'Sam', lastname: 'Rivera' },
    ],
  }, overrides || {});
}

(async () => {
  console.log('──── permission: only the owner manages access ────');

  reset({ callerId: OTHER });
  let r = await call({ action: 'list', profileId: PROFILE });
  check('a non-owner cannot even list who has access', r.status === 403);
  check('and is told why, not given a generic failure', /Only the owner/i.test(r.body.error));

  reset({ callerId: OTHER });
  r = await call({ action: 'invite', profileId: PROFILE, email: 'alice@example.com', role: 'editor' });
  check('a non-owner cannot grant access', r.status === 403 && state.members.length === 0);

  reset({ callerId: OTHER });
  r = await call({ action: 'remove', profileId: PROFILE, userId: ALICE });
  check('a non-owner cannot remove access', r.status === 403);

  reset();
  r = await call({ action: 'list', profileId: PROFILE }, { noAuth: true });
  check('no bearer token is rejected', r.status === 401);

  reset({ callerId: null });
  r = await call({ action: 'list', profileId: PROFILE });
  check('an invalid token is rejected', r.status === 401);

  reset({ profileMissing: true });
  r = await call({ action: 'list', profileId: PROFILE });
  check('a profile that does not exist is a 404, not a leak', r.status === 404);

  check('ownership is read from the database on every call, never from the request',
    calls.some(c => c.path.startsWith('/intelligence_profiles?id=eq.')));

  console.log('\n──── inviting ────');

  reset();
  r = await call({ action: 'invite', profileId: PROFILE, email: 'alice@example.com', role: 'editor' });
  console.log('  invited:', JSON.stringify(r.body.member));
  check('the owner can grant access by email', r.status === 200 && r.body.success === true);
  check('the email was resolved to a real account', r.body.member.userId === ALICE);
  check('the member is returned with a human name, not a UUID', r.body.member.name === 'Alice Ng');

  r = await call({ action: 'invite', profileId: PROFILE, email: 'alice@example.com', role: 'viewer' });
  check('inviting the same person twice is refused clearly', r.status === 409 && /already has access/i.test(r.body.error));

  reset();
  r = await call({ action: 'invite', profileId: PROFILE, email: 'nobody@example.com', role: 'editor' });
  console.log('  unknown email:', r.status, '|', (r.body.message || '').slice(0, 80));
  check('inviting an address with no account fails explicitly', r.status === 404 && r.body.error === 'no_account');
  check('and explains what to do about it', /sign up first/i.test(r.body.message));
  check('nothing was written for an unresolvable invite', state.members.length === 0);

  reset();
  r = await call({ action: 'invite', profileId: PROFILE, email: 'owner@example.com', role: 'editor' });
  check('the owner cannot be added as their own member', r.status === 400 && /already owns/i.test(r.body.error));

  reset();
  r = await call({ action: 'invite', profileId: PROFILE, email: 'alice@example.com', role: 'owner' });
  check('"owner" is not a grantable role', r.status === 400 && state.members.length === 0);

  r = await call({ action: 'invite', profileId: PROFILE, email: 'not-an-email', role: 'editor' });
  check('a malformed email is rejected', r.status === 400);

  console.log('\n──── managing ────');

  reset({ members: [{ user_id: ALICE, role: 'editor', created_at: 'now' }] });
  r = await call({ action: 'list', profileId: PROFILE });
  check('members list resolves emails and roles',
    r.body.members.length === 1 && r.body.members[0].email === 'alice@example.com' &&
    r.body.members[0].role === 'editor');

  r = await call({ action: 'updateRole', profileId: PROFILE, userId: ALICE, role: 'viewer' });
  check('a role can be downgraded', r.status === 200 && state.members[0].role === 'viewer');

  r = await call({ action: 'updateRole', profileId: PROFILE, userId: ALICE, role: 'owner' });
  check('a role cannot be escalated to owner', r.status === 400 && state.members[0].role === 'viewer');

  r = await call({ action: 'remove', profileId: PROFILE, userId: OWNER });
  check("the owner's own access cannot be removed", r.status === 400 && /owner/i.test(r.body.error));

  r = await call({ action: 'remove', profileId: PROFILE, userId: ALICE });
  check('a member can be removed', r.status === 200 && state.members.length === 0);

  reset();
  r = await call({ action: 'nonsense', profileId: PROFILE });
  check('an unknown action is rejected', r.status === 400);

  r = await call({ action: 'list' });
  check('a missing profileId is rejected', r.status === 400);

  // An id is a uuid or it is not an id. Both ids here are interpolated into
  // PostgREST filter strings, so a value carrying '&' would be composing part
  // of a query it does not own — extra filters cannot broaden a result, but
  // '&select=', '&limit=' and '&order=' are all reachable that way.
  reset();
  r = await call({ action: 'list', profileId: PROFILE + '&select=*' });
  check('a profileId carrying a query parameter is refused',
    r.status === 400 && /valid id/i.test(r.body.error));
  check('and no query was issued with it',
    !calls.some(c => String(c.path).includes('select=*')));

  reset();
  r = await call({ action: 'remove', profileId: PROFILE, userId: 'alice-id' });
  check('a userId that is not a uuid is refused',
    r.status === 400 && /valid id/i.test(r.body.error));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();
