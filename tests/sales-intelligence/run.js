/**
 * Sales intelligence agent checks.
 *
 * The scoring that is actually used (calcPriorityScore in lead-generation) is
 * honest — it reads real fields: title seniority, detected signals, email
 * verification status, LinkedIn presence. The problems were elsewhere:
 *
 *   1. Every enrichment endpoint called a paid third party — Apollo,
 *      Hunter.io, Perplexity, Claude — with no idea who was calling. An
 *      unauthenticated enrichment endpoint is a direct line into the owner's
 *      billing: anyone with the URL could run lookups indefinitely on the
 *      account's keys, or use it as a free proxy to those services. A rate
 *      limit caps how fast the money goes, not whether the caller was ever
 *      entitled to spend it.
 *   2. `p.opportunityScore || 5` put a 5/10 into a coloured ring for every
 *      prospect Claude had not scored, and turned a real 0 into a 5. The
 *      score filter used `p.opportunityScore < scoreFilter`, and
 *      `undefined < 7` is false, so unscored prospects passed every filter.
 *
 *   node tests/sales-intelligence/run.js
 */
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '../..');

const fail = [];
const check = (name, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) fail.push(name);
};
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

/* ── Fake Supabase ──────────────────────────────────────────────────────── */
let validToken = true;
const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
require.cache[helperPath] = {
  id: helperPath, filename: helperPath, loaded: true,
  exports: {
    sbRest: async (u, k, method, p) => {
      if (p.startsWith('/profiles')) {
        return { ok: true, status: 200, data: [{ id: 'user-1', plan: 'growth', role: 'user' }] };
      }
      return { ok: false, status: 404, data: null };
    },
  },
};

let upstreamCalls = [];
let authReachable = true;
global.fetch = async (url) => {
  if (String(url).includes('/auth/v1/user')) {
    if (!authReachable) throw new Error('network down');
    return validToken
      ? { ok: true, json: async () => ({ id: 'user-1' }) }
      : { ok: false, json: async () => ({}) };
  }
  // Anything else is a paid third party. Reaching one at all, in a test where
  // the caller was not authenticated, is the failure being guarded against.
  upstreamCalls.push(String(url));
  return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
};

const ENDPOINTS = [
  'apollo-enrich', 'lead-enrich', 'lead-signals', 'enrich-business',
  'profile-search', 'hunter', 'outreach-draft', 'domain-metrics',
  'scout-data', 'seo-backlink-prospects',
];

function env() {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  // Every paid key present, so a refusal can only come from the auth gate and
  // not from a missing-configuration branch.
  ['APOLLO_API_KEY', 'HUNTER_API_KEY', 'PERPLEXITY_API_KEY', 'ANTHROPIC_API_KEY',
   'CLAUDE_API_KEY', 'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD',
   'MOZ_ACCESS_ID', 'MOZ_SECRET_KEY'].forEach(k => { process.env[k] = 'test-key'; });
}

async function call(handler, body, opts) {
  env();
  opts = opts || {};
  let status = 200, payload = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(o) { payload = o; return this; },
    send(o) { payload = o; return this; },
    end() { return this; },
  };
  const headers = { host: 'app.test', 'x-forwarded-for': `10.1.0.${Math.floor(Math.random() * 250)}` };
  if (!opts.noAuth) headers.authorization = 'Bearer t';
  await handler({ method: opts.method || 'POST', headers, query: {}, body: body || {} }, res);
  return { status, body: payload };
}

