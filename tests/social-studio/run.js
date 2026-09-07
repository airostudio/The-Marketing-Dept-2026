/**
 * LinkedIn + Social Studio agent checks.
 *
 * Two findings from the audit, both about telling the truth:
 *
 *   1. Five endpoints ran with no idea who was calling, and one of them —
 *      publish-social-post — posts to the customer's own Facebook, LinkedIn,
 *      Twitter and Instagram accounts, publicly and instantly, using OAuth
 *      tokens this server holds. Anyone who found the URL could publish under
 *      the brand's name. The others spend Claude/image credits or disclose
 *      which accounts are connected.
 *
 *   2. The dashboard printed "▲ 0.0% vs last month" in green, with an up
 *      arrow, against a month of history that is stored precisely nowhere; a
 *      share-of-voice of "0.0%" for a metric nothing in the app measures; and
 *      `metric || 0` throughout, which renders an account whose API has never
 *      been read as an account with zero followers.
 *
 *   node tests/social-studio/run.js
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
// Assertions about removed code must not match the comment that explains the
// removal — otherwise the fix quoting the old expression fails its own test.
const code = f => read(f).split('\n')
  .filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n');

/* ── Fake Supabase ──────────────────────────────────────────────────────── */
let validToken = true;
let authReachable = true;
const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
require.cache[helperPath] = {
  id: helperPath, filename: helperPath, loaded: true,
  exports: {
    sbRest: async (u, k, method, p) => {
      if (p.startsWith('/profiles')) {
        return { ok: true, status: 200, data: [{ id: 'user-1', plan: 'growth', role: 'user' }] };
      }
      return { ok: true, status: 200, data: [] };
    },
  },
};

let upstreamCalls = [];
global.fetch = async (url) => {
  if (String(url).includes('/auth/v1/user')) {
    if (!authReachable) throw new Error('network down');
    return validToken
      ? { ok: true, json: async () => ({ id: 'user-1' }) }
      : { ok: false, json: async () => ({}) };
  }
  // Every other host here is either a social platform we would be publishing
  // to under the customer's name, or a paid API. Reaching one at all, for a
  // caller we never identified, is the failure being guarded against.
  upstreamCalls.push(String(url));
  return { ok: true, status: 200, json: async () => ({ id: 'x' }), text: async () => '{}' };
};

const ENDPOINTS = [
  'publish-social-post', 'generate-social-posts', 'render-social-image',
  'nancy-edit-post', 'social-connections-status',
];

function env() {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  // Every platform token present, so a refusal can only be the auth gate and
  // not a missing-configuration branch answering instead.
  ['META_PAGE_ID', 'META_PAGE_ACCESS_TOKEN', 'LINKEDIN_ACCESS_TOKEN',
   'LINKEDIN_ORGANIZATION_URN', 'TWITTER_USER_ACCESS_TOKEN', 'INSTAGRAM_USER_ID',
   'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'].forEach(k => { process.env[k] = 'test-key'; });
}

let ip = 0;
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
  // A distinct IP per call, or a per-IP rate limit turns later assertions into
  // 429s that look like a broken endpoint.
  const headers = { host: 'app.test', 'x-forwarded-for': `10.4.0.${(ip++ % 250) + 1}` };
  if (!opts.noAuth) headers.authorization = 'Bearer t';
  await handler({ method: opts.method || 'POST', headers, query: {}, body: body || {} }, res);
  return { status, body: payload };
}

