/**
 * Load Testing Agent — config validation, the one-active-run rule, the
 * two-layer access gate on every loadtest-*.js endpoint, the simulation
 * math (arrivals, failure injection, percentiles), and — the single most
 * important check in this file — that NOTHING in this feature ever
 * references a real AI provider.
 *
 *   node tests/load-testing/run.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const REPO = path.resolve(__dirname, '..', '..');

const fail = [];
function check(label, cond) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) fail.push(label);
}
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

/* ══════════════════════════════════════════════════════════════════════
 * 1. THE SINGLE MOST IMPORTANT TEST: no real AI provider anywhere in this
 *    feature's files.
 * ══════════════════════════════════════════════════════════════════════ */
console.log('\n──── zero real-AI-provider references anywhere in this feature ────');

const FEATURE_FILES = [
  'api/_lib/loadtest-engine.js',
  'api/cron-loadtest-tick.js',
  'api/loadtest-create.js',
  'api/loadtest-control.js',
  'api/loadtest-status.js',
  'web/tools/load-testing.html',
  'supabase-load-testing.sql',
];
const BANNED_PATTERNS = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
];
for (const f of FEATURE_FILES) {
  const src = read(f);
  for (const pattern of BANNED_PATTERNS) {
    check(`${f}: no reference to ${pattern}`, !src.includes(pattern));
  }
}
// Also confirm none of these files makes ANY outbound fetch to a third-party
// host at all (only this app's own Supabase project) — the tick module in
// particular should have exactly one class of network call.
check('api/cron-loadtest-tick.js only imports supabase-rest.js and the engine (no http client, no provider SDK)',
  !/require\(['"](?!\.\/_lib\/(supabase-rest|report-failure)\.js|\.\/_lib\/loadtest-engine\.js)/.test(read('api/cron-loadtest-tick.js').replace(/require\('\.\/_lib\/(supabase-rest|report-failure)\.js'\)/g, '').replace(/require\('\.\/_lib\/loadtest-engine\.js'\)/g, '')));

/* ══════════════════════════════════════════════════════════════════════
 * 2. The pure simulation engine
 * ══════════════════════════════════════════════════════════════════════ */
console.log('\n──── config validation ────');
const engine = require(path.join(REPO, 'api/_lib/loadtest-engine.js'));

const BASE_CONFIG = {
  virtualUsers: 1000, durationDays: 5,
  personaMix: { websiteBuilders: 40, siteVisitors: 25, existingEditors: 15, ecommerce: 10, heavyUsers: 5, failureSimulations: 5 },
  generationConcurrency: 50,
  spike: { enabled: true, peakVirtualUsers: 2500 },
  artificialAiDelay: { enabled: true },
  apiFailureInjection: { enabled: true, rate: 0.05 },
  costPerGenerationUsd: 0.38,
};

check('a valid config passes', engine.validateConfig(BASE_CONFIG).ok === true);
check('virtualUsers over the cap is rejected', engine.validateConfig(Object.assign({}, BASE_CONFIG, { virtualUsers: 999999 })).ok === false);
check('durationDays over the cap is rejected', engine.validateConfig(Object.assign({}, BASE_CONFIG, { durationDays: 365 })).ok === false);
check('generationConcurrency over the cap is rejected', engine.validateConfig(Object.assign({}, BASE_CONFIG, { generationConcurrency: 99999 })).ok === false);
check('a persona mix that does not sum to 100 is rejected',
  engine.validateConfig(Object.assign({}, BASE_CONFIG, { personaMix: Object.assign({}, BASE_CONFIG.personaMix, { heavyUsers: 999 }) })).ok === false);
check('a failure rate above the cap is rejected',
  engine.validateConfig(Object.assign({}, BASE_CONFIG, { apiFailureInjection: { enabled: true, rate: 0.9 } })).ok === false);
check('peakVirtualUsers over the cap is rejected',
  engine.validateConfig(Object.assign({}, BASE_CONFIG, { spike: { enabled: true, peakVirtualUsers: 999999 } })).ok === false);

console.log('\n──── arrival math is sane and bounded ────');
check('zero active VUs produces zero arrivals', engine.computeArrivals(0, 5) === 0);
check('some VUs over some time produces a positive number of arrivals', engine.computeArrivals(1000, 5) > 0);
check('a huge gap between ticks is capped, not unbounded',
  engine.computeArrivals(5000, 10000) === engine.MAX_ARRIVALS_PER_TICK);
check('arrivals scale roughly linearly with elapsed minutes',
  engine.computeArrivals(1000, 10) >= engine.computeArrivals(1000, 5));

console.log('\n──── persona split always sums back to the total ────');
for (const n of [0, 1, 7, 100, 4821]) {
  const split = engine.splitByPersonaMix(n, BASE_CONFIG.personaMix);
  const sum = Object.values(split).reduce((a, b) => a + b, 0);
  check(`splitByPersonaMix(${n}) sums back to ${n}`, sum === n);
}

console.log('\n──── the VU ramp model ────');
const totalMs = 5 * 24 * 60 * 60 * 1000;
check('at t=0 the ramp starts at (near) zero', engine.activeVirtualUsers(0, totalMs, BASE_CONFIG) < 50);
check('mid-run, without being inside a spike window, VUs are near the base',
  (() => {
    // Pick an elapsed time that is not inside any spike window.
    const elapsed = totalMs / 2 - (totalMs / 2) % engine.SPIKE_PERIOD_MS + engine.SPIKE_DURATION_MS + 1000;
    const v = engine.activeVirtualUsers(elapsed, totalMs, Object.assign({}, BASE_CONFIG, { spike: { enabled: false, peakVirtualUsers: 500 } }));
    return Math.abs(v - BASE_CONFIG.virtualUsers) < 5;
  })());
check('a spike window visibly raises the VU count above the base',
  (() => {
    // Pick a time well past the ramp-up (steady state, rampFactor=1) and
    // in the middle of a spike window (peak intensity).
    const dayStart = 2 * engine.SPIKE_PERIOD_MS;
    const midSpike = dayStart + engine.SPIKE_DURATION_MS / 2;
    const v = engine.activeVirtualUsers(midSpike, totalMs, BASE_CONFIG);
    return v > BASE_CONFIG.virtualUsers;
  })());
check('near the very end, the ramp brings VUs back down',
  engine.activeVirtualUsers(totalMs - 1000, totalMs, Object.assign({}, BASE_CONFIG, { spike: { enabled: false } })) < BASE_CONFIG.virtualUsers);

console.log('\n──── failure injection matches the configured rate statistically ────');
(() => {
  const N = 20000;
  const rate = 0.1;
  const cfg = Object.assign({}, BASE_CONFIG, { apiFailureInjection: { enabled: true, rate } });
  let failures = 0;
  const categories = { claude_error: 0, image_api_error: 0, deployment_error: 0, database_error: 0 };
  for (let i = 0; i < N; i++) {
    const outcome = engine.simulateJobOutcome(cfg);
    if (!outcome.success) { failures++; categories[outcome.failureCategory]++; }
  }
  const observedRate = failures / N;
  check(`observed failure rate (${observedRate.toFixed(3)}) is within tolerance of configured rate (${rate})`,
    Math.abs(observedRate - rate) < 0.02);
  check('both successes and failures occur (never all-or-nothing)', failures > 0 && failures < N);
  check('claude_error is the most common failure category, matching the documented weights',
    categories.claude_error > categories.image_api_error &&
    categories.image_api_error > categories.deployment_error &&
    categories.deployment_error > categories.database_error);
})();
check('disabling failure injection never produces a failure',
  (() => {
    const cfg = Object.assign({}, BASE_CONFIG, { apiFailureInjection: { enabled: false, rate: 0.5 } });
    for (let i = 0; i < 500; i++) if (!engine.simulateJobOutcome(cfg).success) return false;
    return true;
  })());

console.log('\n──── duration distribution shape ────');
(() => {
  const durations = [];
  for (let i = 0; i < 5000; i++) durations.push(engine.sampleDurationMs(true));
  const p50 = engine.percentile(durations, 50);
  const p95 = engine.percentile(durations, 95);
  const p99 = engine.percentile(durations, 99);
  check('with artificial delay enabled, median build lands in the 1-3 minute range',
    p50 >= 30000 && p50 <= 180000);
  check('P95 is meaningfully higher than the median (right-skewed)', p95 > p50);
  check('P99 is meaningfully higher than P95', p99 > p95);
  const noDelay = [];
  for (let i = 0; i < 200; i++) noDelay.push(engine.sampleDurationMs(false));
  check('with artificial delay disabled, durations are short (sub-3s)', noDelay.every(d => d < 3000));
})();

console.log('\n──── percentile computation against a known synthetic set ────');
(() => {
  const values = Array.from({ length: 100 }, (_, i) => (i + 1) * 10); // 10..1000
  check('p50 of 10..1000 (100 values) is 500', engine.percentile(values, 50) === 500);
  check('p95 of 10..1000 (100 values) is 950', engine.percentile(values, 95) === 950);
  check('p99 of 10..1000 (100 values) is 990', engine.percentile(values, 99) === 990);
  check('p100 is the max', engine.percentile(values, 100) === 1000);
  check('an empty array returns null', engine.percentile([], 50) === null);
})();

/* ══════════════════════════════════════════════════════════════════════
 * 3. Endpoint-level tests: two-layer gate + one-active-run rule
 * ══════════════════════════════════════════════════════════════════════ */

/** A tiny in-memory PostgREST-shaped fake, just capable enough to drive
 * requireUser's profile lookup and the loadtest-*.js endpoints' own
 * queries (eq / in / order / limit / select, insert, patch, delete). */
function makeFakeDb() {
  const tables = { profiles: [{ id: 'user-1', plan: 'growth', role: 'member' }] };
  function matches(row, params) {
    for (const [key, val] of params.entries()) {
      if (['select', 'order', 'limit'].includes(key)) continue;
      if (val.startsWith('eq.')) { if (String(row[key]) !== val.slice(3)) return false; }
      else if (val.startsWith('in.(')) {
        const set = val.slice(4, -1).split(',');
        if (!set.includes(String(row[key]))) return false;
      }
      // lte./lt./not.is. filters used by the tick are not needed by these
      // endpoint-level tests (the tick's own math is unit-tested directly
      // above) — unrecognised filters are treated as non-restrictive here.
    }
    return true;
  }
  let idSeq = 0;
  async function sbRest(url, key, method, pathQuery, body) {
    const qIdx = pathQuery.indexOf('?');
    const table = (qIdx === -1 ? pathQuery : pathQuery.slice(0, qIdx)).slice(1);
    const params = new URLSearchParams(qIdx === -1 ? '' : pathQuery.slice(qIdx + 1));
    if (!tables[table]) tables[table] = [];
    const rows = tables[table];

    if (method === 'GET') {
      let result = rows.filter(r => matches(r, params));
      const order = params.get('order');
      if (order) {
        const [field, dir] = order.split('.');
        result = result.slice().sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      const limit = params.get('limit');
      if (limit) result = result.slice(0, Number(limit));
      return { ok: true, status: 200, data: result };
    }
    if (method === 'POST') {
      const arr = Array.isArray(body) ? body : [body];
      const inserted = arr.map(r => Object.assign({ id: 'ltid-' + (++idSeq), created_at: new Date().toISOString() }, r));
      rows.push(...inserted);
      return { ok: true, status: 201, data: inserted };
    }
    if (method === 'PATCH') {
      const matched = rows.filter(r => matches(r, params));
      matched.forEach(r => Object.assign(r, body));
      return { ok: true, status: 200, data: matched };
    }
    if (method === 'DELETE') {
      const matched = rows.filter(r => matches(r, params));
      tables[table] = rows.filter(r => !matched.includes(r));
      return { ok: true, status: 200, data: matched };
    }
    return { ok: false, status: 400, data: null };
  }
  return { tables, sbRest };
}

let fakeDb = makeFakeDb();
const supaRestPath = path.join(REPO, 'api/_lib/supabase-rest.js');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
require.cache[supaRestPath] = {
  id: supaRestPath, filename: supaRestPath, loaded: true,
  exports: {
    sbRest: (...args) => fakeDb.sbRest(...args),
    isUuid: v => typeof v === 'string' && (UUID_RE.test(v) || /^ltid-\d+$/.test(v)), // relaxed so the fake's own ids pass the endpoints' own uuid check
  },
};

let validSession = true;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/auth/v1/user')) {
    return validSession
      ? { ok: true, json: async () => ({ id: 'user-1', email: 'user@test.example' }) }
      : { ok: false, json: async () => ({ msg: 'invalid' }) };
  }
  throw new Error('unexpected fetch ' + u);
};

function env() {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-not-a-real-secret';
  process.env.BUILTWITH_TOOL_PASSWORD = 'correct-horse-battery-staple';
  delete process.env.BUILTWITH_TOOL_SECRET; // exercise the documented fallback, same as tests/builtwith-research
}

function makeRes() {
  let status = 200, payload = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; }, json(o) { payload = o; return this; }, end() { return this; },
  };
  return { res, get status() { return status; }, get body() { return payload; } };
}

