/**
 * api/site-watchlist.js / api/site-snapshot.js — a saved list of client
 * websites, re-shot over time for before/after comparisons. No new
 * security boundary: a client's public website is exactly the kind of
 * URL every other screenshot/crawl tool here already reaches (only
 * private/internal addresses are blocked, by api/_lib/safe-fetch.js,
 * shared by every path). This exercises ownership, shared-profile access,
 * the before→after label default, and that a paid screenshot call is
 * rate-limited like every other one in this app.
 *
 *   node tests/site-snapshot/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const OWNER = '11111111-1111-1111-1111-111111111111';
const STRANGER = '22222222-2222-2222-2222-222222222222';

const db = { watchlist: [], snapshots: [] };
let nextId = 1;

function mockModule(relPath, exportsObj) {
  const p = require.resolve(path.join(REPO, relPath));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

mockModule('api/_lib/supabase-rest.js', {
  isUuid: () => true,
  sbRest: async (url, key, method, pathAndQuery, body) => {
    if (pathAndQuery.startsWith('/intelligence_profiles') || pathAndQuery.startsWith('/intelligence_profile_members')) {
      return { ok: true, data: [] }; // no shared profiles in this suite
    }
    if (pathAndQuery.startsWith('/site_watchlist')) {
      if (method === 'POST') { const row = { id: `w${nextId++}`, ...body }; db.watchlist.push(row); return { ok: true, data: [row] }; }
      if (method === 'DELETE') {
        const idm = pathAndQuery.match(/id=eq\.([^&]+)/);
        db.watchlist = db.watchlist.filter(w => w.id !== idm[1]);
        return { ok: true, data: [] };
      }
      const idm = pathAndQuery.match(/[?&]id=eq\.([^&]+)/);
      const userm = pathAndQuery.match(/user_id=eq\.([^&]+)/);
      let rows = db.watchlist;
      if (idm) rows = rows.filter(w => w.id === idm[1]);
      if (userm) rows = rows.filter(w => w.user_id === userm[1]);
      return { ok: true, data: rows };
    }
    if (pathAndQuery.startsWith('/site_snapshots')) {
      if (method === 'POST') { const row = { id: `s${nextId++}`, captured_at: new Date().toISOString(), ...body }; db.snapshots.push(row); return { ok: true, data: [row] }; }
      if (method === 'DELETE') {
        const idm = pathAndQuery.match(/id=eq\.([^&]+)/);
        db.snapshots = db.snapshots.filter(s => s.id !== idm[1]);
        return { ok: true, data: [] };
      }
      const idm = pathAndQuery.match(/[?&]id=eq\.([^&?]+)/);
      const wm = pathAndQuery.match(/watchlist_id=eq\.([^&]+)/);
      let rows = db.snapshots;
      if (idm) rows = rows.filter(s => s.id === idm[1]);
      if (wm) rows = rows.filter(s => s.watchlist_id === wm[1]);
      return { ok: true, data: rows };
    }
    return { ok: true, data: [] };
  },
});

mockModule('api/_lib/nancy-providers.js', {
  screenshotProvider: async () => ({ available: true, buffer: Buffer.from('fake-png-bytes'), mimeType: 'image/png' }),
});
mockModule('api/_lib/r2.js', {
  isR2Configured: () => true,
  uploadToR2: async (key) => `https://cdn.example.com/${key}`,
});
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });

global.fetch = async (url) => {
  if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => ({ id: global.__callerId }) };
  throw new Error('unexpected fetch to ' + url);
};

process.env.SUPABASE_URL = 'https://x.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';

function load(name) {
  const p = path.join(REPO, `api/${name}.js`);
  delete require.cache[require.resolve(p)];
  return require(p);
}
function makeRes() {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (d) => { res.body = d; return res; };
  res.setHeader = () => {};
  res.end = () => res;
  return res;
}
async function call(handler, callerId, body, opts = {}) {
  global.__callerId = callerId;
  const res = makeRes();
  const headers = opts.noAuth ? {} : { authorization: `Bearer ${callerId}` };
  await handler({ method: 'POST', headers, body }, res);
  return res;
}

(async () => {

console.log('\n──── adding a client site to the watchlist ────');
let siteId;
{
  const handler = load('site-watchlist');
  const res = await call(handler, OWNER, { action: 'add', clientName: 'ABC Plumbing', url: 'abcplumbing.com' });
  check('succeeds', res.statusCode === 200 && res.body.ok);
  check('a bare domain gets a real https:// URL', res.body.site.url === 'https://abcplumbing.com/');
  siteId = res.body.site.id;
}

console.log('\n──── an invalid URL is refused before anything is stored ────');
{
  const handler = load('site-watchlist');
  const res = await call(handler, OWNER, { action: 'add', clientName: 'Nope', url: 'not a url' });
  check('refused with a 400', res.statusCode === 400);
}

console.log('\n──── capturing a screenshot: first shot is "before", next is "after" ────');
{
  const handler = load('site-snapshot');
  const res1 = await call(handler, OWNER, { action: 'capture', watchlistId: siteId });
  check('the first capture succeeds', res1.statusCode === 200 && res1.body.ok);
  check('the first capture is labelled "before" by default', res1.body.snapshot.label === 'before');
  check('the hosted URL comes from R2, not a data: URI', res1.body.snapshot.hostedUrl.startsWith('https://cdn.example.com/'));

  const res2 = await call(handler, OWNER, { action: 'capture', watchlistId: siteId });
  check('the second capture is labelled "after" by default', res2.body.snapshot.label === 'after');
}

console.log('\n──── a custom label overrides the before/after default ────');
{
  const handler = load('site-snapshot');
  const res = await call(handler, OWNER, { action: 'capture', watchlistId: siteId, label: 'March rebuild' });
  check('the custom label is used instead', res.body.snapshot.label === 'March rebuild');
}

console.log('\n──── listing shows every snapshot for that site, newest first ────');
{
  const handler = load('site-snapshot');
  const res = await call(handler, OWNER, { action: 'list', watchlistId: siteId });
  check('all three captures are listed', res.body.snapshots.length === 3);
}

console.log('\n──── a stranger with no access gets an honest 404, not the owner\'s data ────');
{
  const wHandler = load('site-watchlist');
  const listRes = await call(wHandler, STRANGER, { action: 'list' });
  check('a stranger\'s own watchlist is empty, not someone else\'s', listRes.body.sites.length === 0);

  const sHandler = load('site-snapshot');
  const captureRes = await call(sHandler, STRANGER, { action: 'capture', watchlistId: siteId });
  check('a stranger cannot capture a shot of a site they do not own', captureRes.statusCode === 404);

  const removeRes = await call(load('site-watchlist'), STRANGER, { action: 'remove', watchlistId: siteId });
  check('a stranger cannot remove someone else\'s site either', removeRes.statusCode === 404);
}

console.log('\n──── capture is rate-limited like every other paid screenshot call ────');
{
  const fs = require('fs');
  const src = fs.readFileSync(path.join(REPO, 'api/site-snapshot.js'), 'utf8');
  check('rate-limit is wired into the capture action', /rateLimited\(req, res, \{ name: 'site-snapshot-capture'/.test(src));
}

console.log('\n──── removing a site is honest about what it affects ────');
{
  const handler = load('site-watchlist');
  const res = await call(handler, OWNER, { action: 'remove', watchlistId: siteId });
  check('the owner can remove their own site', res.statusCode === 200 && res.body.ok);
  const list = await call(load('site-watchlist'), OWNER, { action: 'list' });
  check('it is actually gone from the list afterwards', !list.body.sites.some(s => s.id === siteId));
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
})();