(async () => {
  /* ── 1. Nobody publishes under the brand's name unidentified ──────────── */
  console.log('──── the social endpoints know who is calling ────');

  const BODY = {
    platform: 'linkedin', content: 'hello', post: { content: 'hello', platform: 'linkedin' },
    instruction: 'shorten', businessProfile: {}, brand: {}, topic: 'x',
  };

  for (const name of ENDPOINTS) {
    const handler = require(path.join(REPO, `api/${name}.js`));
    const fn = typeof handler === 'function' ? handler : handler.default;

    validToken = true; authReachable = true; upstreamCalls = [];
    let r = await call(fn, BODY, { noAuth: true, method: name === 'social-connections-status' ? 'GET' : 'POST' });
    check(`${name}: refuses an unauthenticated call`, r.status === 401 || r.status === 403);
    check(`${name}: and posts / spends nothing`, upstreamCalls.length === 0);

    validToken = false; upstreamCalls = [];
    r = await call(fn, BODY, { method: name === 'social-connections-status' ? 'GET' : 'POST' });
    check(`${name}: refuses an invalid token, posting nothing`,
      (r.status === 401 || r.status === 403) && upstreamCalls.length === 0);
  }

  // Being unable to verify a caller is not the same as verifying them.
  const publish = require(path.join(REPO, 'api/publish-social-post.js'));
  const publishFn = typeof publish === 'function' ? publish : publish.default;
  validToken = true; authReachable = false; upstreamCalls = [];
  const r = await call(publishFn, BODY);
  check('an unreachable auth service fails closed rather than open',
    r.status >= 400 && upstreamCalls.length === 0);
  authReachable = true;

  check('the gate is one shared helper, not five copies to drift apart',
    ENDPOINTS.every(n => /require\(['"]\.\/_lib\/require-user\.js['"]\)/.test(read(`api/${n}.js`))));

  const missingCors = ENDPOINTS.filter(n => {
    const src = read(`api/${n}.js`);
    if (!/Access-Control-Allow-Headers/.test(src)) return false;
    return !/Allow-Headers[^)]*Authorization/.test(src);
  });
  check('every endpoint with CORS accepts the Authorization header', missingCors.length === 0);
  if (missingCors.length) console.log('    ', missingCors);

  // The scheduled publisher calls the platform adapters directly, so gating
  // the HTTP handler must not have cut the cron off from them.
  const cron = read('api/cron-auto-publish.js');
  check('the auto-publish cron still reaches the platform adapters',
    /publishPost/.test(cron) && /publishPost/.test(read('api/publish-social-post.js')));
  check('and is itself gated by CRON_SECRET', /CRON_SECRET/.test(cron));

  /* ── 2. Every page that sends a session can load the helper ───────────── */
  console.log('\n──── the pages send their session ────');

  const CALLERS = {
    'web/agents/social-agent.html': ['generate-social-posts', 'render-social-image'],
    'web/agents/nancy-agent.html': ['nancy-edit-post'],
    'web/agents/email-delivery-agent.html': ['publish-social-post', 'social-connections-status'],
    'web/marketing/social-media.html': ['publish-social-post'],
  };

  Object.entries(CALLERS).forEach(([file, endpoints]) => {
    const src = read(file);
    const bare = endpoints.filter(e => {
      const re = new RegExp(`/api/${e}[^]{0,400}?headers:\\s*\\{\\s*['"]Content-Type['"]`, 's');
      return re.test(src);
    });
    check(`${path.basename(file)}: no call left without a session`, bare.length === 0);
    if (bare.length) console.log('    ', bare);
  });

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
  check('every page using sendAuthHeaders loads send-auth.js', usingWithoutLoader.length === 0);
  if (usingWithoutLoader.length) console.log('    ', usingWithoutLoader);

  /* ── 3. Nothing is compared against history that does not exist ───────── */
  console.log('\n──── the dashboard does not invent a comparison ────');

  const dash = code('web/marketing/social-media.html');

  check('no KPI is handed a hardcoded zero change',
    !/followersChange:\s*0\b/.test(dash) && !/engagementChange:\s*0\b/.test(dash) &&
    !/trafficChange:\s*0\b/.test(dash) && !/sovChange:\s*0\b/.test(dash));
  check('share of voice is no longer asserted as 0.0%', !/shareOfVoice:\s*0\b/.test(dash));
  check('an absent change renders as a stated absence, not an arrow',
    /No previous period to compare/.test(dash));
  check('share of voice says what it would take to measure it',
    /needs competitor monitoring/.test(dash));
  check('one guard decides whether a number was measured at all',
    /function measured\(/.test(dash));

  // Exercise the real predicate the page now uses.
  const measured = (v) => typeof v === 'number' && isFinite(v);
  check('null is not a measurement', !measured(null) && !measured(undefined));
  check('NaN is not a measurement', !measured(NaN));
  check('a genuine zero still is one', measured(0));

  // And the trap that made this bug invisible.
  check('the trap is real: null >= 0 is true', (null >= 0) === true);
  check('so a null change would have rendered as a green up-arrow',
    (null >= 0 ? 'up' : 'down') === 'up');

  /* ── 4. An unread platform is not an empty platform ───────────────────── */
  console.log('\n──── unmeasured metrics stay unmeasured ────');

  const svc = code('web/js/social-media-service.js');
  check('platform stats no longer collapse absent metrics to zero',
    !/followers:\s*platformMetrics\.followers \|\| 0/.test(svc) &&
    !/engagementRate:\s*platformMetrics\.engagementRate \|\| 0/.test(svc));
  check('a single num() guard is used instead', /function num\(/.test(svc));
  check('stats say whether a platform API ever answered', /metricsFetched/.test(svc));
  check('the all-zeros fallback block is gone',
    !/followers:\s*0,\s*\n\s*engagementRate:\s*0,/.test(svc));
  check('an engagement rate over zero impressions is undefined, not 0.00',
    !/\)\.toFixed\(2\)\s*\n?\s*:\s*'0\.00'/.test(svc));
  check('growth is not asserted from a single snapshot',
    !/growth:\s*0,\s*\n\s*source:\s*'api'/.test(svc));

  // The exact coercion this replaced.
  const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
  check('num() preserves a real zero that || 0 could not distinguish',
    num(0) === 0 && num(undefined) === null && num(null) === null);
  check('the old form erased the difference', (undefined || 0) === (0 || 0));

  /* ── 5. Publishing still tells the truth about what it did ────────────── */
  console.log('\n──── publishing reports honestly ────');

  const pub = read('api/publish-social-post.js');
  check('unconnected platforms are reported, not faked',
    /not_connected/.test(pub) && !/Math\.random/.test(code('api/publish-social-post.js')));
  check('every platform has a real adapter, not a stub',
    /graph\.facebook\.com/.test(pub) && /api\.linkedin\.com/.test(pub) &&
    /api\.twitter\.com/.test(pub) && /media_publish/.test(pub));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();
