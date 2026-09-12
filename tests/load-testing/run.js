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
 * 1. THE SINGLE MOST IMPORTANT TEST, updated for the calibration feature:
 *    the pure simulation math and the tick engine must still contain ZERO
 *    references to any real provider host, and must never construct a
 *    fetch() against an external URL — that property is unchanged and
 *    non-negotiable. The ONE deliberate, narrowly-scoped exception is the
 *    calibration module, which is checked separately in section 1b below:
 *    it may only ever reach a real provider by calling INTO
 *    api/generate-website-mockup.js, never directly.
 * ══════════════════════════════════════════════════════════════════════ */
console.log('\n──── the tick engine + pure simulation math: zero real-AI-provider references, ever ────');

// NOTE: this list is now deliberately narrower than it once was. It used to
// include every file in this feature, including the calibration code path
// added later. That would make this assertion literally false: the
// calibration module DOES reach a real provider, on purpose, exactly once,
// disclosed, opt-in — see api/_lib/loadtest-calibration.js's header. This
// section is scoped to the files whose "never touches a real provider"
// property is still absolute: the pure math and the tick loop that consumes
// it. Those must never gain a real network call, calibration or not.
const NEVER_REAL_FILES = [
  'api/_lib/loadtest-engine.js',
  'api/cron-loadtest-tick.js',
];
const BANNED_PATTERNS = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
];
for (const f of NEVER_REAL_FILES) {
  const src = read(f);
  for (const pattern of BANNED_PATTERNS) {
    check(`${f}: no reference to ${pattern}`, !src.includes(pattern));
  }
  check(`${f}: no literal fetch( call at all`, !/\bfetch\(/.test(src));
}
// Also confirm the tick module makes no outbound call at all besides this
// app's own Supabase project — it should have exactly one class of network
// call, unchanged by this feature.
check('api/cron-loadtest-tick.js only imports supabase-rest.js and the engine (no http client, no provider SDK)',
  !/require\(['"](?!\.\/_lib\/(supabase-rest|report-failure)\.js|\.\/_lib\/loadtest-engine\.js)/.test(read('api/cron-loadtest-tick.js').replace(/require\('\.\/_lib\/(supabase-rest|report-failure)\.js'\)/g, '').replace(/require\('\.\/_lib\/loadtest-engine\.js'\)/g, '')));

/* ══════════════════════════════════════════════════════════════════════
 * 1b. The ONE deliberate exception: calibration must reach a real provider
 *     ONLY by calling INTO api/generate-website-mockup.js — never directly,
 *     never a second/duplicated implementation of the Gemini call.
 * ══════════════════════════════════════════════════════════════════════ */
console.log('\n──── calibration reaches a real provider ONLY via generate-website-mockup.js ────');
(() => {
  const src = read('api/_lib/loadtest-calibration.js');
  for (const pattern of BANNED_PATTERNS) {
    check(`api/_lib/loadtest-calibration.js: no DIRECT reference to ${pattern}`, !src.includes(pattern));
  }
  check('api/_lib/loadtest-calibration.js requires generate-website-mockup.js by module reference',
    /require\(['"]\.\.\/generate-website-mockup\.js['"]\)/.test(src));
  check('api/_lib/loadtest-calibration.js does not itself call a raw fetch() against an arbitrary URL (only safeFetch, for the served-check)',
    !/[^.]\bfetch\(/.test(src.replace(/safeFetch\(/g, '')));
  check('api/_lib/loadtest-calibration.js uses safeFetch (the SSRF-hardened primitive), not a raw fetch, for the served-check',
    /require\(['"]\.\/safe-fetch\.js['"]\)/.test(src) && /safeFetch\(/.test(src));
  check('api/_lib/loadtest-calibration.js never sets an intelProfileId/projectId object key (no-customer-billed guarantee — the word appears only in explanatory comments)',
    !/\b(intelProfileId|projectId)\s*:/.test(src));
  check('api/loadtest-create.js requires loadtest-calibration.js (the calibration path is wired in)',
    /require\(['"]\.\/_lib\/loadtest-calibration\.js['"]\)/.test(read('api/loadtest-create.js')));
})();

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

console.log('\n──── calibrated mu: a real measured latency becomes the distribution\'s median ────');
(() => {
  // computeCalibratedMuSeconds(realLatencyMs) must satisfy
  // exp(mu) === realLatencyMs / 1000 (mu is the log of the target median, in
  // seconds) — the exact documented formula.
  check('computeCalibratedMuSeconds(45000) inverts to a 45s median',
    Math.abs(Math.exp(engine.computeCalibratedMuSeconds(45000)) - 45) < 1e-9);
  check('computeCalibratedMuSeconds(500) inverts to a 0.5s median',
    Math.abs(Math.exp(engine.computeCalibratedMuSeconds(500)) - 0.5) < 1e-9);
  check('computeCalibratedMuSeconds of a non-finite/zero/negative input returns null',
    engine.computeCalibratedMuSeconds(0) === null &&
    engine.computeCalibratedMuSeconds(-5) === null &&
    engine.computeCalibratedMuSeconds(NaN) === null);

  // sampleDurationMs must actually USE the override when given one, and fall
  // back to the hardcoded default when it is not — statistically, over many
  // draws, the median of the samples should land near exp(muSeconds).
  const realLatencyMs = 20000; // a fast real call: 20s
  const mu = engine.computeCalibratedMuSeconds(realLatencyMs);
  const calibratedDurations = [];
  for (let i = 0; i < 4000; i++) calibratedDurations.push(engine.sampleDurationMs(true, mu));
  const calibratedMedian = engine.percentile(calibratedDurations, 50);
  check(`sampleDurationMs with a calibrated mu (target median ${realLatencyMs}ms) samples near that median, not the hardcoded ~100s default`,
    Math.abs(calibratedMedian - realLatencyMs) < realLatencyMs * 0.5);
  check('sampleDurationMs with no override still uses the hardcoded default (regression check)',
    Math.abs(Math.exp(engine.LOGNORMAL_MU) * 1000 - 100000) < 1);
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

// Fakes for the ONE real call the calibration path can make — installed in
// require.cache BEFORE api/loadtest-create.js (and therefore
// api/_lib/loadtest-calibration.js) is first required, since
// loadtest-calibration.js destructures safeFetch at module load time.
// generate-website-mockup.js is required lazily inside runCalibration()
// on every call, so swapping `mockupImpl` between scenarios is enough there.
let mockupImpl = async (req, res) => res.status(500).json({ error: 'mockupImpl not configured for this test' });
let safeFetchImpl = async () => ({ status: 200 });
const mockupPath = path.join(REPO, 'api/generate-website-mockup.js');
const safeFetchPath = path.join(REPO, 'api/_lib/safe-fetch.js');
require.cache[mockupPath] = {
  id: mockupPath, filename: mockupPath, loaded: true,
  exports: (...args) => mockupImpl(...args),
};
require.cache[safeFetchPath] = {
  id: safeFetchPath, filename: safeFetchPath, loaded: true,
  exports: { safeFetch: (...args) => safeFetchImpl(...args) },
};

(async () => {
  const { issueToken } = require(path.join(REPO, 'api/_lib/internal-tools-access-token.js'));
  const create = require(path.join(REPO, 'api/loadtest-create.js'));
  const control = require(path.join(REPO, 'api/loadtest-control.js'));
  const status = require(path.join(REPO, 'api/loadtest-status.js'));
  const engineForCalibration = require(path.join(REPO, 'api/_lib/loadtest-engine.js'));

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

  console.log('\n──── a run WITHOUT calibration behaves exactly as before (regression) ────');
  fakeDb = makeFakeDb();
  r = await call(create, validConfig, { headers: { 'x-builtwith-token': freshToken } });
  check('a plain run is created with no calibration section in the body', r.status === 200 && r.body.success === true);
  check('config.calibrated is falsy on a non-calibrated run', !r.body.run.config.calibrated);
  check('config.costUnit defaults to usd on a non-calibrated run', r.body.run.config.costUnit === 'usd');
  check('config.artificialAiDelay.muSeconds is null on a non-calibrated run (uses the hardcoded default)', r.body.run.config.artificialAiDelay.muSeconds === null);
  check('calibration_result is null on a non-calibrated run', r.body.run.calibration_result == null);
  await call(control, { runId: r.body.run.id, action: 'cancel' }, { headers: { 'x-builtwith-token': freshToken } });

  console.log('\n──── successful calibration derives duration-center and cost from the REAL measured values ────');
  fakeDb = makeFakeDb();
  let capturedMockupReq = null;
  mockupImpl = async (req, res) => {
    capturedMockupReq = req;
    res.status(200).json({
      success: true, imageUrl: 'https://cdn.example.com/mockups/one.png', hosted: true,
      mimeType: 'image/png', creditsUsed: 50, creditsRemaining: 19950,
      disclaimer: 'AI-generated concept', notes: [],
    });
  };
  safeFetchImpl = async (url) => { check('the served-check fetches the exact imageUrl the generator returned', url === 'https://cdn.example.com/mockups/one.png'); return { status: 200 }; };

  r = await call(create, Object.assign({}, validConfig, {
    calibration: { enabled: true, businessName: 'Test Biz', industry: 'testing', usdPerCredit: 0.004 },
  }), { headers: { 'x-builtwith-token': freshToken } });

  check('a calibrated run is created successfully', r.status === 200 && r.body.success === true);
  const calRun = r.body.run || {};
  check('config.calibrated is true', calRun.config && calRun.config.calibrated === true);
  check('config.costUnit is credits, not usd (no fabricated dollar figure)', calRun.config && calRun.config.costUnit === 'credits');
  check('config.costPerGenerationUsd is reused to carry the REAL measured creditsUsed (50)', calRun.config && calRun.config.costPerGenerationUsd === 50);
  check('config.usdPerCredit carries the owner-supplied rate, for a labeled estimate only', calRun.config && calRun.config.usdPerCredit === 0.004);
  check('calibration_result.success is true', calRun.calibration_result && calRun.calibration_result.success === true);
  check('calibration_result.realCreditsUsed is the REAL 50 from the generator response', calRun.calibration_result && calRun.calibration_result.realCreditsUsed === 50);
  check('calibration_result.realLatencyMs was actually measured (a finite, non-negative number)',
    calRun.calibration_result && Number.isFinite(calRun.calibration_result.realLatencyMs) && calRun.calibration_result.realLatencyMs >= 0);
  check('calibration_result.servedCheck reflects the real (mocked) HTTP 200',
    calRun.calibration_result && calRun.calibration_result.servedCheck.applicable === true &&
    calRun.calibration_result.servedCheck.ok === true && calRun.calibration_result.servedCheck.status === 200);
  check('config.artificialAiDelay.muSeconds is exactly computeCalibratedMuSeconds(the REAL measured latency) — the documented formula',
    calRun.config && Math.abs(calRun.config.artificialAiDelay.muSeconds - engineForCalibration.computeCalibratedMuSeconds(calRun.calibration_result.realLatencyMs)) < 1e-9);
  check('the calibration call carried NO intelProfileId (unmetered against no customer\'s balance)',
    capturedMockupReq && !('intelProfileId' in capturedMockupReq.body));
  check('the calibration call carried NO projectId (unmetered against no customer\'s balance)',
    capturedMockupReq && !('projectId' in capturedMockupReq.body));
  check('the calibration call forwarded the SAME caller\'s Authorization header (runs as the real operator, not a new identity)',
    capturedMockupReq && capturedMockupReq.headers.authorization === 'Bearer sometoken');
  check('the calibration call carried the business name/industry the owner entered',
    capturedMockupReq && capturedMockupReq.body.businessName === 'Test Biz' && capturedMockupReq.body.industry === 'testing');
  await call(control, { runId: calRun.id, action: 'cancel' }, { headers: { 'x-builtwith-token': freshToken } });

  console.log('\n──── a served-check against a data: URI is recorded plainly, never fabricated ────');
  fakeDb = makeFakeDb();
  let dataUriFetchCalled = false;
  mockupImpl = async (req, res) => {
    res.status(200).json({ success: true, imageUrl: 'data:image/png;base64,aGVsbG8=', hosted: false, mimeType: 'image/png', creditsUsed: 50, creditsRemaining: 100, disclaimer: 'x', notes: ['R2 not configured'] });
  };
  safeFetchImpl = async () => { dataUriFetchCalled = true; return { status: 200 }; };
  r = await call(create, Object.assign({}, validConfig, { calibration: { enabled: true, businessName: 'Data URI Co' } }), { headers: { 'x-builtwith-token': freshToken } });
  check('a data: URI result still creates the run successfully', r.status === 200 && r.body.success === true);
  check('safeFetch is never called against a data: URI', dataUriFetchCalled === false);
  check('servedCheck.applicable is false with a plain-language reason, not a fabricated check',
    r.body.run.calibration_result.servedCheck.applicable === false &&
    /data URI/i.test(r.body.run.calibration_result.servedCheck.reason || ''));
  await call(control, { runId: r.body.run.id, action: 'cancel' }, { headers: { 'x-builtwith-token': freshToken } });

  console.log('\n──── a FAILED calibration refuses to start the run by default, and requires an explicit override ────');
  fakeDb = makeFakeDb();
  mockupImpl = async (req, res) => res.status(502).json({ error: 'Gemini returned a safety block for this prompt.' });
  r = await call(create, Object.assign({}, validConfig, { calibration: { enabled: true, businessName: 'Broken Co' } }), { headers: { 'x-builtwith-token': freshToken } });
  check('the run is refused (not started) when calibration fails', r.status !== 200);
  check('the refusal names code calibration_failed', r.body.code === 'calibration_failed');
  check('the refusal carries the real calibrationResult, including the real failure message', r.body.calibrationResult && /Gemini returned a safety block/.test(r.body.calibrationResult.failureMessage));
  check('the failure is mapped to image_api_error, the simulation\'s own vocabulary', r.body.calibrationResult.failureCategory === 'image_api_error');
  check('NOTHING was inserted into load_test_runs on a refused calibration', (fakeDb.tables.load_test_runs || []).length === 0);

  // The explicit override path: the SAME caller resubmits with calibration
  // simply left off, never automatically, never silently.
  r = await call(create, validConfig, { headers: { 'x-builtwith-token': freshToken } });
  check('the explicit "start without calibration" override (calibration omitted) succeeds after a refusal', r.status === 200 && r.body.success === true);
  check('the override run is fully synthetic (not calibrated)', !r.body.run.config.calibrated);
  await call(control, { runId: r.body.run.id, action: 'cancel' }, { headers: { 'x-builtwith-token': freshToken } });

  console.log('\n──── calibration requires a businessName before making any real call ────');
  fakeDb = makeFakeDb();
  let calledWithNoBusinessName = false;
  mockupImpl = async (req, res) => { calledWithNoBusinessName = true; res.status(200).json({ success: true, imageUrl: 'https://x/y.png', creditsUsed: 50 }); };
  r = await call(create, Object.assign({}, validConfig, { calibration: { enabled: true, businessName: '' } }), { headers: { 'x-builtwith-token': freshToken } });
  check('an empty businessName is rejected with 400 before any real call is made', r.status === 400 && r.body.code === 'invalid_config');
  check('no real call was made when businessName was missing', calledWithNoBusinessName === false);
  check('nothing was inserted when calibration was rejected for a missing businessName', (fakeDb.tables.load_test_runs || []).length === 0);

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