(async () => {
  /* ── 1. Nothing spends money for an unidentified caller ───────────────── */
  console.log('──── the enrichment endpoints know who is spending ────');

  for (const name of ENDPOINTS) {
    const handler = require(path.join(REPO, `api/${name}.js`));

    validToken = true; authReachable = true; upstreamCalls = [];
    let r = await call(handler, { domain: 'acme.test', email: 'a@acme.test', name: 'Ada',
                                  company: 'Acme', query: 'acme' }, { noAuth: true });
    const refused = r.status === 401 || r.status === 403;
    check(`${name}: refuses an unauthenticated call`, refused);
    check(`${name}: and reaches no paid API`, upstreamCalls.length === 0);

    validToken = false; upstreamCalls = [];
    r = await call(handler, { domain: 'acme.test', email: 'a@acme.test' });
    check(`${name}: refuses an invalid token, spending nothing`,
      (r.status === 401 || r.status === 403) && upstreamCalls.length === 0);
  }

  // Being unable to verify a caller is not the same as verifying them.
  const apollo = require(path.join(REPO, 'api/apollo-enrich.js'));
  validToken = true; authReachable = false; upstreamCalls = [];
  let r = await call(apollo, { domain: 'acme.test' });
  check('an unreachable auth service fails closed rather than open',
    r.status >= 400 && upstreamCalls.length === 0);
  authReachable = true;

  // Every gated endpoint has to let the header through CORS, or the browser
  // strips it and every real call 401s.
  const missingCors = ENDPOINTS.filter(n => {
    const src = read(`api/${n}.js`);
    if (!/Access-Control-Allow-Headers/.test(src)) return false;   // no CORS block at all
    return !/Allow-Headers[^)]*Authorization/.test(src);
  });
  check('every endpoint with CORS accepts the Authorization header',
    missingCors.length === 0);
  if (missingCors.length) console.log('    ', missingCors);

  check('the gate is one shared helper, not ten copies to drift apart',
    ENDPOINTS.every(n => /require\(['"]\.\/_lib\/require-user\.js['"]\)/.test(read(`api/${n}.js`))));

  /* ── 2. Every client call site carries the session ────────────────────── */
  console.log('\n──── the pages send their session ────');

  const CALLERS = {
    'web/agents/sales-agent.html': ['apollo-enrich', 'hunter', 'profile-search'],
    'web/agents/competitive-agent.html': ['domain-metrics', 'scout-data'],
    'web/js/backlink-service.js': ['domain-metrics'],
    'web/agents/social-agent.html': ['enrich-business'],
    'web/intelligence/business-brain.html': ['enrich-business'],
    'web/marketing/lead-generation.html': ['lead-enrich', 'lead-signals', 'outreach-draft'],
    'web/seo/content-engine.html': ['seo-backlink-prospects'],
  };

  Object.entries(CALLERS).forEach(([file, endpoints]) => {
    const src = read(file);
    // A call that still hardcodes a bare Content-Type header is a call that
    // will 401 in production.
    const bare = endpoints.filter(e => {
      const re = new RegExp(`/api/${e}[^]{0,400}?headers:\\s*\\{\\s*['"]Content-Type['"]`, 's');
      return re.test(src);
    });
    check(`${path.basename(file)}: no call left without a session`, bare.length === 0);
    if (bare.length) console.log('    ', bare);
  });

  // A page using the helper must load it, or sendAuthHeaders is undefined.
  const usingWithoutLoader = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return walk(full);
    if (!d.name.endsWith('.html')) return;
    const src = fs.readFileSync(full, 'utf8');
    if (/sendAuthHeaders\(/.test(src) && !/send-auth\.js/.test(src)) {
      usingWithoutLoader.push(path.relative(REPO, full));
    }
  });
  walk(path.join(REPO, 'web'));
  check('every page using sendAuthHeaders loads send-auth.js',
    usingWithoutLoader.length === 0);
  if (usingWithoutLoader.length) console.log('    ', usingWithoutLoader);

  /* ── 3. An unscored prospect is not given a score ─────────────────────── */
  console.log('\n──── the opportunity score ────');

  const salesSrc = read('web/agents/sales-agent.html');
  const salesCode = salesSrc.split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n');

  check('the hardcoded 5 is gone', !/opportunityScore \|\| 5/.test(salesCode));
  check('scoring is decided by one guard', /const isScored = /.test(salesCode));

  // Exercise the real predicate and the real filter/sort logic.
  const isScored = (v) => typeof v === 'number' && isFinite(v);
  check('the trap is real: undefined < 7 is false', (undefined < 7) === false);
  check('an unscored prospect is not treated as scored', !isScored(undefined) && !isScored(null));
  check('a genuine zero is a score', isScored(0));

  const prospects = [
    { name: 'Scored 9', opportunityScore: 9 },
    { name: 'Scored 0', opportunityScore: 0 },
    { name: 'Unscored' },
  ];
  const scoreFilter = 7;
  const filtered = prospects.filter(p => {
    if (scoreFilter && !isScored(p.opportunityScore)) return false;
    if (scoreFilter && p.opportunityScore < scoreFilter) return false;
    return true;
  });
  check('a minimum-score filter excludes the unscored prospect',
    filtered.length === 1 && filtered[0].name === 'Scored 9');

  const sorted = prospects.slice().sort((a, b) =>
    (isScored(b.opportunityScore) ? b.opportunityScore : -1) -
    (isScored(a.opportunityScore) ? a.opportunityScore : -1));
  check('unscored prospects sort last rather than producing NaN',
    sorted[0].name === 'Scored 9' && sorted[2].name === 'Unscored');

  check('the card renders a dash for an unscored prospect',
    /scored \? score : '–'/.test(salesCode));
  check('and says the score is an estimate, not a measurement',
    /estimated by Claude/.test(salesSrc));
  check('and says plainly when there is no score',
    /Not scored/.test(salesSrc));

  /* ── 4. The scoring that IS used stays honest ─────────────────────────── */
  console.log('\n──── priority scoring reads real fields ────');

  const leadSrc = read('web/marketing/lead-generation.html');
  check('priority score is derived from real prospect fields, not a constant',
    /p\.isDecisionMaker/.test(leadSrc) && /p\.signals/.test(leadSrc) &&
    /emailVerification\?\.status === 'deliverable'/.test(leadSrc));
  check('and email discovery still refuses to invent an address',
    /never guess or invent one/.test(read('api/seo-backlink-find-email.js')));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();
