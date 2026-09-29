/**
 * api/blade-find-owner.js finds a real person's first name for the mail-
 * merge audit workflow's "owner name" column — grounded in a real, cited
 * web search (Perplexity), never a guess. A wrong name in a cold email's
 * greeting ("Hi Mark," to someone who isn't Mark) is worse than no name.
 *
 *   node tests/blade-find-owner/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const requireUserPath = require.resolve(path.join(REPO, 'api/_lib/require-user.js'));
require.cache[requireUserPath] = {
  id: requireUserPath, filename: requireUserPath, loaded: true,
  exports: {
    requireUser: async (req, res) => {
      if (req.headers.authorization) return { id: 'caller-1' };
      res.status(401).json({ error: 'Sign in required.' });
      return null;
    },
  },
};
const rateLimitPath = require.resolve(path.join(REPO, 'api/_lib/rate-limit.js'));
require.cache[rateLimitPath] = {
  id: rateLimitPath, filename: rateLimitPath, loaded: true,
  exports: { rateLimited: () => false },
};

process.env.PERPLEXITY_API_KEY = 'test-key';

const handlerPath = path.join(REPO, 'api/blade-find-owner.js');
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
function mockPerplexity(content) {
  return async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
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
    const res = await call({ businessName: 'ABC Plumbing' }, { noAuth: true });
    check('an unauthenticated call is refused', res.statusCode === 401);
  }

  console.log('\n──── a confidently-found real name is returned with its source ────');
  {
    global.fetch = mockPerplexity(JSON.stringify({ firstName: 'Steve', source: 'https://facebook.com/abcplumbing' }));
    const res = await call({ businessName: 'ABC Plumbing', suburb: 'Dandenong', country: 'Australia' });
    check('the request succeeds', res.statusCode === 200);
    check('the real name comes through', res.body.firstName === 'Steve');
    check('the source is carried through too', res.body.source === 'https://facebook.com/abcplumbing');
  }

  console.log('\n──── an honest "not found" is returned as empty, never a guess ────');
  {
    global.fetch = mockPerplexity(JSON.stringify({ firstName: '', source: '' }));
    const res = await call({ businessName: 'XYZ Plumbing', suburb: 'Noble Park' });
    check('empty firstName is passed through honestly, not defaulted to something', res.body.firstName === '');
  }

  console.log('\n──── a response that ignores the "no guessing" instruction is caught by a shape check ────');
  {
    // The model wrote a sentence instead of a name — this must never reach
    // a real email's greeting as a garbled fragment.
    global.fetch = mockPerplexity(JSON.stringify({ firstName: 'I could not confidently identify the owner', source: '' }));
    const res = await call({ businessName: 'ABC Plumbing' });
    check('a non-name-shaped response is rejected, not passed through as if it were a real name', res.body.firstName === '');
  }

  console.log('\n──── markdown code fences around the JSON are stripped, same as the other Perplexity call sites ────');
  {
    global.fetch = mockPerplexity('```json\n' + JSON.stringify({ firstName: 'Mark', source: 'https://example.com' }) + '\n```');
    const res = await call({ businessName: 'XYZ Plumbing' });
    check('the fenced JSON still parses', res.body.firstName === 'Mark');
  }

  console.log('\n──── a genuine upstream failure is a real error, not silently reported as "nobody found" ────');
  {
    global.fetch = async () => ({ ok: false, status: 500, text: async () => 'upstream down' });
    const res = await call({ businessName: 'ABC Plumbing' });
    check('a 502 is returned, distinguishing "we could not check" from "we checked and found nobody"', res.statusCode === 502);
  }

  console.log('\n──── missing businessName is refused before any Perplexity call ────');
  {
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    const res = await call({ suburb: 'Dandenong' });
    check('a 400 is returned', res.statusCode === 400);
    check('no Perplexity call was made', !called);
  }

  console.log('\n──── Apollo (a real contact database) is tried first when a website is given ────');
  {
    process.env.APOLLO_API_KEY = 'apollo-test-key';
    let perplexityCalled = false;
    global.fetch = async (url) => {
      if (String(url).includes('apollo.io')) {
        return { ok: true, json: async () => ({ people: [{ first_name: 'Dana', name: 'Dana Smith', title: 'Owner', linkedin_url: 'https://linkedin.com/in/danasmith' }] }) };
      }
      perplexityCalled = true;
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"firstName":"","source":""}' } }] }) };
    };
    const res = await call({ businessName: 'ABC Plumbing', website: 'abcplumbing.com' });
    check('an Apollo-sourced name is returned', res.body.firstName === 'Dana');
    check('the source is Apollo\'s own record, not a search result', res.body.source === 'https://linkedin.com/in/danasmith');
    check('Perplexity is never called once Apollo has an answer', !perplexityCalled);
  }

  console.log('\n──── falls back to Perplexity when Apollo has no record for the domain ────');
  {
    global.fetch = async (url) => {
      if (String(url).includes('apollo.io')) return { ok: true, json: async () => ({ people: [] }) };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"firstName":"Steve","source":"https://facebook.com/abc"}' } }] }) };
    };
    const res = await call({ businessName: 'ABC Plumbing', website: 'abcplumbing.com' });
    check('Perplexity\'s answer comes through when Apollo found nobody', res.body.firstName === 'Steve');
    delete process.env.APOLLO_API_KEY;
  }

  console.log('\n──── Apollo is skipped entirely with no website — there is no domain to search ────');
  {
    process.env.APOLLO_API_KEY = 'apollo-test-key';
    let apolloCalled = false;
    global.fetch = async (url) => {
      if (String(url).includes('apollo.io')) { apolloCalled = true; return { ok: true, json: async () => ({ people: [] }) }; }
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"firstName":"","source":""}' } }] }) };
    };
    await call({ businessName: 'No Website Co' });
    check('no Apollo call was made without a website to derive a domain from', !apolloCalled);
    delete process.env.APOLLO_API_KEY;
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
