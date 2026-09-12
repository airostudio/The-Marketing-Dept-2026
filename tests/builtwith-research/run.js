/**
 * BuiltWith research tool — the password gate, the unlock token, and the
 * two-layer access check on every builtwith-*.js proxy endpoint.
 *
 *   node tests/builtwith-research/run.js
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

/* ── Fake Supabase (requireUser's profile read) ────────────────────────── */
const supaRestPath = path.join(REPO, 'api/_lib/supabase-rest.js');
require.cache[supaRestPath] = {
  id: supaRestPath, filename: supaRestPath, loaded: true,
  exports: {
    sbRest: async (u, k, method, p) => {
      if (p.startsWith('/profiles')) {
        return { ok: true, status: 200, data: [{ id: 'user-1', plan: 'growth', role: 'member' }] };
      }
      return { ok: false, status: 404, data: null };
    },
  },
};

const { resetForTests: resetRateLimits } = require(path.join(REPO, 'api/_lib/rate-limit.js'));

let validSession = true;
let builtwithBehavior = 'ok'; // 'ok' | 'upstream_error' | 'not_json'
const builtwithCalls = [];

global.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('/auth/v1/user')) {
    return validSession
      ? { ok: true, json: async () => ({ id: 'user-1', email: 'user@test.example' }) }
      : { ok: false, json: async () => ({ msg: 'invalid' }) };
  }
  if (u.includes('api.builtwith.com')) {
    builtwithCalls.push(u);
    if (builtwithBehavior === 'upstream_error') {
      return { ok: false, status: 500, text: async () => 'upstream exploded' };
    }
    if (builtwithBehavior === 'not_json') {
      return { ok: true, status: 200, text: async () => 'not json at all' };
    }
    // A minimal, plausible success body — exact shape is unverified (see the
    // warning block in api/_lib/builtwith-client.js), this just needs to be
    // valid JSON that does not include an api key anywhere.
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify({
        Results: [{ Result: { Paths: [{ Technologies: [{ Name: 'Shopify', Tag: 'ecommerce', FirstDetected: '2020-01-01', LastDetected: '2026-01-01' }] }] } }],
        Domain: 'example.com',
      }),
    };
  }
  throw new Error('unexpected fetch ' + u);
};

let keepPasswordUnset = false;
function env() {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-not-a-real-secret';
  if (keepPasswordUnset) delete process.env.BUILTWITH_TOOL_PASSWORD;
  else process.env.BUILTWITH_TOOL_PASSWORD = 'correct-horse-battery-staple';
  process.env.BUILTWITH_API_KEY = 'bw-fake-api-key-should-never-leak';
  delete process.env.BUILTWITH_TOOL_SECRET; // exercise the documented fallback
}

function makeRes() {
  let status = 200, payload = null, ended = false;
  const res = {
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    status(c) { status = c; return this; },
    json(o) { payload = o; return this; },
    end() { ended = true; return this; },
  };
  return { res, get status() { return status; }, get body() { return payload; }, get ended() { return ended; } };
}

let seq = 0;
async function call(handler, body, opts) {
  env();
  opts = opts || {};
  const wrapped = makeRes();
  const headers = Object.assign({ host: 'app.test', 'x-forwarded-for': `10.1.0.${++seq % 250}` }, opts.headers || {});
  if (!opts.noAuth) headers.authorization = 'Bearer sometoken';
  await handler({ method: opts.method || 'POST', headers, body: body || {} }, wrapped.res);
  return { status: wrapped.status, body: wrapped.body };
}

