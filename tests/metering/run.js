/**
 * Agent Mission metering checks.
 *
 * The Agent Mission is the unit every pricing tier is sold on, so this is
 * where a plan stops being a label and becomes a limit. Two properties matter
 * most and are asserted here:
 *
 *   1. The gate refuses when the allowance is spent, with a route to upgrade.
 *   2. A meter that is unconfigured, unreachable or erroring lets the work
 *      through. A broken meter is an operator problem; it must never look
 *      like a billing wall to a paying customer.
 *
 *   node tests/metering/run.js
 */
const path = require('path');
const Module = require('module');
const REPO = path.resolve(__dirname, '../..');

const fail = [];
const check = (name, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) fail.push(name);
};

/* ── 1. The allowance table ─────────────────────────────────────────────── */
console.log('──── plan allowances ────');
const PL = require(path.join(REPO, 'api/_lib/plan-limits.js'));

check('every plan in the pricing has an allowance',
  ['free','start','growth','scale','autonomous','enterprise',
   'agency_starter','agency_growth','agency_pro','agency_enterprise']
    .every(p => Object.prototype.hasOwnProperty.call(PL.MISSION_ALLOWANCES, p)));
check('allowances rise with the price points',
  PL.MISSION_ALLOWANCES.start < PL.MISSION_ALLOWANCES.growth &&
  PL.MISSION_ALLOWANCES.growth < PL.MISSION_ALLOWANCES.scale &&
  PL.MISSION_ALLOWANCES.scale < PL.MISSION_ALLOWANCES.autonomous);
check('agency tiers rise with client count',
  PL.MISSION_ALLOWANCES.agency_starter < PL.MISSION_ALLOWANCES.agency_growth &&
  PL.MISSION_ALLOWANCES.agency_growth < PL.MISSION_ALLOWANCES.agency_pro);
check('enterprise tiers are uncapped, not guessed at',
  PL.MISSION_ALLOWANCES.enterprise === null &&
  PL.MISSION_ALLOWANCES.agency_enterprise === null);
// Confirmation is per plan rather than one global flag. All eight capped
// tiers are now signed off, but the set stays: it was what let the standard
// tiers be confirmed while the Agency figures were still guesses, and it is
// what keeps any tier added later provisional by default.
check('the standard tiers are confirmed',
  ['free', 'start', 'growth', 'scale', 'autonomous']
    .every(p => PL.isAllowanceConfirmed(p)));
check('and they are the exact numbers given',
  PL.MISSION_ALLOWANCES.free === 3 && PL.MISSION_ALLOWANCES.start === 20 &&
  PL.MISSION_ALLOWANCES.growth === 60 && PL.MISSION_ALLOWANCES.scale === 150 &&
  PL.MISSION_ALLOWANCES.autonomous === 500);
check('the agency tiers are confirmed too',
  PL.isAllowanceConfirmed('agency_starter') &&
  PL.isAllowanceConfirmed('agency_growth') &&
  PL.isAllowanceConfirmed('agency_pro'));
check('and are the exact numbers given',
  PL.MISSION_ALLOWANCES.agency_starter === 100 &&
  PL.MISSION_ALLOWANCES.agency_growth === 300 &&
  PL.MISSION_ALLOWANCES.agency_pro === 1000);
// The set is kept rather than collapsed back to "everything is confirmed":
// a tier added later must start provisional, which is the safe direction for
// a new plan to fail and is not something a boolean could express.
check('a tier added later would still default to provisional',
  !PL.isAllowanceConfirmed('agency_platinum'));
check('an uncapped plan is not called provisional — there is no number to confirm',
  PL.isAllowanceConfirmed('enterprise') && PL.isAllowanceConfirmed('agency_enterprise'));
check('an admin override makes an account\'s allowance settled',
  PL.isAllowanceConfirmed('agency_pro', 750));
check('an admin override beats the table', PL.missionAllowanceFor('start', 999) === 999);
check('an override of 0 is honoured, not treated as unset',
  PL.missionAllowanceFor('growth', 0) === 0);
check('an unknown plan falls back to free, not to unlimited',
  PL.missionAllowanceFor('nonsense_tier') === PL.MISSION_ALLOWANCES.free);
check('period is the UTC calendar month',
  PL.currentPeriod('2026-03-09T00:00:00Z') === '2026-03' &&
  PL.currentPeriod('2026-12-31T23:59:59Z') === '2026-12');

/* ── 2. The endpoint ────────────────────────────────────────────────────── */
console.log('\n──── the gate ────');

// Intercept the shared Supabase helper so no network is involved.
let state, calls;
const realResolve = Module._resolveFilename;
const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
require.cache[helperPath] = {
  id: helperPath, filename: helperPath, loaded: true,
  exports: {
    sbRest: async (url, key, method, p, body) => {
      calls.push({ method, path: p, body });
      if (p.startsWith('/profiles')) {
        return { ok: true, status: 200, data: [{ plan: state.plan, mission_limit: state.override }] };
      }
      if (p.startsWith('/mission_usage')) {
        return { ok: true, status: 200, data: state.used === 0 ? [] : [{ used: state.used }] };
      }
      if (p === '/rpc/increment_mission_usage') {
        if (state.incrementFails) return { ok: false, status: 500, data: 'boom' };
        state.used += 1;
        return { ok: true, status: 200, data: state.used };
      }
      return { ok: false, status: 404, data: null };
    },
  },
};

