/**
 * api/admin-users.js's edit path used to be a lie: admin/users.html's
 * saveUser() called window.Supabase.DB.updateProfile() directly from the
 * browser, relying on the "Admins can update any profile" RLS policy in
 * database/admin-setup.sql. That policy is self-referencing — its USING
 * clause queries `profiles` again to check the caller's own role, which is
 * a well-known Postgres footgun that surfaces as "infinite recursion
 * detected in policy for relation \"profiles\"" — so editing a user from
 * the admin console was unreliable at best.
 *
 * This adds a real 'update' action that goes through the service-role key
 * (bypassing RLS entirely, exactly like 'create' and 'delete' already do),
 * with the same guardrails create/delete already have: only a super_admin
 * may grant super_admin, nobody can change their own role from here, and
 * every change that actually moves role or plan is written to the audit
 * log.
 *
 *   node tests/admin-users-update/run.js
 */
'use strict';

const path = require('path');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';

// audit-log.js's writes are asserted separately — swallow them here so a
// missing network mock for /admin_activity_log doesn't fail unrelated cases.
const auditLogPath = require.resolve(path.join(__dirname, '..', '..', 'api/_lib/audit-log.js'));
const recordedActions = [];
require.cache[auditLogPath] = {
  id: auditLogPath, filename: auditLogPath, loaded: true,
  exports: {
    ACTIONS: { USER_CREATED: 'user_created', USER_DELETED: 'user_deleted', ROLE_GRANTED: 'role_granted', PLAN_CHANGED: 'plan_changed' },
    recordAdminAction: async (opts) => { recordedActions.push(opts); return true; },
  },
};

const handlerPath = path.join(__dirname, '..', '..', 'api/admin-users.js');
delete require.cache[require.resolve(handlerPath)];
const handler = require(handlerPath);

const CALLER_ID = '11111111-1111-1111-1111-111111111111';
const TARGET_ID = '22222222-2222-2222-2222-222222222222';

function makeReq(body) {
  return { method: 'POST', headers: { authorization: 'Bearer test-token', 'user-agent': 'test' }, body };
}
function makeRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.body = d; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}

/** @param {{callerRole, target}} scenario */
function mockFetch(scenario, targetId) {
  targetId = targetId || TARGET_ID;
  return async (url, opts) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      return { ok: true, json: async () => ({ id: CALLER_ID, email: 'admin@example.com' }) };
    }
    if (u.includes(`/rest/v1/profiles?id=eq.${CALLER_ID}&select=role`)) {
      return { ok: true, json: async () => ([{ role: scenario.callerRole }]) };
    }
    if (u.includes(`/rest/v1/profiles?id=eq.${targetId}&select=email,role,plan&limit=1`)) {
      return scenario.target
        ? { ok: true, json: async () => ([scenario.target]) }
        : { ok: true, json: async () => ([]) };
    }
    if (u.includes(`/rest/v1/profiles?id=eq.${targetId}`) && opts.method === 'PATCH') {
      const patch = JSON.parse(opts.body);
      const merged = Object.assign({}, scenario.target, patch);
      return { ok: true, json: async () => ([merged]) };
    }
    throw new Error('Unmocked fetch: ' + opts.method + ' ' + u);
  };
}

async function run(scenario, body) {
  recordedActions.length = 0;
  global.fetch = mockFetch(scenario);
  const res = makeRes();
  await handler(makeReq(Object.assign({ action: 'update', userId: TARGET_ID }, body)), res);
  return res;
}

(async () => {
  console.log('\n──── an admin can update another user\'s name and plan ────');
  {
    const res = await run(
      { callerRole: 'admin', target: { email: 'a@x.com', role: 'user', plan: 'free' } },
      { firstname: 'Ada', lastname: 'Lovelace', plan: 'growth' }
    );
    check('the request succeeds', res.statusCode === 200 && res.body.success === true);
    check('the plan change is written to the audit log',
      recordedActions.some(a => a.action === 'plan_changed' && a.details.from === 'free' && a.details.to === 'growth'));
  }

  console.log('\n──── a plain admin cannot grant super_admin ────');
  {
    const res = await run(
      { callerRole: 'admin', target: { email: 'a@x.com', role: 'user', plan: 'free' } },
      { role: 'super_admin' }
    );
    check('the request is refused (403)', res.statusCode === 403);
    check('nothing is recorded for a refused change', recordedActions.length === 0);
  }

  console.log('\n──── a super_admin CAN grant super_admin ────');
  {
    const res = await run(
      { callerRole: 'super_admin', target: { email: 'a@x.com', role: 'admin', plan: 'free' } },
      { role: 'super_admin' }
    );
    check('the request succeeds', res.statusCode === 200 && res.body.success === true);
    check('the role change is recorded', recordedActions.some(a => a.action === 'role_granted' && a.details.to === 'super_admin'));
  }

  console.log('\n──── nobody can change their own role from this endpoint (self-lockout guard) ────');
  {
    global.fetch = mockFetch({ callerRole: 'super_admin', target: { email: 'admin@example.com', role: 'super_admin', plan: 'free' } }, CALLER_ID);
    const res = makeRes();
    await handler(makeReq({ action: 'update', userId: CALLER_ID, role: 'admin' }), res);
    check('the request is refused (400)', res.statusCode === 400);
  }

  console.log('\n──── updating a nonexistent user 404s instead of silently no-oping ────');
  {
    const res = await run({ callerRole: 'admin', target: null }, { firstname: 'Ghost' });
    check('the request 404s', res.statusCode === 404);
  }

  console.log('\n──── setting the SAME role/plan does not spam the audit log ────');
  {
    const res = await run(
      { callerRole: 'admin', target: { email: 'a@x.com', role: 'user', plan: 'free' } },
      { role: 'user', plan: 'free', firstname: 'NoOp' }
    );
    check('the request still succeeds', res.statusCode === 200);
    check('no audit rows are written for values that did not change', recordedActions.length === 0);
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
