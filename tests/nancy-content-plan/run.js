/**
 * A day's content plan came back {success:true} with no matching post, and
 * three steps downstream — after nancy-agent.html forwarded `posts[0]`
 * (undefined) into nancy-render-week.js — the customer saw a bare "post is
 * required" 400 with no way to tell it started as a missing day 4.
 *
 * callClaudeForJSON() only guarantees its JSON parsed, not that it matches
 * the tool schema's own required shape (Anthropic's tool_choice is a strong
 * steer, not a server-enforced contract) — so api/nancy-content-plan.js must
 * check the shape itself before calling it a success.
 *
 *   node tests/nancy-content-plan/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

// ── Fake the two things nancy-content-plan.js talks to ─────────────────────
let claudeResult;

const requireUserPath = path.join(REPO, 'api/_lib/require-user.js');
require.cache[requireUserPath] = {
  id: requireUserPath, filename: requireUserPath, loaded: true,
  exports: { requireUser: async () => ({ userId: 'user-1', profile: {} }) },
};

const rateLimitPath = path.join(REPO, 'api/_lib/rate-limit.js');
require.cache[rateLimitPath] = {
  id: rateLimitPath, filename: rateLimitPath, loaded: true,
  exports: { rateLimited: () => false },
};

const nancyClaudePath = path.join(REPO, 'api/_lib/nancy-claude.js');
require.cache[nancyClaudePath] = {
  id: nancyClaudePath, filename: nancyClaudePath, loaded: true,
  exports: { callClaudeForJSON: async () => claudeResult },
};

let reported = [];
const reportFailurePath = path.join(REPO, 'api/_lib/report-failure.js');
require.cache[reportFailurePath] = {
  id: reportFailurePath, filename: reportFailurePath, loaded: true,
  exports: {
    withFailureReporting: (name, handler) => handler,
    reportFailureAsync: (detail) => { reported.push(detail); },
  },
};

const handler = require(path.join(REPO, 'api/nancy-content-plan.js'));

function fakeReqRes(body) {
  let sent = null;
  const res = {
    setHeader() {},
    status(c) { sent = { code: c }; return this; },
    json(o) { sent = sent || { code: 200 }; sent.body = o; return this; },
  };
  const req = { method: 'POST', headers: {}, body };
  return { req, res, get sent() { return sent; } };
}

const baseBody = {
  businessProfile: { business_name: 'Test Co' },
  strategy: { content_opportunities: [] },
  dayRange: [4, 4],
};

async function run() {
  console.log('\n──── a day with no matching post is not "success" ────');

  // Claude's tool call parsed, but the posts array is missing entirely.
  claudeResult = { success: true, data: {} };
  let r = fakeReqRes(baseBody);
  await handler(r.req, r.res);
  check('an entirely missing posts array is refused, not reported as success',
    r.sent.code === 502 && r.sent.body.success === false);
  check('the error names the day that failed', /day 4/i.test(r.sent.body.error));
  check('it is reported to the admin failure console', reported.length === 1);

  reported = [];
  console.log('\n──── an empty posts array is the same failure, not an empty success ────');
  claudeResult = { success: true, data: { posts: [] } };
  r = fakeReqRes(baseBody);
  await handler(r.req, r.res);
  check('an empty posts array is refused', r.sent.code === 502 && r.sent.body.success === false);

  reported = [];
  console.log('\n──── a post for the wrong day does not silently pass ────');
  claudeResult = { success: true, data: { posts: [{ day: 5, objective: 'Infographic', content_pillar: 'x', format: 'Single graphic', hook: 'h', slide_headline: 's', caption: 'c', cta: 'c', visual_direction: 'v', uses_user_photo: false, hashtags: [] }] } };
  r = fakeReqRes(baseBody);
  await handler(r.req, r.res);
  check('a post whose day does not match the request is refused, not forwarded',
    r.sent.code === 502 && r.sent.body.success === false);

  reported = [];
  console.log('\n──── a genuinely valid post still succeeds ────');
  claudeResult = { success: true, data: { posts: [{ day: 4, objective: 'Problem Awareness', content_pillar: 'x', format: 'Single graphic', hook: 'h', slide_headline: 's', caption: 'c', cta: 'c', visual_direction: 'v', uses_user_photo: false, hashtags: [] }] } };
  r = fakeReqRes(baseBody);
  await handler(r.req, r.res);
  check('a real, matching post is accepted', r.sent.code === 200 && r.sent.body.success === true);
  check('and returned to the caller', r.sent.body.posts.length === 1 && r.sent.body.posts[0].day === 4);
  check('nothing was reported for a genuine success', reported.length === 0);

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
}

run();