const handler = require(path.join(REPO, 'api/mission-usage.js'));

global.fetch = async (url) => {
  if (String(url).includes('/auth/v1/user')) {
    return state.validToken
      ? { ok: true, json: async () => ({ id: 'user-1', email: 'a@b.com' }) }
      : { ok: false, json: async () => ({}) };
  }
  throw new Error('unexpected fetch: ' + url);
};

async function call(body, env, opts) {
  opts = opts || {};
  const saved = { u: process.env.SUPABASE_URL, k: process.env.SUPABASE_SERVICE_ROLE_KEY };
  if (env === 'unconfigured') {
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  }
  calls = [];
  let status = 200, payload = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(o) { payload = o; return this; }, end() { return this; },
  };
  await handler({
    method: 'POST', headers: { authorization: opts.noAuth ? '' : 'Bearer tok' }, body,
  }, res);
  if (saved.u) process.env.SUPABASE_URL = saved.u; else delete process.env.SUPABASE_URL;
  if (saved.k) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.k; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { status, body: payload };
}

(async () => {
  // check() must not consume
  state = { plan: 'growth', used: 5, override: null, validToken: true };
  let r = await call({ action: 'check' });
  console.log('  check on growth:', JSON.stringify({ used: r.body.used, limit: r.body.limit, remaining: r.body.remaining }));
  check('check reports real usage against the plan',
    r.body.used === 5 && r.body.limit === PL.MISSION_ALLOWANCES.growth && r.body.allowed === true);
  check('check does NOT consume a mission',
    !calls.some(c => c.path === '/rpc/increment_mission_usage') && state.used === 5);

  // consume increments
  r = await call({ action: 'consume' });
  check('consume increments the counter', r.body.used === 6 && r.body.counted === true);
  check('and reports what is left', r.body.remaining === PL.MISSION_ALLOWANCES.growth - 6);
  check('the increment goes through the atomic RPC, not a read-then-write',
    calls.some(c => c.path === '/rpc/increment_mission_usage'));

  // exhausted
  state = { plan: 'start', used: PL.MISSION_ALLOWANCES.start, override: null, validToken: true };
  r = await call({ action: 'consume' });
  console.log('  exhausted:', r.status, '|', (r.body.message || '').slice(0, 70));
  check('an exhausted allowance is refused with 402', r.status === 402 && r.body.allowed === false);
  check('the refusal names the plan and the number', /Start/.test(r.body.message) && r.body.message.includes(String(PL.MISSION_ALLOWANCES.start)));
  check('and gives a route to upgrade', r.body.upgradeUrl === '/billing.html');
  check('a refused mission is not counted', state.used === PL.MISSION_ALLOWANCES.start);

  // uncapped
  state = { plan: 'enterprise', used: 9999, override: null, validToken: true };
  r = await call({ action: 'consume' });
  check('an uncapped plan is never blocked',
    r.status === 200 && r.body.allowed === true && r.body.uncapped === true && r.body.remaining === null);

  // admin override
  state = { plan: 'free', used: 5, override: 100, validToken: true };
  r = await call({ action: 'check' });
  check('an admin override raises the cap', r.body.limit === 100 && r.body.allowed === true);

  console.log('\n──── a broken meter must not block paying customers ────');

  state = { plan: 'growth', used: 0, override: null, validToken: true };
  r = await call({ action: 'consume' }, 'unconfigured');
  check('unconfigured metering allows the work and says it is not counting',
    r.status === 200 && r.body.allowed === true && r.body.metered === false && /not configured/i.test(r.body.reason));

  state = { plan: 'growth', used: 2, override: null, validToken: true, incrementFails: true };
  r = await call({ action: 'consume' });
  check('a failed increment still allows the mission',
    r.status === 200 && r.body.allowed === true && r.body.counted === false);
  check('and admits the count was not recorded', /could not be updated/i.test(r.body.reason));

  console.log('\n──── auth ────');
  state = { plan: 'growth', used: 0, override: null, validToken: true };
  r = await call({ action: 'consume' }, null, { noAuth: true });
  check('a request with no token is rejected', r.status === 401);

  state = { plan: 'growth', used: 0, override: null, validToken: false };
  r = await call({ action: 'consume' });
  check('an invalid token is rejected', r.status === 401);

  state = { plan: 'growth', used: 0, override: null, validToken: true };
  r = await call({ action: 'nonsense' });
  check('an unknown action is rejected rather than defaulting to consume',
    r.status === 400 && state.used === 0);

  console.log('\n──── the SQL keeps the count honest ────');
  const sql = require('fs').readFileSync(path.join(REPO, 'supabase-mission-usage.sql'), 'utf8');
  check('increment is a single atomic upsert', /ON CONFLICT[\s\S]*?DO UPDATE SET used = mission_usage\.used \+ 1/.test(sql));
  check('one row per account per month is enforced by a unique index',
    /CREATE UNIQUE INDEX[\s\S]*?mission_usage \(user_id, period\)/.test(sql));
  check('clients can read their own usage but never write it',
    /FOR SELECT USING \(auth\.uid\(\) = user_id\)/.test(sql) &&
    !/FOR (INSERT|UPDATE|ALL)[\s\S]*?ON mission_usage/.test(sql));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();
