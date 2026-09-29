/**
 * When Scotty blocks a campaign, it should try to fix what it safely can
 * and ask for what it genuinely can't — never invent a fact to make a
 * blocker disappear. This pins api/fix-campaign.js's OWN contract
 * (validation, response shaping, never claiming a fix that wasn't made);
 * the "safe to rewrite vs. must ask" line itself is enforced by the prompt,
 * which is a model behavior, not something a unit test can verify — this
 * mocks callClaudeForJSON directly, the same way tests/review-campaign and
 * tests/nancy-content-plan do.
 *
 *   node tests/fix-campaign/run.js
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

const handlerPath = path.join(REPO, 'api/fix-campaign.js');
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
    const res = await call({ subject: 'Hi', html: '<p>Hi</p>', blockers: ['x'] }, { noAuth: true });
    check('an unauthenticated call is refused', res.statusCode === 401);
  }

  console.log('\n──── a rewrite Scotty is confident about comes back as fixed copy ────');
  {
    claudeResult = {
      success: true,
      data: {
        fixedSubject: 'Save time on invoicing',
        fixedHtml: '<p>Save time on invoicing with our tool.</p>',
        fixedText: '',
        resolvedBlockers: ['Spam-trigger phrasing: "ACT NOW!!!"'],
        questions: [],
      },
    };
    const res = await call({
      subject: 'ACT NOW!!! Save time on invoicing',
      html: '<p>ACT NOW!!! Save time on invoicing with our tool.</p>',
      blockers: ['Spam-trigger phrasing: "ACT NOW!!!"'],
    });
    check('the request succeeds', res.statusCode === 200);
    check('the fixed subject comes through', res.body.fixedSubject === 'Save time on invoicing');
    check('the resolved blocker is named', res.body.resolvedBlockers[0] === 'Spam-trigger phrasing: "ACT NOW!!!"');
    check('no questions when everything was fixable', res.body.questions.length === 0);
  }

  console.log('\n──── something needing a real fact comes back as a question, with an exact findable snippet ────');
  {
    claudeResult = {
      success: true,
      data: {
        fixedSubject: 'Hi',
        fixedHtml: '<p>Hi</p>',
        fixedText: '',
        resolvedBlockers: [],
        questions: [{ snippet: '[Try Free →]', question: 'What URL should the CTA button link to?' }],
      },
    };
    const res = await call({ subject: 'Hi', html: '<p><a href="[Try Free →]">Go</a></p>', blockers: ['Broken/placeholder link'] });
    check('the question is returned', res.body.questions.length === 1);
    check('the snippet is the exact findable text, not a paraphrase', res.body.questions[0].snippet === '[Try Free →]');
    check('the question is specific, not generic', /URL/.test(res.body.questions[0].question));
  }

  console.log('\n──── malformed questions from the model (missing question text) are filtered, not passed through broken ────');
  {
    claudeResult = {
      success: true,
      data: {
        fixedSubject: 'Hi', fixedHtml: '<p>Hi</p>', fixedText: '', resolvedBlockers: [],
        questions: [{ snippet: 'x', question: '' }, { snippet: 'y', question: 'A real question?' }],
      },
    };
    const res = await call({ subject: 'Hi', html: '<p>Hi</p>', blockers: ['something'] });
    check('the empty-question entry is dropped', res.body.questions.length === 1 && res.body.questions[0].question === 'A real question?');
  }

  console.log('\n──── a genuine upstream failure is a clean error, not a thrown parse exception ────');
  {
    claudeResult = { success: false, error: 'Claude returned malformed structured output. Try again.' };
    const res = await call({ subject: 'Hi', html: '<p>Hi</p>', blockers: ['x'] });
    check('a 502 is returned with the real error', res.statusCode === 502 && res.body.error === 'Claude returned malformed structured output. Try again.');
  }

  console.log('\n──── missing required fields are refused before any Claude call ────');
  {
    lastClaudeCall = null;
    let res = await call({ html: '<p>Hi</p>', blockers: ['x'] });
    check('missing subject is refused', res.statusCode === 400);
    res = await call({ subject: 'Hi', html: '<p>Hi</p>', blockers: [] });
    check('an empty blockers array is refused — nothing to fix', res.statusCode === 400);
    check('no Claude call was made for either invalid request', lastClaudeCall === null);
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