(async () => {
  const unlock = require(path.join(REPO, 'api/builtwith-unlock.js'));
  const { issueToken, verifyToken } = require(path.join(REPO, 'api/_lib/internal-tools-access-token.js'));
  const domain = require(path.join(REPO, 'api/builtwith-domain.js'));
  const lists = require(path.join(REPO, 'api/builtwith-lists.js'));
  const trends = require(path.join(REPO, 'api/builtwith-trends.js'));
  const relationships = require(path.join(REPO, 'api/builtwith-relationships.js'));

  const PROXIES = [
    ['builtwith-domain', domain, { domain: 'example.com' }],
    ['builtwith-lists', lists, { technology: 'Shopify' }],
    ['builtwith-trends', trends, { technology: 'Shopify' }],
    ['builtwith-relationships', relationships, { domain: 'example.com' }],
  ];

  /* ── 1. Unlock requires normal auth before checking the password ──────── */
  console.log('\n──── unlock requires normal Audema login first ────');
  resetRateLimits();
  env();
  validSession = false;
  let r = await call(unlock, { password: 'correct-horse-battery-staple' }, { noAuth: true });
  check('no bearer token at all is rejected before the password is even read', r.status === 401);
  validSession = false;
  r = await call(unlock, { password: 'correct-horse-battery-staple' });
  check('an invalid session is rejected by requireUser, not by the password check', r.status === 401 || r.status === 503);
  validSession = true;

  /* ── 2. Wrong password ─────────────────────────────────────────────────── */
  console.log('\n──── wrong password ────');
  resetRateLimits();
  r = await call(unlock, { password: 'not-the-password' });
  check('wrong password is rejected with 401', r.status === 401);
  check('the message is generic, not revealing anything about the setup',
    r.body.error === 'Incorrect password.');
  check('no token is issued on a wrong password', !r.body.token);

  /* ── 3. Missing config fails closed, never accepts any password ──────── */
  console.log('\n──── missing BUILTWITH_TOOL_PASSWORD fails closed ────');
  resetRateLimits();
  keepPasswordUnset = true;
  r = await call(unlock, { password: 'anything-at-all' });
  keepPasswordUnset = false;
  check('an unset password env var returns a config error, not a silent accept',
    r.status === 500 && r.body.code === 'not_configured');

  /* ── 4. Correct password issues a verifiable token ─────────────────────── */
  console.log('\n──── correct password issues a verifiable token ────');
  resetRateLimits();
  env();
  r = await call(unlock, { password: 'correct-horse-battery-staple' });
  check('correct password unlocks with 200', r.status === 200 && r.body.success === true);
  check('a token string comes back', typeof r.body.token === 'string' && r.body.token.length > 10);
  check('an expiresAt timestamp comes back, in the future', r.body.expiresAt > Date.now());
  const goodToken = r.body.token;
  const verified = verifyToken(goodToken);
  check('the issued token verifies as valid', verified.valid === true && verified.userId === 'user-1');

  check('a tampered payload is rejected', verifyToken(goodToken.slice(0, -1) + (goodToken.slice(-1) === 'a' ? 'b' : 'a')).valid === false);
  check('a token with the wrong signature length is rejected safely (no throw)', (() => {
    try { return verifyToken(goodToken + 'x').valid === false; } catch (e) { return false; }
  })());
  check('a garbage string is rejected without throwing', (() => {
    try { return verifyToken('not.a.real.token').valid === false; } catch (e) { return false; }
  })());
  check('an expired token is rejected', (() => {
    const expired = issueToken('user-1', -1000);
    return verifyToken(expired.token).valid === false;
  })());

  /* ── 5. Rate limiting on the unlock endpoint itself ────────────────────── */
  console.log('\n──── unlock is tightly rate limited (password-guessing resistance) ────');
  resetRateLimits();
  env();
  const staticHeaders = { 'x-forwarded-for': '10.9.9.9' };
  const staticSeqCall = async (body) => {
    env();
    const wrapped = makeRes();
    await unlock({ method: 'POST', headers: Object.assign({ authorization: 'Bearer t' }, staticHeaders), body }, wrapped.res);
    return { status: wrapped.status, body: wrapped.body };
  };
  let lastGuess;
  for (let i = 0; i < 6; i++) lastGuess = await staticSeqCall({ password: 'nope' });
  check('the 6th rapid guess from one account is rate-limited, not answered as wrong-password',
    lastGuess.status === 429);

  /* ── 6. Every builtwith-*.js endpoint requires the unlock token ────────── */
  console.log('\n──── every proxy endpoint requires BOTH normal auth AND the unlock token ────');
  for (const [name, handler, body] of PROXIES) {
    resetRateLimits();
    validSession = true;

    let res = await call(handler, body, { noAuth: true });
    check(`${name}: refuses with no Supabase auth at all`, res.status === 401);

    resetRateLimits();
    res = await call(handler, body); // valid auth, but no X-BuiltWith-Token header
    check(`${name}: refuses valid auth with NO unlock token`, res.status === 403 && res.body.code === 'builtwith_locked');

    resetRateLimits();
    res = await call(handler, body, { headers: { 'x-builtwith-token': 'complete-garbage' } });
    check(`${name}: refuses valid auth with an INVALID unlock token`, res.status === 403 && res.body.code === 'builtwith_locked');

    resetRateLimits();
    const { issueToken: issue2 } = require(path.join(REPO, 'api/_lib/internal-tools-access-token.js'));
    const expired = issue2('user-1', -1000);
    res = await call(handler, body, { headers: { 'x-builtwith-token': expired.token } });
    check(`${name}: refuses valid auth with an EXPIRED unlock token`, res.status === 403 && res.body.code === 'builtwith_locked');
  }

  /* ── 7. A valid token + valid auth actually reaches BuiltWith ──────────── */
  console.log('\n──── a fully unlocked, authenticated call succeeds ────');
  const { issueToken: issue3 } = require(path.join(REPO, 'api/_lib/internal-tools-access-token.js'));
  const freshToken = issue3('user-1').token;

  for (const [name, handler, body] of PROXIES) {
    resetRateLimits();
    validSession = true;
    builtwithBehavior = 'ok';
    const res = await call(handler, body, { headers: { 'x-builtwith-token': freshToken } });
    check(`${name}: succeeds with valid auth + valid unlock token`, res.status === 200 && res.body.success === true);
    check(`${name}: response carries a "raw" field with the full upstream body`, res.body.raw !== undefined && res.body.raw !== null);
  }

  /* ── 8. The API key never appears in any response body ─────────────────── */
  console.log('\n──── BUILTWITH_API_KEY never leaks into a response ────');
  for (const [name, handler, body] of PROXIES) {
    resetRateLimits();
    validSession = true;
    builtwithBehavior = 'ok';
    const res = await call(handler, body, { headers: { 'x-builtwith-token': freshToken } });
    const serialized = JSON.stringify(res.body);
    check(`${name}: no api key in response body`, !serialized.includes('bw-fake-api-key-should-never-leak'));
  }
  // And the outbound request itself only ever carried the key as an upstream
  // query param — never logged back to the client.
  check('every outbound BuiltWith call used process.env.BUILTWITH_API_KEY as KEY=',
    builtwithCalls.length > 0 && builtwithCalls.every(u => u.includes('KEY=bw-fake-api-key-should-never-leak')));

  /* ── 9. Upstream failure is an honest error, never fabricated data ──────── */
  console.log('\n──── an upstream BuiltWith failure is honest, never fabricated ────');
  for (const [name, handler, body] of PROXIES) {
    resetRateLimits();
    validSession = true;
    builtwithBehavior = 'upstream_error';
    const res = await call(handler, body, { headers: { 'x-builtwith-token': freshToken } });
    check(`${name}: upstream 500 becomes a real error response, not a fabricated success`,
      res.status >= 500 || res.status === 502);
    check(`${name}: upstream failure response is not marked success:true`, res.body.success !== true);
  }
  builtwithBehavior = 'ok';

  /* ── 10. Static shape checks ─────────────────────────────────────────────── */
  console.log('\n──── static checks ────');
  check('internal-tools-access-token.js uses timingSafeEqual for signature verification',
    read('api/_lib/internal-tools-access-token.js').includes('timingSafeEqual'));
  check('builtwith-unlock.js uses timingSafeEqual for the password compare, not ===',
    read('api/builtwith-unlock.js').includes('timingSafeEqual') && !/if\s*\(\s*password\s*===\s*configured/.test(read('api/builtwith-unlock.js')));
  check('builtwith-unlock.js checks requireUser before the password',
    (() => {
      const src = read('api/builtwith-unlock.js');
      return src.indexOf('requireUser(req, res)') < src.indexOf('process.env.BUILTWITH_TOOL_PASSWORD');
    })());
  for (const f of ['api/builtwith-domain.js', 'api/builtwith-lists.js', 'api/builtwith-trends.js', 'api/builtwith-relationships.js']) {
    check(`${f} calls requireInternalToolsAccess (both auth layers)`, read(f).includes('requireInternalToolsAccess'));
    check(`${f} never references BUILTWITH_API_KEY directly (stays inside _lib/builtwith-client.js)`,
      !read(f).includes('BUILTWITH_API_KEY'));
  }
  check('web/tools/builtwith-research.html stores the token in sessionStorage, not localStorage',
    /sessionStorage\.setItem\(TOKEN_KEY/.test(read('web/tools/builtwith-research.html')) &&
    !/localStorage\.setItem\(TOKEN_KEY/.test(read('web/tools/builtwith-research.html')));
  check('web/tools/builtwith-research.html writes discovered prospects to the chase_v3 key',
    read('web/tools/builtwith-research.html').includes("CHASE_STORE_KEY = 'chase_v3'"));
  check('web/tools/builtwith-research.html is not linked from the main hub',
    !read('web/index.html').includes('builtwith-research'));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();
