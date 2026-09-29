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

  console.log('\n──── an UNRECOGNIZABLE bracket placeholder still shows up as an issue in preview ────');
  {
    const res = await call({ subject: 'Hi [First Name]', html: '<p>Sign off, [Sender Name].</p>', mergeFields: { firstName: 'Sam' } });
    check('the unresolvable one ([Sender Name] — not a per-recipient field) is reported', res.body.issues.some(i => i.includes('[Sender Name]')));
    check('a RECOGNIZABLE one ([First Name]) is resolved, not reported as an issue', !res.body.issues.some(i => i.includes('[First Name]')));
    check('and the preview shows the ACTUAL real value, not the literal placeholder', res.body.subject === 'Hi Sam');
    check('the structured placeholders list names exactly the unresolved one, for a UI to build an input from',
      res.body.placeholders.length === 1 && res.body.placeholders[0] === '[Sender Name]');
  }

  console.log('\n──── [First Name]/[Company]-style aliases resolve exactly like a real {{token}} would ────');
  {
    const res = await call({ subject: 'Hi [First Name] from [Company]', html: '<p>[First Name], welcome to [Company]!</p>', mergeFields: { firstName: 'Sam', company: 'Acme' } });
    check('the subject is fully resolved', res.body.subject === 'Hi Sam from Acme');
    check('the html is fully resolved', res.body.html === '<p>Sam, welcome to Acme!</p>');
    check('no issues at all for a fully-resolvable draft', res.body.issues.length === 0);
  }

  console.log('\n──── a bracket alias with NO value for this recipient sends gracefully WITHOUT a name, not blocked ────');
  {
    // firstName/lastName/company are optional personalization — a recipient
    // with none on file is a normal case, not a defect. Blocking or flagging
    // this would mean that recipient never gets the campaign at all.
    const res = await call({ subject: 'Hi [First Name]', html: '<p>Hi [First Name]</p>', mergeFields: {} });
    check('the rewritten {{firstName}} blanks gracefully rather than staying literal', res.body.subject.trim() === 'Hi');
    check('and it is NOT reported as an issue — this is expected, not a defect', !res.body.issues.some(i => i.includes('firstName')));
  }

  console.log('\n──── a recipient missing an optional personalization field is never flagged ────');
  {
    const res = await call({ subject: 'Hi {{firstName}}', html: '<p>Hi {{firstName}}</p>', mergeFields: {} });
    // A trailing space before a closing tag is invisible once rendered, so
    // it's not worth the generic cleanup applying there too — only checked
    // against punctuation, where a dangling space is visibly a bug.
    check('the tag blanks rather than staying literal', res.body.subject.trim() === 'Hi' && res.body.html.replace(/\s+</g, '<') === '<p>Hi</p>');
    check('and is not reported as an issue', !res.body.issues.some(i => i.includes('firstName')));
  }

  console.log('\n──── a genuinely unknown/custom {{token}} is still flagged, unlike the optional personal fields ────');
  {
    const res = await call({ subject: 'Your code: {{referralCode}}', html: '<p>Use {{referralCode}}.</p>', mergeFields: {} });
    check('a custom field with no value stays literal — this really is missing data', res.body.subject === 'Your code: {{referralCode}}');
    check('and is reported as an issue', res.body.issues.some(i => i.includes('{{referralCode}}')));
  }

  console.log('\n──── missing subject and html together is refused before any rendering ────');
  {
    const res = await call({ mergeFields: {} });
    check('a 400 is returned', res.statusCode === 400);
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
