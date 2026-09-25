/**
 * Website Mockup (Prospect Hunter -> Chase) checks.
 *
 * Covers the same non-negotiable rules as every other paid endpoint in this
 * codebase:
 *
 *   1. api/generate-website-mockup.js identifies the caller and checks
 *      credits BEFORE it ever reaches Gemini — an unauthenticated call and an
 *      exhausted balance both spend nothing on the real provider.
 *   2. A reserved credit is refunded, not kept, when the Gemini call itself
 *      fails — the customer never pays for a mockup they did not get.
 *   3. imageGenProvider('gemini', ...) in api/_lib/nancy-providers.js never
 *      throws and never fabricates a buffer: a missing GEMINI_API_KEY and a
 *      safety-blocked/empty 200 response both come back as
 *      {available:false, reason}.
 *
 *   node tests/website-mockup/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const { resetForTests: resetRateLimits } = require(path.join(REPO, 'api/_lib/rate-limit.js'));

function env() {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
}

async function callEndpoint(handler, body, opts) {
  env();
  opts = opts || {};
  let status = 200, payload = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(o) { payload = o; return this; }, end() { return this; },
  };
  const headers = { host: 'app.test', 'x-forwarded-for': `10.3.0.${Math.floor(Math.random() * 250) + 1}` };
  if (!opts.noAuth) headers.authorization = opts.badAuth ? 'Bearer bad-token' : 'Bearer good-token';
  await handler({ method: 'POST', headers, query: {}, body: body || {} }, res);
  return { status, body: payload };
}

/**
 * A single stateful fake standing in for both Supabase (auth + profiles +
 * credit_balances/RPCs) and Gemini's generateContent — everything
 * generate-website-mockup.js reaches over the network.
 */
function makeFetch(state) {
  return async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || 'GET';

    if (u.includes('/auth/v1/user')) {
      state.calls.auth++;
      return state.validToken
        ? { ok: true, json: async () => ({ id: 'user-1', email: 'a@b.com' }) }
        : { ok: false, json: async () => ({}) };
    }

    if (u.includes('/rest/v1/profiles')) {
      state.calls.db++;
      const body = [{ id: 'user-1', plan: 'growth', role: 'user' }];
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }

    if (u.includes('/rest/v1/credit_balances')) {
      state.calls.db++;
      const body = [{ id: 'bal-1', intel_profile_id: 'profile-mine', project_id: null, credits_total: state.balance.total, credits_used: state.balance.used }];
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }

    if (u.includes('/rest/v1/rpc/consume_credits')) {
      state.calls.db++;
      const bodyIn = JSON.parse(opts.body);
      const cost = bodyIn.cost;
      if (state.balance.used + cost > state.balance.total) {
        const out = [{ allowed: false, used_after: state.balance.used, total: state.balance.total }];
        return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) };
      }
      state.balance.used += cost;
      const out = [{ allowed: true, used_after: state.balance.used, total: state.balance.total }];
      return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) };
    }

    if (u.includes('/rest/v1/rpc/refund_credits')) {
      state.calls.db++;
      state.calls.refund++;
      const bodyIn = JSON.parse(opts.body);
      state.balance.used = Math.max(0, state.balance.used - bodyIn.cost);
      const out = [{ used_after: state.balance.used, total: state.balance.total }];
      return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) };
    }

    if (u.includes('/rest/v1/intelligence_profiles') || u.includes('/rest/v1/intelligence_profile_members') || u.includes('/rest/v1/projects')) {
      state.calls.db++;
      // callerOwnsScope() checks — the test always names an owned profile.
      const body = u.includes('profile-mine') ? [{ id: 'profile-mine' }] : [];
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    }

    if (u.includes('generativelanguage.googleapis.com')) {
      state.calls.gemini++;
      if (state.geminiResponse === 'network_error') throw new Error('network down');
      if (state.geminiResponse === 'http_error') {
        return { ok: false, status: 500, text: async () => 'upstream on fire' };
      }
      if (state.geminiResponse === 'safety_block') {
        return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }) };
      }
      if (state.geminiResponse === 'no_candidates') {
        return { ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }) };
      }
      // success
      return {
        ok: true, status: 200,
        json: async () => ({
          candidates: [{
            finishReason: 'STOP',
            content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('fake-png-bytes').toString('base64') } }] },
          }],
        }),
      };
    }

    throw new Error('unexpected fetch: ' + u);
  };
}

