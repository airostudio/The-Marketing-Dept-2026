/**
 * api/sales-intel-leads.js — admin read/export of the sweep's discovered
 * leads. Admin-only (shared company prospecting list, not per-customer
 * data), read-only (marking sent/replied is Pat's job, not this endpoint's).
 *
 *   node tests/sales-intel-leads/run.js
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
    requireAdmin: async (req, res) => {
      if (!req.headers.authorization) { res.status(401).json({ error: 'Sign in required.' }); return null; }
      if (req.headers.authorization !== 'Bearer admin-token') { res.status(403).json({ error: 'not admin' }); return null; }
      return { userId: 'admin-1', profile: { role: 'admin' } };
    },
  },
};
const rateLimitPath = require.resolve(path.join(REPO, 'api/_lib/rate-limit.js'));
require.cache[rateLimitPath] = { id: rateLimitPath, filename: rateLimitPath, loaded: true, exports: { rateLimited: () => false } };

const LEADS = [
  { place_id: 'p1', business_name: 'ABC Plumbing', suburb: 'Dandenong', state: 'Victoria', email: 'steve@abcplumbing.com.au', website: 'abcplumbing.com.au', website_status: 'outdated', personal_note: 'Mobile layout is difficult to use', owner_first_name: 'Steve', sent: false, replied: false, discovered_at: '2026-09-29T00:00:00Z' },
  { place_id: 'p2', business_name: 'XYZ Plumbing', suburb: 'Noble Park', state: 'Victoria', email: null, website: null, website_status: 'no_website', personal_note: 'Currently relies on Google listing', owner_first_name: null, sent: false, replied: false, discovered_at: '2026-09-29T00:00:00Z' },
];

const sbRestPath = require.resolve(path.join(REPO, 'api/_lib/supabase-rest.js'));
require.cache[sbRestPath] = {
  id: sbRestPath, filename: sbRestPath, loaded: true,
  exports: {
    isUuid: () => true,
    sbRest: async (url, key, method, pathAndQuery) => ({ ok: true, status: 200, data: LEADS }),
  },
};

process.env.SUPABASE_URL = 'https://x.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';

const handlerPath = path.join(REPO, 'api/sales-intel-leads.js');
delete require.cache[require.resolve(handlerPath)];
const handler = require(handlerPath);

function makeRes() {
  const res = { statusCode: 200, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.body = d; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.end = (d) => { res.body = d; return res; };
  return res;
}
async function call(query = {}, opts = {}) {
  const res = makeRes();
  const headers = {};
  if (!opts.noAuth) headers.authorization = opts.token || 'Bearer admin-token';
  await handler({ method: 'GET', headers, query }, res);
  return res;
}

(async () => {
  console.log('\n──── admin-only ────');
  {
    const res1 = await call({}, { noAuth: true });
    check('unauthenticated is refused', res1.statusCode === 401);
    const res2 = await call({}, { token: 'Bearer not-admin' });
    check('a non-admin is refused', res2.statusCode === 403);
  }

  console.log('\n──── JSON listing ────');
  {
    const res = await call({ limit: '50' });
    check('succeeds for an admin', res.statusCode === 200);
    check('returns the leads', res.body.leads.length === 2);
  }

  console.log('\n──── CSV export matches Blade\'s exact mail-merge column order ────');
  {
    const res = await call({ format: 'csv' });
    check('succeeds', res.statusCode === 200);
    check('the header row matches exactly',
      res.body.split('\n')[0] === 'First Name,Business,Suburb,Email,Website,Website Status,Personal Note,Sent,Replied');
    check('a missing website is written as "None"', res.body.includes('No website') && res.body.includes(',None,'));
    check('Sent/Replied reflect the real stored state, not always "No" (this is a review view, not a fresh export)',
      res.body.includes('Steve,ABC Plumbing,Dandenong,steve@abcplumbing.com.au,abcplumbing.com.au,Outdated,Mobile layout is difficult to use,No,No'));
    check('the response is served as a CSV attachment', res.headers['Content-Type'].includes('text/csv'));
  }

  console.log('\n──── read-only: no write verb is accepted ────');
  {
    const res = makeRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer admin-token' }, query: {} }, res);
    check('POST is refused', res.statusCode === 405);
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
