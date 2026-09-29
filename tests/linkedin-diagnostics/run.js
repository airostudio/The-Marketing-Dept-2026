/**
 * LinkedIn's own publish error ("Data Processing Exception ... [/author]")
 * fires identically whether the configured org id is wrong or the token
 * lacks w_organization_social — there is no way to tell which from that
 * error alone, so fixing it meant guessing which cause to chase (a bad org
 * id, or a full OAuth re-run) with no way to confirm before trying.
 *
 * api/diagnostics.js's admin system-checks route now makes a live call to
 * LinkedIn's own organizationAcls (for the Company Page token) and userinfo
 * (for the personal-profile token) to answer this directly instead of
 * guessing. This pins that behavior.
 *
 *   node tests/linkedin-diagnostics/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');

let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

function setup({ role = 'admin', mockFetch } = {}) {
  const supabasePath = path.join(REPO, 'api/_lib/supabase-rest.js');
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: { sbRest: async (u, k, method, p) => (p.startsWith('/profiles') ? { ok: true, status: 200, data: [{ id: 'user-1', plan: 'growth', role }] } : { ok: true, status: 200, data: [] }) },
  };
  delete require.cache[path.join(REPO, 'api/diagnostics.js')];
  global.fetch = async (url, opts) => {
    if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1' }) };
    return mockFetch(url, opts);
  };
  return require(path.join(REPO, 'api/diagnostics.js'));
}

async function call(handler) {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  let status = 200, payload = null;
  const res = {
    setHeader() {}, status(c) { status = c; return this; },
    json(o) { payload = o; return this; }, end() { return this; },
  };
  await handler({
    method: 'GET',
    headers: { authorization: 'Bearer t', host: 'app.test', 'x-forwarded-for': '10.11.0.1' },
    url: '/api/diagnostics',
  }, res);
  return { status, body: payload };
}

function orgAclsResponse(orgs) {
  return { ok: true, json: async () => ({ elements: orgs.map(o => ({ 'organization~': { id: o.id, localizedName: o.name } })) }) };
}

(async () => {
  console.log('\n──── the configured org URN is confirmed against a real ACL list, not assumed ────');
  {
    process.env.LINKEDIN_ACCESS_TOKEN = 'tok';
    process.env.LINKEDIN_ORGANIZATION_URN = 'urn:li:organization:117934311';
    delete process.env.LINKEDIN_PERSON_ACCESS_TOKEN;
    delete process.env.LINKEDIN_PERSON_URN;

    const handler = setup({
      mockFetch: async (url) => {
        if (String(url).includes('organizationAcls')) return orgAclsResponse([{ id: '117934311', name: 'Audema' }]);
        throw new Error('unexpected fetch ' + url);
      },
    });
    const r = await call(handler);
    const c = r.body.checks.find(x => x.id === 'linkedin_org');
    check('reports ok when the configured org is one the token administers', c.status === 'ok');
    check('names the real page in the message', /Audema/.test(c.message));
  }

  console.log('\n──── a token that cannot administer the configured org names what it CAN post as ────');
  {
    const handler = setup({
      mockFetch: async (url) => {
        if (String(url).includes('organizationAcls')) return orgAclsResponse([{ id: '999999', name: 'Some Other Page' }]);
        throw new Error('unexpected fetch ' + url);
      },
    });
    const r = await call(handler);
    const c = r.body.checks.find(x => x.id === 'linkedin_org');
    check('flags this as a real error, not a soft warning', c.status === 'error');
    check('names the org id that is actually wrong', /117934311/.test(c.message));
    check('names the org(s) the token really can post as', /999999/.test(c.message) && /Some Other Page/.test(c.message));
  }

  console.log('\n──── a token with zero administered orgs is diagnosed as an authorization problem ────');
  {
    const handler = setup({
      mockFetch: async (url) => {
        if (String(url).includes('organizationAcls')) return orgAclsResponse([]);
        throw new Error('unexpected fetch ' + url);
      },
    });
    const r = await call(handler);
    const c = r.body.checks.find(x => x.id === 'linkedin_org');
    check('a zero-org token is a real error', c.status === 'error');
    check('tells the operator to re-run OAuth as a real page admin', /re-run the OAuth/i.test(c.message) && /admin/i.test(c.message));
  }

  console.log('\n──── an expired/invalid token is distinguished from a wrong-org token ────');
  {
    const handler = setup({
      mockFetch: async (url) => {
        if (String(url).includes('organizationAcls')) return { ok: false, status: 401, json: async () => ({}) };
        throw new Error('unexpected fetch ' + url);
      },
    });
    const r = await call(handler);
    const c = r.body.checks.find(x => x.id === 'linkedin_org');
    check('a 401 is reported as expired/invalid, not a wrong-org message', /expired or invalid/i.test(c.message));
  }

  console.log('\n──── missing Community Management API access (403) is named specifically ────');
  {
    const handler = setup({
      mockFetch: async (url) => {
        if (String(url).includes('organizationAcls')) return { ok: false, status: 403, json: async () => ({}) };
        throw new Error('unexpected fetch ' + url);
      },
    });
    const r = await call(handler);
    const c = r.body.checks.find(x => x.id === 'linkedin_org');
    check('names the likely real cause instead of a bare 403', /Community Management API/.test(c.message));
  }

  console.log('\n──── the personal-profile token is checked against who it actually belongs to ────');
  {
    process.env.LINKEDIN_PERSON_ACCESS_TOKEN = 'ptok';
    process.env.LINKEDIN_PERSON_URN = 'urn:li:person:WRONGID';
    const handler = setup({
      mockFetch: async (url) => {
        if (String(url).includes('organizationAcls')) return orgAclsResponse([{ id: '117934311', name: 'Audema' }]);
        if (String(url).includes('userinfo')) return { ok: true, json: async () => ({ sub: 'realid123', name: 'Jane Founder' }) };
        throw new Error('unexpected fetch ' + url);
      },
    });
    const r = await call(handler);
    const c = r.body.checks.find(x => x.id === 'linkedin_person');
    check('a mismatched configured URN is flagged as an error', c.status === 'error');
    check('names the real URN to fix it to', /urn:li:person:realid123/.test(c.message));

    process.env.LINKEDIN_PERSON_URN = 'urn:li:person:realid123';
    const handler2 = setup({
      mockFetch: async (url) => {
        if (String(url).includes('organizationAcls')) return orgAclsResponse([{ id: '117934311', name: 'Audema' }]);
        if (String(url).includes('userinfo')) return { ok: true, json: async () => ({ sub: 'realid123', name: 'Jane Founder' }) };
        throw new Error('unexpected fetch ' + url);
      },
    });
    const r2 = await call(handler2);
    const c2 = r2.body.checks.find(x => x.id === 'linkedin_person');
    check('a matching configured URN reports ok', c2.status === 'ok' && /Jane Founder/.test(c2.message));
  }

  console.log('\n──── neither check runs a live call when the env vars are simply not set ────');
  {
    delete process.env.LINKEDIN_ACCESS_TOKEN;
    delete process.env.LINKEDIN_ORGANIZATION_URN;
    delete process.env.LINKEDIN_PERSON_ACCESS_TOKEN;
    delete process.env.LINKEDIN_PERSON_URN;
    let fetchCalled = false;
    const handler = setup({ mockFetch: async () => { fetchCalled = true; throw new Error('should not be called'); } });
    const r = await call(handler);
    const org = r.body.checks.find(x => x.id === 'linkedin_org');
    const person = r.body.checks.find(x => x.id === 'linkedin_person');
    check('org check reports unconfigured, not a fetch attempt', org.status === 'warn' && !fetchCalled);
    check('person check reports skipped, not a fetch attempt', person.status === 'skipped' && !fetchCalled);
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
