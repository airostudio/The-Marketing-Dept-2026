/**
 * api/openai.js's request body has broken twice now for the same reason:
 * OpenAI's current model line (gpt-5.6-luna, the default) rejects parameters
 * this file used to send unconditionally.
 *
 *   1. max_tokens -> renamed to max_completion_tokens (fixed already).
 *   2. temperature: 0.7 -> "Unsupported value: 'temperature' does not
 *      support 0.7 with this model. Only the default (1) value is
 *      supported." Every caller of the Outreach Generator (and anything
 *      else routed through this endpoint) got this verbatim.
 *
 * The fix both times was the same shape: stop sending a parameter this
 * model line only accepts at its default. This pins the request body so a
 * future edit can't silently reintroduce either one.
 *
 *   node tests/openai-request-shape/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

function env() {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  process.env.OPENAI_API_KEY = 'sk-test';
}

async function callEndpoint(handler, body) {
  env();
  let status = 200, payload = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(o) { payload = o; return this; }, end() { return this; },
    write() {},
  };
  const headers = { authorization: 'Bearer good-token' };
  await handler({ method: 'POST', headers, query: {}, body: body || {} }, res);
  return { status, body: payload };
}

console.log('\n──── the request OpenAI actually receives never carries the two known-bad fields ────');
(async () => {
  let capturedOpenAIBody = null;

  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/auth/v1/user')) {
      return { ok: true, status: 200, json: async () => ({ id: 'user-1', email: 'a@b.com' }) };
    }
    if (u.includes('/rest/v1/profiles')) {
      const rows = [{ id: 'user-1', plan: 'growth', role: 'user' }];
      return { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows) };
    }
    if (u.includes('api.openai.com')) {
      capturedOpenAIBody = JSON.parse(opts.body);
      const payload = { choices: [{ message: { content: 'Hi there' }, finish_reason: 'stop' }] };
      return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
    }
    throw new Error(`unexpected fetch to ${u}`);
  };

  delete require.cache[require.resolve(path.join(REPO, 'api/openai.js'))];
  const handler = require(path.join(REPO, 'api/openai.js'));

  const { status, body } = await callEndpoint(handler, {
    messages: [{ role: 'user', content: 'Write an outreach email.' }],
    stream: false,
  });

  check('the call succeeds (200)', status === 200);
  check('OpenAI was actually called', !!capturedOpenAIBody);
  check('temperature is never sent — this model line only accepts its default',
    capturedOpenAIBody && !Object.prototype.hasOwnProperty.call(capturedOpenAIBody, 'temperature'));
  check('max_completion_tokens is sent (not the old max_tokens name)',
    capturedOpenAIBody && capturedOpenAIBody.max_completion_tokens === 4096 &&
    !Object.prototype.hasOwnProperty.call(capturedOpenAIBody, 'max_tokens'));
  check('the response text reached the caller', body && body.text === 'Hi there');

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