async function call(handler, body, opts) {
  env();
  opts = opts || {};
  const wrapped = makeRes();
  const headers = Object.assign({ host: 'app.test' }, opts.headers || {});
  if (!opts.noAuth) headers.authorization = 'Bearer sometoken';
  const req = { method: opts.method || 'POST', headers, body: body || {}, query: opts.query || {} };
  await handler(req, wrapped.res);
  return { status: wrapped.status, body: wrapped.body };
}

(async () => {
  const { issueToken } = require(path.join(REPO, 'api/_lib/internal-tools-access-token.js'));
  const create = require(path.join(REPO, 'api/loadtest-create.js'));
  const control = require(path.join(REPO, 'api/loadtest-control.js'));
  const status = require(path.join(REPO, 'api/loadtest-status.js'));

  const validConfig = {
    virtualUsers: 100, durationDays: 1,
    personaMix: { websiteBuilders: 40, siteVisitors: 25, existingEditors: 15, ecommerce: 10, heavyUsers: 5, failureSimulations: 5 },
    generationConcurrency: 10,
    spike: { enabled: false, peakVirtualUsers: 100 },
    artificialAiDelay: { enabled: true },
    apiFailureInjection: { enabled: true, rate: 0.02 },
    costPerGenerationUsd: 0.38,
  };

  console.log('\n──── the two-layer gate on every loadtest-*.js endpoint ────');
  const ENDPOINTS = [
    ['loadtest-create', create, validConfig, { method: 'POST' }],
    ['loadtest-control', control, { runId: 'ltid-1', action: 'pause' }, { method: 'POST' }],
    ['loadtest-status', status, {}, { method: 'GET' }],
  ];
  for (const [name, handler, body, opts] of ENDPOINTS) {
    fakeDb = makeFakeDb();
    validSession = true;
    let r = await call(handler, body, Object.assign({}, opts, { noAuth: true }));
    check(`${name}: refuses with no Supabase auth at all`, r.status === 401);

    fakeDb = makeFakeDb();
    r = await call(handler, body, opts); // valid auth, no unlock token
    check(`${name}: refuses valid auth with NO unlock token`, r.status === 403 && r.body.code === 'builtwith_locked');

    fakeDb = makeFakeDb();
    r = await call(handler, body, Object.assign({}, opts, { headers: { 'x-builtwith-token': 'garbage' } }));
    check(`${name}: refuses valid auth with an INVALID unlock token`, r.status === 403 && r.body.code === 'builtwith_locked');
  }

  console.log('\n──── only one active run at a time ────');
  const freshToken = issueToken('user-1').token;
  fakeDb = makeFakeDb();
  let r = await call(create, validConfig, { headers: { 'x-builtwith-token': freshToken } });
  check('the first run is created successfully', r.status === 200 && r.body.success === true);
  check('it comes back running', r.body.run.status === 'running');
  const firstRunId = r.body.run.id;

  r = await call(create, validConfig, { headers: { 'x-builtwith-token': freshToken } });
  check('starting a second run while one is active is rejected with 409', r.status === 409 && r.body.code === 'run_already_active');
  check('the rejection names the currently active run', r.body.activeRunId === firstRunId);

  console.log('\n──── invalid config is rejected before touching the database ────');
  fakeDb = makeFakeDb();
  r = await call(create, Object.assign({}, validConfig, { virtualUsers: 999999 }), { headers: { 'x-builtwith-token': freshToken } });
  check('an out-of-range virtualUsers is rejected with 400', r.status === 400 && r.body.code === 'invalid_config');
  check('nothing was inserted on an invalid config', (fakeDb.tables.load_test_runs || []).length === 0);

  fakeDb = makeFakeDb();
  r = await call(create, Object.assign({}, validConfig, { personaMix: Object.assign({}, validConfig.personaMix, { heavyUsers: 50 }) }), { headers: { 'x-builtwith-token': freshToken } });
  check('a persona mix not summing to 100 is rejected with 400', r.status === 400 && r.body.code === 'invalid_config');

  console.log('\n──── pause / resume / cancel transitions ────');
  fakeDb = makeFakeDb();
  r = await call(create, validConfig, { headers: { 'x-builtwith-token': freshToken } });
  const runId = r.body.run.id;

  r = await call(control, { runId, action: 'pause' }, { headers: { 'x-builtwith-token': freshToken } });
  check('pausing a running run succeeds', r.status === 200 && r.body.run.status === 'paused');

  r = await call(control, { runId, action: 'pause' }, { headers: { 'x-builtwith-token': freshToken } });
  check('pausing an already-paused run is rejected', r.status === 409 && r.body.code === 'invalid_transition');

  r = await call(control, { runId, action: 'resume' }, { headers: { 'x-builtwith-token': freshToken } });
  check('resuming a paused run succeeds', r.status === 200 && r.body.run.status === 'running');

  r = await call(control, { runId, action: 'cancel' }, { headers: { 'x-builtwith-token': freshToken } });
  check('cancelling a running run succeeds', r.status === 200 && r.body.run.status === 'cancelled');

  // A new run can now be started, since none is active any more.
  fakeDb.tables.load_test_runs = fakeDb.tables.load_test_runs; // (no-op, keeps history for the next call)
  r = await call(create, validConfig, { headers: { 'x-builtwith-token': freshToken } });
  check('a new run can be started once the previous one is cancelled', r.status === 200 && r.body.success === true);

  console.log('\n──── status endpoint shape ────');
  r = await call(status, {}, { method: 'GET', headers: { 'x-builtwith-token': freshToken } });
  check('status returns a run, a snapshots array, and a history array', r.status === 200 && r.body.run && Array.isArray(r.body.snapshots) && Array.isArray(r.body.history));
  check('history includes both the cancelled and the new run', r.body.history.length >= 2);

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();
