/**
 * api/mission-blade.js + api/mission-artifacts.js — a Scotty mission running
 * Blade for real, and the one human approval that turns its output into
 * something. Covers: bad input is refused before anything is spent, shared-
 * profile permissions (viewers can look, only editors can build/decide),
 * enrichment runs in bounded batches and the artifact only becomes
 * approvable once the list is complete, and approval imports exactly what it
 * should — real emails only, existing contacts untouched, provenance recorded
 * honestly, a decision made exactly once.
 *
 *   node tests/mission-artifacts/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const OWNER  = '11111111-1111-1111-1111-111111111111';
const EDITOR = '22222222-2222-2222-2222-222222222222';
const VIEWER = '33333333-3333-3333-3333-333333333333';
const STRANGER = '44444444-4444-4444-4444-444444444444';
const PROFILE = '55555555-5555-5555-5555-555555555555';

const db = {};
function resetDb() {
  db.profiles = [{ id: PROFILE, owner_id: OWNER }];
  db.members = [
    { profile_id: PROFILE, user_id: EDITOR, role: 'editor' },
    { profile_id: PROFILE, user_id: VIEWER, role: 'viewer' },
  ];
  db.artifacts = [];
  db.contacts = [];
  db.failContactInsert = false;
  db.failContactLookup = false;
}
let nextId = 1;
const uuid = () => `aaaaaaaa-aaaa-aaaa-aaaa-${String(nextId++).padStart(12, '0')}`;

function mockModule(relPath, exportsObj) {
  const p = require.resolve(path.join(REPO, relPath));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

const q = (s, key) => { const m = s.match(new RegExp(`[?&]${key}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };

mockModule('api/_lib/supabase-rest.js', {
  isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)),
  sbRest: async (url, key, method, p, body) => {
    if (p.startsWith('/intelligence_profiles')) {
      const id = q(p, 'id'), owner = q(p, 'owner_id');
      return { ok: true, data: db.profiles.filter(x => (!id || x.id === id) && (!owner || x.owner_id === owner)) };
    }
    if (p.startsWith('/intelligence_profile_members')) {
      const pid = q(p, 'profile_id'), uid = q(p, 'user_id');
      return { ok: true, data: db.members.filter(m => (!pid || m.profile_id === pid) && (!uid || m.user_id === uid)) };
    }
    if (p.startsWith('/mission_artifacts')) {
      if (method === 'POST') { const row = { id: uuid(), created_at: new Date().toISOString(), ...body }; db.artifacts.push(row); return { ok: true, data: [row] }; }
      if (method === 'PATCH') {
        const id = q(p, 'id'), status = q(p, 'status');
        const rows = db.artifacts.filter(a => a.id === id && (!status || a.status === status));
        rows.forEach(a => Object.assign(a, body));
        return { ok: true, data: rows };
      }
      const id = q(p, 'id');
      if (id) return { ok: true, data: db.artifacts.filter(a => a.id === id) };
      const orm = p.match(/or=\(user_id\.eq\.([^,]+),intel_profile_id\.in\.\(([^)]*)\)\)/);
      const plain = p.match(/user_id=eq\.([^&]+)/);
      let rows = db.artifacts;
      if (orm) { const pids = orm[2].split(','); rows = rows.filter(a => a.user_id === orm[1] || pids.includes(a.intel_profile_id)); }
      else if (plain) rows = rows.filter(a => a.user_id === plain[1]);
      const st = q(p, 'status'); if (st) rows = rows.filter(a => a.status === st);
      return { ok: true, data: rows };
    }
    if (p.startsWith('/contacts')) {
      if (method === 'POST') {
        if (db.failContactInsert) return { ok: false, status: 500, data: null };
        if (db.contacts.some(c => c.user_id === body.user_id && c.email === body.email)) return { ok: false, status: 409, data: null };
        db.contacts.push(body); return { ok: true, data: [body] };
      }
      if (db.failContactLookup) return { ok: false, status: 500, data: null };
      const uid = q(p, 'user_id');
      const inm = p.match(/email=in\.\(([^)]*)\)/);
      const emails = inm ? inm[1].split(',').map(decodeURIComponent) : [];
      return { ok: true, data: db.contacts.filter(c => c.user_id === uid && emails.includes(c.email)).map(c => ({ email: c.email })) };
    }
    return { ok: true, data: [] };
  },
});
mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailureAsync() {}, reportFailure() {} });

let placesResults = [];
mockModule('api/_lib/places-search.js', { searchPlaces: async () => ({ results: placesResults, nextPageToken: null }) });
mockModule('api/_lib/website-quickcheck.js', { quickCheckWebsite: async () => ({ status: 'outdated', signals: {}, reasons: ['No mobile-responsive (viewport) tag'] }) });
mockModule('api/_lib/email-lookup.js', { findEmailByBusiness: async () => ({ email: null, dataSource: 'not_found', source: null }), findContactEmail: async (site) => ({ email: site.includes('noemail') ? null : `hello@${site.replace(/^https?:\/\//, '')}`, dataSource: site.includes('noemail') ? 'not_found' : 'real' }) });
mockModule('api/_lib/owner-lookup.js', { findOwnerName: async () => ({ firstName: 'Dana', source: 'https://src' }) });

global.fetch = async (url) => {
  if (String(url).includes('/auth/v1/user')) return global.__callerId ? { ok: true, json: async () => ({ id: global.__callerId }) } : { ok: false };
  throw new Error('unexpected fetch ' + url);
};
process.env.SUPABASE_URL = 'https://x.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.GOOGLE_PLACES_API_KEY = 'places';
process.env.PERPLEXITY_API_KEY = 'pplx';

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
async function call(handler, callerId, body, { noAuth } = {}) {
  global.__callerId = callerId;
  const res = makeRes();
  await handler({ method: 'POST', headers: noAuth ? {} : { authorization: 'Bearer tok' }, body }, res);
  return res;
}

const biz = (n, website) => ({ placeId: `pl${n}`, name: `Biz ${n}`, address: 'a', phone: '555', website, rating: 4, reviewCount: n, businessStatus: 'OPERATIONAL', mapsUrl: 'm' });

(async () => {
  const blade = load('mission-blade');
  const arts = load('mission-artifacts');

  console.log('\n──── discover: input and access are checked before anything is spent ────');
  resetDb();
  placesResults = [biz(1, 'https://a.example')];
  {
    check('no session is refused', (await call(blade, null, { action: 'discover', sector: 'plumbers', city: 'Austin' }, { noAuth: true })).statusCode === 401);
    const noSector = await call(blade, OWNER, { action: 'discover', sector: '', city: 'Austin' });
    check('a missing trade is a clear 400 naming the field', noSector.statusCode === 400 && noSector.body.field === 'sector');
    const noCity = await call(blade, OWNER, { action: 'discover', sector: 'plumbers' });
    check('a missing city is a clear 400 naming the field', noCity.statusCode === 400 && noCity.body.field === 'city');
    check('neither created an artifact', db.artifacts.length === 0);
    const stranger = await call(blade, STRANGER, { action: 'discover', sector: 'plumbers', city: 'Austin', intelProfileId: PROFILE });
    check('a stranger cannot build into someone else\'s business profile', stranger.statusCode === 403);
    const viewer = await call(blade, VIEWER, { action: 'discover', sector: 'plumbers', city: 'Austin', intelProfileId: PROFILE });
    check('a viewer cannot either — building needs edit access', viewer.statusCode === 403);
    delete process.env.GOOGLE_PLACES_API_KEY;
    const noKey = await call(blade, OWNER, { action: 'discover', sector: 'plumbers', city: 'Austin' });
    check('no Places key is an honest 503, not an empty "success"', noKey.statusCode === 503);
    process.env.GOOGLE_PLACES_API_KEY = 'places';
  }

  console.log('\n──── discover: nothing qualifying is reported honestly as empty ────');
  {
    resetDb();
    placesResults = [];
    const res = await call(blade, OWNER, { action: 'discover', sector: 'plumbers', city: 'Nowhere' });
    check('the artifact is "empty", not waiting on an approval with nothing in it', res.body.status === 'empty' && db.artifacts[0].status === 'empty');
    check('and says why', /nothing to approve/.test(res.body.note));
  }

  console.log('\n──── enrich: bounded batches, approvable only when the list is complete ────');
  resetDb();
  placesResults = [1, 2, 3, 4, 5, 6, 7].map(n => biz(n, n === 3 ? 'https://noemail.example' : `https://b${n}.example`));
  let artifactId;
  {
    const found = await call(blade, EDITOR, { action: 'discover', sector: 'plumbers', city: 'Austin', country: 'USA', intelProfileId: PROFILE, missionId: 'mission_abc' });
    artifactId = found.body.artifactId;
    check('an editor can build into the shared profile', found.statusCode === 200 && db.artifacts[0].intel_profile_id === PROFILE);
    check('the artifact starts "building", not approvable', db.artifacts[0].status === 'building');
    check('it remembers which mission it came from', db.artifacts[0].mission_id === 'mission_abc');

    const early = await call(arts, OWNER, { action: 'approve', artifactId });
    check('approving a half-built list is refused', early.statusCode === 409);

    const b1 = await call(blade, EDITOR, { action: 'enrich', artifactId });
    check('the first batch does at most 5 leads', b1.body.processed === 5 && b1.body.remaining === 2);
    check('still "building" with leads outstanding', b1.body.status === 'building');
    const b2 = await call(blade, EDITOR, { action: 'enrich', artifactId });
    check('the second batch finishes the rest', b2.body.processed === 2 && b2.body.remaining === 0);
    check('only now does it become approvable', b2.body.status === 'pending_approval' && db.artifacts[0].status === 'pending_approval');

    const leads = db.artifacts[0].payload.leads;
    check('a real email is stored where one was found', leads.filter(l => l.email).length === 6);
    check('and left null where none was — never invented', leads.find(l => l.website.includes('noemail')).email === null);

    const again = await call(blade, EDITOR, { action: 'enrich', artifactId });
    check('a finished list cannot be enriched again', again.statusCode === 409);
    check('a viewer cannot enrich', (await call(blade, VIEWER, { action: 'enrich', artifactId })).statusCode === 404);
    check('a stranger cannot even see it exists', (await call(blade, STRANGER, { action: 'enrich', artifactId })).statusCode === 404);
  }

  console.log('\n──── reading: shared members can look, strangers cannot ────');
  {
    const listViewer = await call(arts, VIEWER, { action: 'list' });
    check('a viewer sees the shared artifact', listViewer.body.artifacts.some(a => a.id === artifactId));
    check('the list carries counts, not the whole payload', listViewer.body.artifacts[0].counts.leads === 7 && listViewer.body.artifacts[0].payload === undefined);
    check('a viewer can open it in full', (await call(arts, VIEWER, { action: 'get', artifactId })).body.artifact.payload.leads.length === 7);
    check('a stranger\'s list is empty', (await call(arts, STRANGER, { action: 'list' })).body.artifacts.length === 0);
    check('a stranger cannot open it', (await call(arts, STRANGER, { action: 'get', artifactId })).statusCode === 404);
    check('a bad status filter is refused, not passed into a query', (await call(arts, OWNER, { action: 'list', status: 'x&limit=1' })).statusCode === 400);
  }

  console.log('\n──── approving: a viewer cannot decide, an editor can, exactly once ────');
  {
    check('a viewer cannot approve', (await call(arts, VIEWER, { action: 'approve', artifactId })).statusCode === 404);
    check('nothing was imported by that attempt', db.contacts.length === 0);

    // An existing contact (e.g. someone who unsubscribed) must not be touched.
    db.contacts.push({ user_id: EDITOR, email: 'hello@b1.example', status: 'unsubscribed' });

    const res = await call(arts, EDITOR, { action: 'approve', artifactId });
    check('the editor\'s approval succeeds', res.statusCode === 200 && res.body.status === 'approved');
    check('6 leads had an email; 1 was already in the audience, so 5 were added', res.body.result.imported === 5 && res.body.result.skippedExisting === 1);
    check('the one with no email is counted as skipped, not dropped silently', res.body.result.skippedNoEmail === 1);
    const unsub = db.contacts.find(c => c.email === 'hello@b1.example');
    check('the already-present (unsubscribed) contact was left exactly as it was', unsub.status === 'unsubscribed' && unsub.source === undefined);

    const added = db.contacts.find(c => c.email === 'hello@b2.example');
    check('imported contacts are tagged so they can be segmented', added.tags.includes('blade-prospect') && added.tags.includes('plumbers'));
    check('the owner name found becomes the first name', added.first_name === 'Dana');
    check('provenance is recorded honestly — found publicly, no opt-in', /No prior opt-in/.test(added.consent_source) && !!added.consent_timestamp);
    check('the source marks where it came from', added.source === 'blade_mission');
    check('attributed to the shared business profile', added.intel_profile_id === PROFILE);
    check('the approval outcome is saved on the artifact', db.artifacts[0].payload.approval.imported === 5 && db.artifacts[0].status === 'approved');

    const second = await call(arts, OWNER, { action: 'approve', artifactId });
    check('a second approval is refused — never imports twice', second.statusCode === 409);
    check('and nothing more was added', db.contacts.length === 6);
  }

  console.log('\n──── a failed import hands the artifact back instead of losing it ────');
  {
    resetDb();
    placesResults = [biz(1, 'https://a.example')];
    const f = await call(blade, OWNER, { action: 'discover', sector: 'plumbers', city: 'Austin' });
    await call(blade, OWNER, { action: 'enrich', artifactId: f.body.artifactId });
    db.failContactLookup = true;
    const res = await call(arts, OWNER, { action: 'approve', artifactId: f.body.artifactId });
    check('an unreadable audience stops the import rather than guessing who is already in it', res.statusCode === 502);
    check('the artifact is handed back to pending_approval so it can be retried', db.artifacts[0].status === 'pending_approval' && db.artifacts[0].decided_at === null);
    db.failContactLookup = false;
    const retry = await call(arts, OWNER, { action: 'approve', artifactId: f.body.artifactId });
    check('the retry then works', retry.statusCode === 200 && retry.body.result.imported === 1);
  }

  console.log('\n──── reject: nothing is imported, and it too is final ────');
  {
    resetDb();
    placesResults = [biz(1, 'https://a.example')];
    const f = await call(blade, OWNER, { action: 'discover', sector: 'plumbers', city: 'Austin' });
    await call(blade, OWNER, { action: 'enrich', artifactId: f.body.artifactId });
    const rej = await call(arts, OWNER, { action: 'reject', artifactId: f.body.artifactId });
    check('rejecting works and imports nothing', rej.statusCode === 200 && db.contacts.length === 0);
    check('a rejected list cannot then be approved', (await call(arts, OWNER, { action: 'approve', artifactId: f.body.artifactId })).statusCode === 409);
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
