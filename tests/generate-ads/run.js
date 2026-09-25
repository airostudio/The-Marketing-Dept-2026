/**
 * api/generate-ads.js kept timing out on real ad-variant requests
 * ("The operation was aborted due to timeout") even after Social Studio was
 * changed to generate one platform at a time. Two real bugs, both already
 * fixed once for the identical shape in api/generate-social-posts.js but
 * never carried over here:
 *
 *   1. The upstream Anthropic call used a stale, pre-maxDuration-bump 55s
 *      AbortSignal, left over from before vercel.json's "api/*.js" glob was
 *      raised to 150s — a single platform with several variants/frameworks
 *      and a forced structured tool call can legitimately take longer.
 *   2. It used a single non-streaming fetch for that same forced tool-use
 *      call — the exact shape generate-social-posts.js's own comments
 *      identify as most likely to get killed early by an idle-connection
 *      timeout somewhere in the network path, independent of the abort
 *      budget above.
 *
 * This pins: the timeout is now 145s (not 55s), the request streams SSE and
 * reassembles the forced tool call from it, and a genuine timeout gets a
 * clear, actionable error instead of the raw DOMException message.
 *
 *   node tests/generate-ads/run.js
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

function env() {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  process.env.ANTHROPIC_API_KEY = 'sk-test';
}

/** Encodes a sequence of SSE "data: {...}" frames the way Anthropic streams them. */
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
  const json = JSON.stringify(input);
  return [
    { type: 'message_start', message: { usage: { input_tokens: 500 } } },
    { type: 'content_block_start', content_block: { type: 'tool_use', name: 'submit_ad_variants' } },
    { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: json } },
    { type: 'content_block_stop' },
    { type: 'message_delta', usage: { output_tokens: 900 } },
    { type: 'message_stop' },
  ];
}

/** @param {(url, opts) => Promise<object>} mockAnthropicFetch what the Anthropic call itself resolves to */
function setup(mockAnthropicFetch) {
  const supabasePath = path.join(REPO, 'api/_lib/supabase-rest.js');
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: { sbRest: async (u, k, method, p) => (p.startsWith('/profiles') ? { ok: true, status: 200, data: [{ id: 'user-1', plan: 'growth', role: 'user' }] } : { ok: true, status: 200, data: [] }) },
  };
  delete require.cache[path.join(REPO, 'api/generate-ads.js')];
  global.fetch = async (url, ...rest) => {
    if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1' }) };
    return mockAnthropicFetch(url, ...rest);
  };
  return require(path.join(REPO, 'api/generate-ads.js'));
}

async function call(handler, body) {
  env();
  let status = 200, payload = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(o) { payload = o; return this; }, end() { return this; },
  };
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer t', host: 'app.test', 'x-forwarded-for': '10.7.0.1' },
    body: body || {},
  }, res);
  return { status, body: payload };
}

const BASE_BODY = { platforms: ['LinkedIn'], product: 'A tool', audience: 'Marketers', models: ['AIDA'], variants: 2 };

(async () => {
  console.log('\n──── the upstream timeout is the app-wide 145s budget, not the stale 55s one ────');
  {
    const src = fs.readFileSync(path.join(REPO, 'api/generate-ads.js'), 'utf8');
    check('no hardcoded 55000ms abort remains', !/AbortSignal\.timeout\(55000\)/.test(src));
    check('UPSTREAM_TIMEOUT_MS is defined and used for the abort', /UPSTREAM_TIMEOUT_MS\s*=\s*145000/.test(src) && /AbortSignal\.timeout\(UPSTREAM_TIMEOUT_MS\)/.test(src));
    check('the request streams, matching generate-social-posts.js\'s fix for the same idle-connection risk', /stream:\s*true/.test(src));
  }

  console.log('\n──── a real streamed response produces real variants ────');
  {
    const handler = setup(async () => ({
      ok: true,
      body: sseBody(toolUseEvents({
        campaignStrategyNote: 'Two angles for LinkedIn.',
        variants: [
          { platform: 'LinkedIn', framework: 'AIDA', angleName: 'Angle A', psychologicalTrigger: 'Curiosity', headline: 'H1', body: 'B1', cta: 'Learn More', visualDirection: 'Clean', abHypothesis: 'CTR' },
          { platform: 'LinkedIn', framework: 'AIDA', angleName: 'Angle B', psychologicalTrigger: 'Urgency', headline: 'H2', body: 'B2', cta: 'Sign Up', visualDirection: 'Bold', abHypothesis: 'CVR' },
        ],
      })),
    }));
    const r = await call(handler, BASE_BODY);
    check('succeeds with real, non-fabricated variants from the stream', r.status === 200 && r.body.variants.length === 2);
    check('the strategy note round-trips', r.body.campaignStrategyNote === 'Two angles for LinkedIn.');
    check('usage is captured from the stream events', r.body.usage && r.body.usage.input_tokens === 500 && r.body.usage.output_tokens === 900);
  }

  console.log('\n──── a genuine timeout is reported clearly, not as a raw DOMException ────');
  {
    const handler = setup(async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    });
    const r = await call(handler, BASE_BODY);
    check('a real 504, not a bare 502', r.status === 504);
    check('names the platform and gives actionable advice, not the raw DOMException text', /LinkedIn/.test(r.body.error) && !/DOMException/.test(r.body.error));
  }

  console.log('\n──── a stream that never produces the forced tool call is a clear, transient-labeled error ────');
  {
    const handler = setup(async () => ({ ok: true, body: sseBody([{ type: 'message_start', message: { usage: {} } }, { type: 'message_stop' }]) }));
    const r = await call(handler, BASE_BODY);
    check('a 502 naming it as usually transient', r.status === 502 && /transient/i.test(r.body.error));
  }

  console.log('\n──── an explicit stream error event is surfaced, not swallowed ────');
  {
    const handler = setup(async () => ({ ok: true, body: sseBody([{ type: 'error', error: { message: 'overloaded_error: try again later' } }]) }));
    const r = await call(handler, BASE_BODY);
    check('the real upstream error message is returned', r.status === 502 && /overloaded_error/.test(r.body.error));
  }

  console.log('\n──── malformed tool-call JSON fails clearly instead of throwing an unhandled error ────');
  {
    const handler = setup(async () => ({
      ok: true,
      body: sseBody([
        { type: 'content_block_start', content_block: { type: 'tool_use', name: 'submit_ad_variants' } },
        { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{not valid json' } },
        { type: 'message_stop' },
      ]),
    }));
    const r = await call(handler, BASE_BODY);
    check('a 502 naming malformed output', r.status === 502 && /malformed/i.test(r.body.error));
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
