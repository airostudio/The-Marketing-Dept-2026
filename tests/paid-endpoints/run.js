/**
 * The remaining endpoints that spend money or describe the deployment.
 *
 * Three groups, three different right answers:
 *
 *   1. Paid work for a known caller — the LLM proxies (claude, openai,
 *      perplexity), the generators (generate-ads, generate-ad-image), the
 *      paid data lookups (seo-keyword-volumes, pagespeed) and the credential
 *      proxy (integration). Each of these spends the owner's money or quota,
 *      so each needs a caller it can name. integration is the widest: it
 *      forwards to Ahrefs, Semrush, DataForSEO, Mailchimp and Resend on the
 *      account's credentials, and the last two can read audience lists and
 *      send mail.
 *
 *   2. Operator views — health and diagnostics' system route describe the
 *      deployment, not the caller: which keys exist, which env vars are
 *      missing, which upstreams answer. health went further and returned 15
 *      characters of the live Anthropic key to anyone who asked. These are
 *      administrator-only, and the key preview is gone.
 *
 *   3. A scope named in the request body — generate-ad-image bills credits
 *      against an intelProfileId, and diagnostics' project route probes a
 *      projectId's integrations. Requiring a session stops strangers; it does
 *      nothing about the customer next door, so both check that the scope
 *      actually belongs to the caller.
 *
 *   node tests/paid-endpoints/run.js
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
const code = f => read(f).split('\n')
  .filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n');

/* ── Fake Supabase ──────────────────────────────────────────────────────── */
let validToken = true;
let authReachable = true;
let role = 'user';
let ownedProfiles = ['profile-mine'];
let ownedProjects = ['project-mine'];
let memberProfiles = [];

