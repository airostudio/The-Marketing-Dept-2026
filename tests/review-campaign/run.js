/**
 * Pat's "Send Anyway" pipeline reported "⚠️ Review failed — Unterminated
 * string in JSON at position 250" — the review step used to run entirely
 * client-side as a freehand text completion (window.ClaudeService.
 * streamResponse), asked to "Respond ONLY with valid JSON" and parsed with a
 * bare regex + JSON.parse(). The prompt echoed the campaign's own
 * subject/HTML back into the model's context and asked it to freehand a
 * JSON blob that might quote that content — nothing forced the model to
 * escape a literal quote or newline it decided to include in a string
 * field, so it eventually produced "almost JSON" and the customer saw a raw
 * parse error instead of a review.
 *
 * api/review-campaign.js moves this server-side and onto callClaudeForJSON's
 * forced tool-call, the same structured-output pattern every other Claude
 * call in this app already uses — this test mocks that helper directly
 * (the same way tests/nancy-content-plan/run.js does) since the point is
 * this endpoint's OWN contract and validation, not Anthropic's streaming
 * wire format.
 *
 *   node tests/review-campaign/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

let claudeResult;
let lastClaudeCall = null;

const requireUserPath = path.join(REPO, 'api/_lib/require-user.js');
require.cache[requireUserPath] = {
  id: requireUserPath, filename: requireUserPath, loaded: true,
  exports: {
    requireUser: async (req, res) => {
      if (req.headers.authorization) return { id: 'user-1' };
      res.status(401).json({ error: 'Sign in required.' });
      return null;
    },
  },
};

const rateLimitPath = path.join(REPO, 'api/_lib/rate-limit.js');
require.cache[rateLimitPath] = {
  id: rateLimitPath, filename: rateLimitPath, loaded: true,
  exports: { rateLimited: () => false },
};

const nancyClaudePath = path.join(REPO, 'api/_lib/nancy-claude.js');
require.cache[nancyClaudePath] = {
  id: nancyClaudePath, filename: nancyClaudePath, loaded: true,
  exports: { callClaudeForJSON: async (opts) => { lastClaudeCall = opts; return claudeResult; } },
};

const handlerPath = path.join(REPO, 'api/review-campaign.js');
delete require.cache[require.resolve(handlerPath)];
const handler = require(handlerPath);

function makeRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.body = d; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}
async function call(body, opts = {}) {
  const res = makeRes();
  const headers = { host: 'app.test' };
  if (!opts.noAuth) headers.authorization = 'Bearer t';
  await handler({ method: 'POST', headers, body }, res);
  return res;
}

(async () => {
  console.log('\n──── requires auth ────');
  {
    const res = await call({ subject: 'Hi', html: '<p>Hi</p>' }, { noAuth: true });
    check('an unauthenticated call is refused', res.statusCode === 401);
  }

  console.log('\n──── a clean approval comes back structured, never freehand-parsed ────');
  {
    claudeResult = { success: true, data: { approved: true, blockers: [], warnings: [], summary: 'Looks good.' } };
    const res = await call({ campaignName: 'Q3 Newsletter', subject: 'Hi', html: '<p>Hi, unsubscribe: {{unsubscribe_url}}</p>', recipients: [{ to: 'a@x.test' }] });
    check('the request succeeds', res.statusCode === 200);
    check('approved comes through', res.body.approved === true);
    check('the summary comes through', res.body.summary === 'Looks good.');
  }

  console.log('\n──── this is exactly the failure the old client-side path had — now it can\'t happen here ────');
  {
    // callClaudeForJSON() itself is what makes "the model produced malformed
    // JSON" impossible (Anthropic's tool-use encodes the JSON, not the
    // model's raw text) — this pins that api/review-campaign.js correctly
    // surfaces callClaudeForJSON's OWN failure reporting rather than doing
    // its own separate JSON.parse that could reintroduce the bug.
    claudeResult = { success: false, error: 'Claude returned malformed structured output. Try again.' };
    const res = await call({ subject: 'Hi', html: '<p>Hi</p>' });
    check('a genuine upstream failure is reported as a clean error, not thrown as an uncaught parse exception', res.statusCode === 502 && res.body.error === 'Claude returned malformed structured output. Try again.');
  }

  console.log('\n──── approved is derived from blockers, not just trusted from the model ────');
  {
    // A model claiming approved:true while still listing a blocker must not
    // be taken at face value — the endpoint computes this itself.
    claudeResult = { success: true, data: { approved: true, blockers: ['Missing unsubscribe link'], warnings: [], summary: 'Mostly fine.' } };
    const res = await call({ subject: 'Hi', html: '<p>Hi</p>' });
    check('approved is forced false when a blocker is present, regardless of what the model said', res.body.approved === false);
  }

  console.log('\n──── malformed/missing arrays from the model don\'t crash the response ────');
  {
    claudeResult = { success: true, data: { approved: false, summary: 'Needs work.' } }; // no blockers/warnings keys at all
    const res = await call({ subject: 'Hi', html: '<p>Hi</p>' });
    check('missing blockers/warnings default to empty arrays, not undefined/crash', Array.isArray(res.body.blockers) && Array.isArray(res.body.warnings));
  }

  console.log('\n──── missing subject/html is refused before any Claude call ────');
  {
    lastClaudeCall = null;
    const res = await call({ recipients: [] });
    check('a 400 is returned', res.statusCode === 400);
    check('no Claude call was made for an incomplete request', lastClaudeCall === null);
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
