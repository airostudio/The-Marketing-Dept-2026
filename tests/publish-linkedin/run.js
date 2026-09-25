/**
 * LinkedIn's own API returned:
 *   "Field Value validation failed in REQUEST_BODY: Data Processing
 *    Exception while processing fields [/author]"
 * — LinkedIn's generic catch-all for "the author field could not be
 * resolved to something this token may post as", with no hint which of
 * several real causes it is. api/publish-social-post.js's publishLinkedIn()
 * now (1) trims LINKEDIN_ORGANIZATION_URN before using it, since a stray
 * trailing newline/space from copy-pasting the env var reads as present but
 * fails this exact validation, and (2) appends an actionable explanation
 * naming each real cause (malformed URN vs. a correctly-formatted URN that
 * points at the wrong page or lacks admin/scope permission) instead of
 * leaving the raw opaque LinkedIn sentence as the only thing shown.
 *
 *   node tests/publish-linkedin/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const AUTHOR_ERROR = 'Field Value validation failed in REQUEST_BODY: Data Processing Exception while processing fields [/author]';

function setup(orgUrn, mockLinkedInFetch) {
  process.env.LINKEDIN_ACCESS_TOKEN = 'token';
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  if (orgUrn === undefined) delete process.env.LINKEDIN_ORGANIZATION_URN;
  else process.env.LINKEDIN_ORGANIZATION_URN = orgUrn;
  global.fetch = mockLinkedInFetch;

  // require-user.js destructures sbRest at its own module-load time, so the
  // mock has to be in require.cache BEFORE require-user.js (and therefore
  // publish-social-post.js) is (re-)required, not after.
  const supabasePath = path.join(REPO, 'api/_lib/supabase-rest.js');
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: { sbRest: async () => ({ ok: true, status: 200, data: [{ id: 'user-1', plan: 'growth', role: 'user' }] }) },
  };
  delete require.cache[path.join(REPO, 'api/_lib/require-user.js')];
  delete require.cache[path.join(REPO, 'api/publish-social-post.js')];
  return require(path.join(REPO, 'api/publish-social-post.js'));
}

function fakeReqRes(reqBody) {
  const result = { status: 200, body: null };
  const res = {
    setHeader() {}, status(c) { result.status = c; return this; },
    json(o) { result.body = o; return this; }, end() { return this; },
  };
  const req = {
    method: 'POST',
    headers: { authorization: 'Bearer t', host: 'app.test', 'x-forwarded-for': '10.8.0.1' },
    body: reqBody || {},
  };
  return { req, res, result };
}

(async () => {
  console.log('\n──── a trailing-whitespace URN is trimmed before it ever reaches LinkedIn ────');
  {
    let capturedAuthor = null;
    const handler = setup('urn:li:organization:12345678\n', async (url, opts) => {
      if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1' }) };
      const body = JSON.parse(opts.body);
      capturedAuthor = body.author;
      return { ok: true, headers: { get: () => 'urn:li:share:999' }, json: async () => ({}) };
    });
    const { req, res, result } = fakeReqRes({ platform: 'LinkedIn', body: 'Hello world' });
    await handler(req, res);
    const { status, body } = result;
    check('the whitespace never reached the request body', capturedAuthor === 'urn:li:organization:12345678');
    check('publish still succeeds', status === 200 && body.success === true);
  }

  console.log('\n──── a malformed URN is diagnosed by name, not left as a bare LinkedIn sentence ────');
  {
    const handler = setup('12345678', async (url) => {
      if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1' }) };
      return { ok: false, status: 422, headers: { get: () => null }, json: async () => ({ message: AUTHOR_ERROR }) };
    });
    const { req, res, result } = fakeReqRes({ platform: 'LinkedIn', body: 'Hello world' });
    await handler(req, res);
    const { status, body } = result;
    check('reports failed, not a crash', status === 200 && body.success === false && body.status === 'failed');
    check('names the exact bad value', body.error.includes('"12345678"'));
    check('explains the required shape', /urn:li:organization:<numeric id>/.test(body.error));
    check('the original LinkedIn message is preserved too', body.error.includes(AUTHOR_ERROR));
  }

  console.log('\n──── a correctly-formatted URN that still fails explains permission/scope causes ────');
  {
    const handler = setup('urn:li:organization:87654321', async (url) => {
      if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1' }) };
      return { ok: false, status: 422, headers: { get: () => null }, json: async () => ({ message: AUTHOR_ERROR }) };
    });
    const { req, res, result } = fakeReqRes({ platform: 'LinkedIn', body: 'Hello world' });
    await handler(req, res);
    const { body } = result;
    check('does not claim the URN is malformed when it is not', !/is not a valid organization URN/.test(body.error));
    check('explains it could be the wrong page, missing admin rights, or missing scope',
      /not a real Company Page|not an admin|w_organization_social/.test(body.error));
  }

  console.log('\n──── an unrelated LinkedIn error is passed through unchanged ────');
  {
    const handler = setup('urn:li:organization:87654321', async (url) => {
      if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1' }) };
      return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ message: 'Rate limit exceeded' }) };
    });
    const { req, res, result } = fakeReqRes({ platform: 'LinkedIn', body: 'Hello world' });
    await handler(req, res);
    const { body } = result;
    check('a non-/author error is returned as-is, no invented explanation appended', body.error === 'Rate limit exceeded');
  }

  console.log('\n──── missing credentials still report not_connected, not a validation error ────');
  {
    const handler = setup(undefined, async (url) => {
      if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1' }) };
      throw new Error('should not reach LinkedIn when credentials are missing');
    });
    const { req, res, result } = fakeReqRes({ platform: 'LinkedIn', body: 'Hello world' });
    await handler(req, res);
    const { body } = result;
    check('reports not_connected and names the missing env vars', body.status === 'not_connected' && /LINKEDIN_ORGANIZATION_URN/.test(body.error));
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