const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
require.cache[helperPath] = {
  id: helperPath, filename: helperPath, loaded: true,
  exports: {
    sbRest: async (u, k, method, p) => {
      const one = (arr, id) => (arr.includes(id) ? [{ id }] : []);
      const idOf = (re) => { const m = p.match(re); return m ? decodeURIComponent(m[1]) : null; };

      if (p.startsWith('/profiles?')) {
        return { ok: true, status: 200, data: [{ id: 'user-1', plan: 'growth', role }] };
      }
      if (p.startsWith('/intelligence_profiles?')) {
        return { ok: true, status: 200, data: one(ownedProfiles, idOf(/[?&]id=eq\.([^&]+)/)) };
      }
      if (p.startsWith('/intelligence_profile_members?')) {
        const id = idOf(/[?&]profile_id=eq\.([^&]+)/);
        return { ok: true, status: 200, data: memberProfiles.includes(id) ? [{ profile_id: id }] : [] };
      }
      if (p.startsWith('/projects?')) {
        return { ok: true, status: 200, data: one(ownedProjects, idOf(/[?&]id=eq\.([^&]+)/)) };
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
  upstreamCalls.push(String(url));
  return {
    ok: true, status: 200,
    json: async () => ({ data: [{ b64_json: 'x' }], content: [{ text: '{}' }] }),
    text: async () => '{}',
  };
};

const PAID = [
  'claude', 'openai', 'perplexity', 'integration',
  'generate-ads', 'generate-ad-image', 'seo-keyword-volumes', 'pagespeed',
];
// The same hole, found in a second sweep: every one of these reaches a paid
// third party (Claude via _lib/nancy-claude.js, Gemini, Ark/Seedance video,
// Google Places, Unsplash, Convert) or drives this server's own crawler
// against an arbitrary URL on the caller's say-so.
const WIDER = [
  'ai-visibility-explain', 'ai-visibility-questions', 'blade-cities-autocomplete',
  'blade-places-search', 'blade-website-check', 'check-url', 'convert-experiments',
  'crawl', 'fetch-page', 'gemini', 'generate-video', 'nancy-analyze-website',
  'nancy-brand-identity', 'nancy-content-plan', 'nancy-screenshot',
  'nancy-search-competitors', 'nancy-strategy', 'nancy-structure-competitors',
  'nancy-upload-photo', 'places', 'seo-analyze-site', 'seo-backlink-find-email',
  'seo-backlink-search', 'seo-backlink-structure', 'seo-keyword-research',
  'seo-outreach-draft', 'seo-search-competitors', 'seo-structure-competitors',
  'seo-write-article', 'unsplash',
];
const GET_ONLY = new Set(['pagespeed', 'check-url', 'convert-experiments']);

function env() {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-api-test';
  ['OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'CLAUDE_API_KEY', 'AHREFS_API_KEY',
   'SEMRUSH_API_KEY', 'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD', 'MAILCHIMP_API_KEY',
   'RESEND_API_KEY', 'GOOGLE_PAGESPEED_API_KEY'].forEach(k => { process.env[k] = 'test-key'; });
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
    write() { return this; }, end() { return this; },
  };
  const headers = { host: 'app.test', 'x-forwarded-for': `10.9.0.${(ip++ % 250) + 1}` };
  if (!opts.noAuth) headers.authorization = 'Bearer t';
  await handler({
    method: opts.method || 'POST', headers, url: opts.url || '/api/x',
    query: opts.query || { url: 'https://acme.test' }, body: body || {},
  }, res);
  return { status, body: payload };
}

(async () => {
  /* ── 1. Nothing paid runs for an unidentified caller ──────────────────── */
  console.log('──── paid endpoints know who is spending ────');

  const BODY = {
    messages: [{ role: 'user', content: 'hi' }], headline: 'x',
    keywords: ['seo'], service: 'ahrefs', endpoint: '/', product: 'x', audience: 'y',
  };

  for (const name of PAID.concat(WIDER)) {
    const handler = require(path.join(REPO, `api/${name}.js`));
    const method = GET_ONLY.has(name) ? 'GET' : 'POST';

    validToken = true; authReachable = true; upstreamCalls = [];
    let r = await call(handler, BODY, { noAuth: true, method });
    check(`${name}: refuses an unauthenticated call`, r.status === 401 || r.status === 403);
    check(`${name}: and spends nothing`, upstreamCalls.length === 0);

    validToken = false; upstreamCalls = [];
    r = await call(handler, BODY, { method });
    check(`${name}: refuses an invalid token, spending nothing`,
      (r.status === 401 || r.status === 403) && upstreamCalls.length === 0);
  }

  // The GET capability probe leaks which paid credentials this deployment
  // holds, so it is gated too — not just the POST that uses them.
  const integration = require(path.join(REPO, 'api/integration.js'));
  validToken = true; upstreamCalls = [];
  let r = await call(integration, {}, { noAuth: true, method: 'GET' });
  check('integration: the credential probe is gated as well as the proxy',
    r.status === 401 || r.status === 403);

  const claude = require(path.join(REPO, 'api/claude.js'));
  validToken = true; authReachable = false; upstreamCalls = [];
  r = await call(claude, BODY);
  check('an unreachable auth service fails closed rather than open',
    r.status >= 400 && upstreamCalls.length === 0);
  authReachable = true;

  check('the gate is one shared helper across all of them',
    PAID.concat(WIDER).every(n => /require\(['"]\.\/_lib\/require-user\.js['"]\)/.test(read(`api/${n}.js`))));

  const missingCors = PAID.concat(WIDER).filter(n => {
    const src = read(`api/${n}.js`);
    if (!/Access-Control-Allow-Headers/.test(src)) return false;
    return !/Allow-Headers[^)]*Authorization/.test(src);
  });
  check('every endpoint with CORS accepts the Authorization header', missingCors.length === 0);
  if (missingCors.length) console.log('    ', missingCors);

  /* ── 2. Operator views are for operators ──────────────────────────────── */
  console.log('\n──── the deployment does not describe itself to customers ────');

  const health = require(path.join(REPO, 'api/health.js'));
  const diagnostics = require(path.join(REPO, 'api/diagnostics.js'));

  validToken = true;
  role = 'user';
  r = await call(health, {}, { method: 'GET' });
  check('health: a signed-in customer is still refused', r.status === 403);
  r = await call(diagnostics, {}, { method: 'GET', url: '/api/diagnostics' });
  check('diagnostics: system checks are refused to a customer', r.status === 403);

  r = await call(health, {}, { method: 'GET', noAuth: true });
  check('health: and refused outright to a stranger', r.status === 401 || r.status === 403);

  role = 'admin';
  r = await call(health, {}, { method: 'GET' });
  check('health: an administrator still gets the report', r.status < 400 && r.body && r.body.checks);
  check('and it no longer contains a slice of the live API key',
    r.body && !('apiKeyPreview' in r.body.checks));
  check('the preview is gone from the source, not just from this response',
    !/apiKeyPreview\s*=/.test(code('api/health.js')));

  r = await call(diagnostics, {}, { method: 'GET', url: '/api/diagnostics' });
  check('diagnostics: an administrator still gets system checks', r.status < 400);
  role = 'user';

  /* ── 3. A scope in the request body is checked against the caller ─────── */
  console.log('\n──── you can only bill a business that is yours ────');

  const adImage = require(path.join(REPO, 'api/generate-ad-image.js'));
  process.env.OPENAI_API_KEY = 'test-key';

  validToken = true; upstreamCalls = [];
  r = await call(adImage, { headline: 'x', intelProfileId: 'profile-someone-else' });
  check('generate-ad-image: refuses to bill a profile the caller does not own',
    r.status === 403 && upstreamCalls.length === 0);

  upstreamCalls = [];
  r = await call(adImage, { headline: 'x', projectId: 'project-someone-else' });
  check('generate-ad-image: same for a project', r.status === 403 && upstreamCalls.length === 0);

  memberProfiles = ['profile-shared'];
  upstreamCalls = [];
  r = await call(adImage, { headline: 'x', intelProfileId: 'profile-shared' });
  check('generate-ad-image: a teammate on a shared profile is allowed through',
    r.status !== 403);
  memberProfiles = [];

  upstreamCalls = [];
  r = await call(diagnostics, { projectId: 'project-someone-else' },
    { method: 'POST', url: '/api/diagnostics/project' });
  check('diagnostics: refuses to probe another customer\'s project integrations',
    r.status === 403 && upstreamCalls.length === 0);

  r = await call(diagnostics, { projectId: 'project-mine' },
    { method: 'POST', url: '/api/diagnostics/project' });
  check('diagnostics: and runs for the caller\'s own project', r.status < 400);

  check('the ownership check is one shared helper',
    /callerOwnsScope/.test(read('api/generate-ad-image.js')) &&
    /callerOwnsScope/.test(read('api/diagnostics.js')));

  // Exercise the predicate directly, including the case that has no scope.
  const { callerOwnsScope } = require(path.join(REPO, 'api/_lib/require-user.js'));
  env();
  check('no scope named means nothing to protect',
    (await callerOwnsScope('user-1', {})) === true);
  check('an owned profile passes',
    (await callerOwnsScope('user-1', { intelProfileId: 'profile-mine' })) === true);
  check('an unowned profile does not',
    (await callerOwnsScope('user-1', { intelProfileId: 'profile-theirs' })) === false);

  /* ── 4. Metering does not switch itself off ───────────────────────────── */
  console.log('\n──── a database blip does not become free credits ────');

  const adSrc = code('api/generate-ad-image.js');
  check('the credit lookup no longer proceeds unmetered on failure',
    !/proceeding unmetered/.test(adSrc));
  check('a named scope that cannot be checked stops the call',
    /credits_unavailable/.test(adSrc));

  /* ── 5. Every page that calls one of these carries the session ────────── */
  console.log('\n──── the pages send their session ────');

  const usingWithoutLoader = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return walk(full);
    if (!d.name.endsWith('.html')) return;
    const src = fs.readFileSync(full, 'utf8');
    const usesHelperDirectly = /sendAuthHeaders\(/.test(src);
    // A page that loads one of these modules calls the gated endpoints
    // through it, so it needs the helper just as much as a direct caller.
    const loadsCallingModule =
      /(claude|openai|perplexity)-service\.js/.test(src) || /api-connector\.js/.test(src);
    if ((usesHelperDirectly || loadsCallingModule) && !/send-auth\.js/.test(src)) {
      usingWithoutLoader.push(path.relative(REPO, full));
    }
  });
  walk(path.join(REPO, 'web'));
  check('every page reaching a gated endpoint loads send-auth.js',
    usingWithoutLoader.length === 0);
  if (usingWithoutLoader.length) console.log('    ', usingWithoutLoader);

  // A bare Content-Type header on a call to a gated endpoint is a call that
  // will 401 in production. Anchor each check to its own endpoint rather than
  // to the whole file, which also contains calls to ungated ones.
  const ALL = PAID.concat(WIDER).join('|');
  const bareCalls = [];
  const scanCallSites = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return scanCallSites(full);
    if (!/\.(html|js)$/.test(d.name)) return;
    const src = fs.readFileSync(full, 'utf8');
    const re = new RegExp(
      `fetch\\(\\s*['"\`]/api/(?:${ALL})[^'"\`]*['"\`][^)]{0,300}?headers:\\s*\\{\\s*['"]Content-Type['"]`, 'gs');
    if (re.test(src)) bareCalls.push(path.relative(REPO, full));
  });
  scanCallSites(path.join(REPO, 'web'));
  check('no call site reaches a gated endpoint without a session', bareCalls.length === 0);
  if (bareCalls.length) console.log('    ', bareCalls);

  check('the capability probe carries the session too',
    /sendAuthHeaders[\s\S]{0,300}\/api\/integration/.test(read('web/js/api-connector.js')));
  check('and a refused probe is not cached as "nothing is configured"',
    /serverCapsPromise = null;\s*\n\s*return null;/.test(code('web/js/api-connector.js')));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();