(async () => {

/* ══════════════════════════════════════════════════════════════════════
   1. imageGenProvider('gemini', ...) — never throws, never fabricates
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n──── imageGenProvider(\'gemini\', ...) ────');
const { imageGenProvider } = require(path.join(REPO, 'api/_lib/nancy-providers.js'));

{
  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const savedFetch = global.fetch;
  global.fetch = async () => { throw new Error('must not call the network with no key'); };
  let result;
  try {
    result = await imageGenProvider('a prompt', { provider: 'gemini' });
  } finally {
    global.fetch = savedFetch;
    if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
  }
  check('no GEMINI_API_KEY: available is false, not a throw', result && result.available === false);
  check('no GEMINI_API_KEY: gives a real, specific reason', typeof result.reason === 'string' && /GEMINI_API_KEY/.test(result.reason));
  check('no GEMINI_API_KEY: no buffer is fabricated', result.buffer === undefined);
}

{
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const savedFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }) };
    }
    throw new Error('unexpected fetch: ' + url);
  };
  let result;
  try {
    result = await imageGenProvider('a prompt', { provider: 'gemini' });
  } finally {
    global.fetch = savedFetch;
  }
  check('safety-blocked 200 response: available is false, not a fabricated success', result && result.available === false);
  check('safety-blocked 200 response: names the real reason (SAFETY)', /safety/i.test(result.reason || ''));
}

{
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const savedFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      // 200 OK, no candidates at all, no promptFeedback either.
      return { ok: true, status: 200, json: async () => ({}) };
    }
    throw new Error('unexpected fetch: ' + url);
  };
  let result;
  try {
    result = await imageGenProvider('a prompt', { provider: 'gemini' });
  } finally {
    global.fetch = savedFetch;
  }
  check('empty 200 with no candidates: available is false', result && result.available === false);
  check('empty 200 with no candidates: honest reason, not silence', typeof result.reason === 'string' && result.reason.length > 0);
}

{
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const savedFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return {
        ok: true, status: 200,
        json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] } }] }),
      };
    }
    throw new Error('unexpected fetch: ' + url);
  };
  let result;
  try {
    result = await imageGenProvider('a prompt', { provider: 'gemini' });
  } finally {
    global.fetch = savedFetch;
  }
  check('a real inlineData part: available true with a real buffer', result.available === true && Buffer.isBuffer(result.buffer) && result.buffer.toString() === 'hello');
  check('mimeType comes from the response, not hardcoded blindly', result.mimeType === 'image/png');
}

delete process.env.GEMINI_API_KEY;

/* ══════════════════════════════════════════════════════════════════════
   2. api/generate-website-mockup.js — auth, credits, refunds
   ══════════════════════════════════════════════════════════════════════ */
console.log('\n──── api/generate-website-mockup.js ────');

const handlerPath = path.join(REPO, 'api/generate-website-mockup.js');
delete require.cache[handlerPath];
const handler = require(handlerPath);

const BODY = { businessName: 'Acme Plumbing', industry: 'Plumbers', intelProfileId: 'profile-mine' };

function freshState(overrides) {
  return Object.assign({
    validToken: true,
    balance: { total: 1000, used: 0 },
    geminiResponse: 'success',
    calls: { auth: 0, db: 0, gemini: 0, refund: 0 },
  }, overrides);
}

// -- 1. Auth before any work --------------------------------------------
{
  const state = freshState();
  const savedFetch = global.fetch;
  global.fetch = makeFetch(state);
  resetRateLimits();
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const r = await callEndpoint(handler, BODY, { noAuth: true });
  global.fetch = savedFetch;
  check('no bearer token: refused with 401', r.status === 401);
  check('no bearer token: not one call reaches Supabase or Gemini', state.calls.auth === 0 && state.calls.db === 0 && state.calls.gemini === 0);
}

{
  const state = freshState({ validToken: false });
  const savedFetch = global.fetch;
  global.fetch = makeFetch(state);
  resetRateLimits();
  const r = await callEndpoint(handler, BODY, { badAuth: true });
  global.fetch = savedFetch;
  check('an invalid token: refused with 401', r.status === 401);
  check('an invalid token: no credit or Gemini work happens', state.calls.db === 0 && state.calls.gemini === 0);
}

// -- 2. Exhausted credits refuse the call and never reach Gemini --------
{
  const state = freshState({ balance: { total: 50, used: 50 } }); // WEBSITE_MOCKUP_CREDIT_COST default is 50
  const savedFetch = global.fetch;
  global.fetch = makeFetch(state);
  resetRateLimits();
  const r = await callEndpoint(handler, BODY);
  global.fetch = savedFetch;
  console.log('  exhausted-credits response:', r.status, JSON.stringify(r.body && { error: r.body.error, creditsRemaining: r.body.creditsRemaining }));
  check('exhausted credits: refused with 402', r.status === 402);
  check('exhausted credits: the standard out_of_credits shape', r.body && r.body.error === 'out_of_credits' && r.body.creditsRemaining === 0);
  check('exhausted credits: Gemini is never called', state.calls.gemini === 0);
  check('exhausted credits: the balance is not mutated by the refused attempt', state.balance.used === 50);
}

// -- 3. A Gemini failure refunds the reservation -------------------------
{
  const state = freshState({ balance: { total: 1000, used: 0 }, geminiResponse: 'http_error' });
  const savedFetch = global.fetch;
  global.fetch = makeFetch(state);
  resetRateLimits();
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const r = await callEndpoint(handler, BODY);
  global.fetch = savedFetch;
  console.log('  gemini-failure response:', r.status, JSON.stringify(r.body && r.body.error).slice(0, 100));
  check('a Gemini upstream failure: an honest, non-fabricated error', r.status >= 500 && r.body && typeof r.body.error === 'string');
  check('a Gemini upstream failure: the reservation is refunded, not kept', state.calls.refund === 1 && state.balance.used === 0);
}

{
  const state = freshState({ balance: { total: 1000, used: 0 }, geminiResponse: 'safety_block' });
  const savedFetch = global.fetch;
  global.fetch = makeFetch(state);
  resetRateLimits();
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const r = await callEndpoint(handler, BODY);
  global.fetch = savedFetch;
  check('a safety-blocked Gemini response: refused, not a fabricated success', r.status >= 500 && r.body.success !== true);
  check('a safety-blocked Gemini response: names the real reason', /safety/i.test(r.body.error || ''));
  check('a safety-blocked Gemini response: the reservation is refunded', state.calls.refund === 1 && state.balance.used === 0);
}

// -- 4. Missing GEMINI_API_KEY refuses honestly and refunds --------------
{
  delete process.env.GEMINI_API_KEY;
  const state = freshState({ balance: { total: 1000, used: 0 } });
  const savedFetch = global.fetch;
  global.fetch = makeFetch(state);
  resetRateLimits();
  const r = await callEndpoint(handler, BODY);
  global.fetch = savedFetch;
  check('no GEMINI_API_KEY configured: a config-shaped 500, not a fabricated mockup', r.status === 500 && r.body.success !== true);
  check('no GEMINI_API_KEY configured: still refunds the reservation', state.calls.refund === 1 && state.balance.used === 0);
  check('no GEMINI_API_KEY configured: never actually calls Gemini', state.calls.gemini === 0);
}

// -- 5. A full success path spends credits and returns a usable image ---
{
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const state = freshState({ balance: { total: 1000, used: 0 }, geminiResponse: 'success' });
  const savedFetch = global.fetch;
  global.fetch = makeFetch(state);
  resetRateLimits();
  const r = await callEndpoint(handler, BODY);
  global.fetch = savedFetch;
  check('success: 200 with success:true', r.status === 200 && r.body.success === true);
  check('success: an imageUrl is returned (R2 unconfigured here -> a data URI fallback)', typeof r.body.imageUrl === 'string' && r.body.imageUrl.startsWith('data:image/png;base64,'));
  check('success: carries the disclaimer, so the caller cannot present this as the real site', /illustrative example only/i.test(r.body.disclaimer || ''));
  check('success: credits were actually spent (not just reserved-and-refunded)', state.balance.used === 50 && state.calls.refund === 0);
  check('success: creditsUsed matches WEBSITE_MOCKUP_CREDIT_COST', r.body.creditsUsed === 50);
}

// -- 6. requireUser runs before rateLimited, same as its sibling endpoints
{
  const fs = require('fs');
  const src = fs.readFileSync(handlerPath, 'utf8');
  check('calls requireUser before rateLimited', src.indexOf('await requireUser(req, res)') !== -1 &&
    src.indexOf('await requireUser(req, res)') < src.indexOf('rateLimited(req, res'));
  check('wrapped in withFailureReporting', /withFailureReporting\(/.test(src));
  check('reuses callerOwnsScope rather than inventing a second ownership check', /callerOwnsScope/.test(src));
  check('reuses the same credit_balances RPCs as generate-ad-image.js', /rpc\/consume_credits/.test(src) && /rpc\/refund_credits/.test(src));
}

delete process.env.GEMINI_API_KEY;

console.log('\n' + (failures === 0 ? 'ALL ASSERTIONS PASSED' : `${failures} FAILED`));
process.exit(failures === 0 ? 0 : 1);
})();
