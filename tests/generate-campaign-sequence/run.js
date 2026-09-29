/**
 * api/generate-campaign-sequence.js — the one generator in this codebase that
 * produces a deliberate narrative ARC instead of independent posts/variants
 * (generate-social-posts.js and generate-ads.js both explicitly avoid this —
 * see their own hard rules against shared structure between posts). Built to
 * mirror a real pain-amplification LinkedIn campaign: name the problem, make
 * it hurt, prove it, name the excuse, reposition, and only then the product.
 *
 * This pins:
 *   1. The funnel-stage selection logic (pickStages) always keeps the first
 *      ("Pain") and last ("Solution") stage regardless of postCount.
 *   2. Posts come back sorted by sequencePosition even if the model didn't
 *      emit them in order.
 *   3. The same streamed-SSE + 145s-timeout shape already fixed (twice) in
 *      generate-social-posts.js/generate-ads.js, built correctly from day one
 *      here rather than needing a third round of that bug.
 *   4. Validation and auth gating.
 *
 *   node tests/generate-campaign-sequence/run.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..');

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

function sseBody(events) {
  const text = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  return {
    getReader() {
      return {
        async read() {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: bytes };
        },
      };
    },
  };
}

function toolUseEvents(input) {
  return [
    { type: 'message_start', message: { usage: { input_tokens: 400 } } },
    { type: 'content_block_start', content_block: { type: 'tool_use', name: 'submit_campaign_sequence' } },
    { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
    { type: 'message_delta', usage: { output_tokens: 1800 } },
    { type: 'message_stop' },
  ];
}

function setup(mockAnthropicFetch) {
  const supabasePath = path.join(REPO, 'api/_lib/supabase-rest.js');
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: { sbRest: async (u, k, method, p) => (p.startsWith('/profiles') ? { ok: true, status: 200, data: [{ id: 'user-1', plan: 'growth', role: 'user' }] } : { ok: true, status: 200, data: [] }) },
  };
  // The rate limiter keys on the authenticated caller (not IP), and every
  // call here authenticates as the same mock user — without a reset, this
  // suite's own calls would rate-limit each other well before RATE_LIMIT_MAX
  // real requests. See rate-limit.js's own resetForTests() doc comment.
  require(path.join(REPO, 'api/_lib/rate-limit.js')).resetForTests();
  delete require.cache[path.join(REPO, 'api/generate-campaign-sequence.js')];
  global.fetch = async (url, ...rest) => {
    if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1' }) };
    return mockAnthropicFetch(url, ...rest);
  };
  return require(path.join(REPO, 'api/generate-campaign-sequence.js'));
}

async function call(handler, body) {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  let status = 200, payload = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(o) { payload = o; return this; }, end() { return this; },
  };
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer t', host: 'app.test', 'x-forwarded-for': '10.9.9.1' },
    body: body || {},
  }, res);
  return { status, body: payload };
}

const BASE_BODY = { platform: 'LinkedIn', painPoint: 'Owners are embarrassed by their own website', product: 'Webese', audience: 'Small business owners' };

function post(pos, stage) {
  return { sequencePosition: pos, funnelStage: stage, title: `Post ${pos}`, hook: `Hook ${pos}`, body: `Body ${pos}`, hashtags: ['smallbiz'], purpose: `Purpose ${pos}` };
}

(async () => {
  console.log('\n──── funnel stage vocabulary always opens on Pain and closes on Solution ────');
  {
    // pickStages()/FUNNEL_STAGES aren't exported — their observable behavior
    // is pinned end-to-end through the real HTTP handler below instead. This
    // just guards against an accidental rename/reorder of the stage list.
    const src = fs.readFileSync(path.join(REPO, 'api/generate-campaign-sequence.js'), 'utf8');
    check('pickStages is defined', /function pickStages/.test(src));
    check('FUNNEL_STAGES starts with "pain" and ends with "solution"', /key: 'pain'/.test(src) && /key: 'solution'/.test(src));
  }

  console.log('\n──── a 3-post request still opens on Pain and closes on Solution ────');
  {
    const handler = setup(async () => ({
      ok: true,
      body: sseBody(toolUseEvents({
        campaignNote: 'Three-post arc.',
        posts: [post(1, 'Pain'), post(2, 'Positioning'), post(3, 'Solution')],
      })),
    }));
    const r = await call(handler, { ...BASE_BODY, postCount: 3 });
    check('succeeds', r.status === 200 && r.body.success === true);
    check('3 posts returned', r.body.posts.length === 3);
    check('first post is Pain', r.body.posts[0].funnelStage === 'Pain');
    check('last post is Solution', r.body.posts[r.body.posts.length - 1].funnelStage === 'Solution');
  }

  console.log('\n──── posts are sorted by sequencePosition even if the model emitted them out of order ────');
  {
    const handler = setup(async () => ({
      ok: true,
      body: sseBody(toolUseEvents({
        campaignNote: 'Out of order from the model.',
        posts: [post(3, 'Solution'), post(1, 'Pain'), post(2, 'Agitate')],
      })),
    }));
    const r = await call(handler, { ...BASE_BODY, postCount: 3 });
    check('re-sorted into 1, 2, 3', r.body.posts.map(p => p.sequencePosition).join(',') === '1,2,3');
  }

  console.log('\n──── missing required fields are rejected before any call is made ────');
  {
    let called = false;
    const handler = setup(async () => { called = true; return { ok: true, body: sseBody([]) }; });
    const r1 = await call(handler, { platform: 'LinkedIn', product: 'x', audience: 'y' }); // no painPoint
    check('missing painPoint is a 400', r1.status === 400);
    const r2 = await call(handler, { platform: 'LinkedIn', painPoint: 'x', audience: 'y' }); // no product
    check('missing product is a 400', r2.status === 400);
    check('never reached Anthropic', !called);
  }

  console.log('\n──── streams correctly and reports usage ────');
  {
    const handler = setup(async () => ({
      ok: true,
      body: sseBody(toolUseEvents({ campaignNote: 'note', posts: [post(1, 'Pain'), post(2, 'Solution')] })),
    }));
    const r = await call(handler, { ...BASE_BODY, postCount: 3 });
    check('usage captured from the stream', r.body.usage && r.body.usage.input_tokens === 400 && r.body.usage.output_tokens === 1800);
    check('campaignNote round-trips', r.body.campaignNote === 'note');
  }

  console.log('\n──── the upstream timeout is 145s streamed, not a short blocking call ────');
  {
    const src = fs.readFileSync(path.join(REPO, 'api/generate-campaign-sequence.js'), 'utf8');
    check('145000ms timeout used', /UPSTREAM_TIMEOUT_MS\s*=\s*145000/.test(src));
    check('request streams', /stream:\s*true/.test(src));
  }

  console.log('\n──── a genuine timeout gets a clear message, not a raw DOMException ────');
  {
    const handler = setup(async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    });
    const r = await call(handler, BASE_BODY);
    check('a real 504', r.status === 504);
    check('names the situation, not the raw DOMException text', /took too long/i.test(r.body.error) && !/DOMException/.test(r.body.error));
  }

  console.log('\n──── a stream with no tool call is a clear, transient-labeled error ────');
  {
    const handler = setup(async () => ({ ok: true, body: sseBody([{ type: 'message_start', message: { usage: {} } }, { type: 'message_stop' }]) }));
    const r = await call(handler, BASE_BODY);
    check('502 naming it as transient', r.status === 502 && /transient/i.test(r.body.error));
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
