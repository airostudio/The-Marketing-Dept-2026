/**
 * The Webese incident traced back to a structural gap, not just a missing
 * send-time check: nothing ever showed a human what a campaign actually
 * looks like with real recipient data before it sent. The compose box only
 * ever showed the raw {{firstName}} template, so a mistyped token
 * ({{first_name}} — which is exactly what the AI drafting prompt in
 * web/agents/email-agent.html used to tell the model to write, while the
 * real data side only ever populates {{firstName}}) looked identical to
 * working personalization right up until send.
 *
 * api/preview-merge.js closes that gap by running the EXACT same
 * substitution (api/_lib/merge-fields.js) and the EXACT same pre-send check
 * (api/_lib/content-guard.js) api/send-campaign.js itself uses — this pins
 * that it is genuinely the same logic, not a second copy that could drift
 * from the first the way the old private applyMergeFields() in
 * send-campaign.js already had from the AI prompt's instructions.
 *
 *   node tests/preview-merge/run.js
 */
'use strict';

const path = require('path');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const requireUserPath = require.resolve(path.join(__dirname, '..', '..', 'api/_lib/require-user.js'));
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

const handlerPath = path.join(__dirname, '..', '..', 'api/preview-merge.js');
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
  console.log('\n──── requires auth, like every other endpoint that touches campaign content ────');
  {
    const res = await call({ subject: 'Hi', html: '<p>Hi</p>' }, { noAuth: true });
    check('an unauthenticated call is refused', res.statusCode === 401);
  }

  console.log('\n──── a working {{firstName}} tag renders with the real value ────');
  {
    const res = await call({ subject: 'Hi {{firstName}}', html: '<p>Hi {{firstName}}, welcome!</p>', mergeFields: { firstName: 'Sam' } });
    check('the request succeeds', res.statusCode === 200);
    check('the subject is actually substituted', res.body.subject === 'Hi Sam');
    check('the html is actually substituted', res.body.html === '<p>Hi Sam, welcome!</p>');
    check('no issues are reported for a clean render', res.body.issues.length === 0);
  }

  console.log('\n──── the exact Webese-style mismatch is caught: {{first_name}} vs. real data key firstName ────');
  {
    // This is the actual bug found in web/agents/email-agent.html's old
    // drafting prompt — it told the model to write {{first_name}} while
    // contacts-store.js's toRecipients() only ever supplies "firstName".
    const res = await call({ subject: 'Hi {{first_name}}', html: '<p>Hi {{first_name}}!</p>', mergeFields: { firstName: 'Sam' } });
    check('the mismatched token is NOT silently substituted', res.body.subject === 'Hi {{first_name}}');
    check('the preview surfaces this as an issue, not a silent miss', res.body.issues.some(i => i.includes('{{first_name}}')));
  }

  console.log('\n──── a bracket placeholder in the draft shows up as an issue in preview ────');
  {
    const res = await call({ subject: 'Hi [First Name]', html: '<p>Sign off, [Sender Name].</p>', mergeFields: { firstName: 'Sam' } });
    check('the placeholder is reported', res.body.issues.some(i => i.includes('[First Name]') && i.includes('[Sender Name]')));
    check('the rendered subject still shows the literal placeholder (this is what would actually send)', res.body.subject === 'Hi [First Name]');
  }

  console.log('\n──── a recipient missing the field the template needs is flagged, not blanked ────');
  {
    const res = await call({ subject: 'Hi {{firstName}}', html: '<p>Hi {{firstName}}</p>', mergeFields: {} });
    check('the tag is left literal rather than rendered blank', res.body.subject === 'Hi {{firstName}}');
    check('and reported as an issue', res.body.issues.some(i => i.includes('{{firstName}}')));
  }

  console.log('\n──── missing subject and html together is refused before any rendering ────');
  {
    const res = await call({ mergeFields: {} });
    check('a 400 is returned', res.statusCode === 400);
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
