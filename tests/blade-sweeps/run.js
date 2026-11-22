/**
 * Blade area sweeps: the GeoNames drill-down (api/_lib/geonames.js), the
 * service-account Sheets client (api/_lib/google-sheets.js), the Webese
 * tracker rules (api/_lib/webese-tracker.js — the Outreach platform's column
 * ownership), the sweep engine (api/_lib/blade-sweep.js), the endpoints and
 * the page. Blade never writes a contact field into a tracker, never edits
 * an existing tracker row, and stops at the search budget.
 *
 *   node tests/blade-sweeps/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
function mockModule(rel, exp) { const p = require.resolve(path.join(REPO, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }
const clone = (x) => JSON.parse(JSON.stringify(x));
const ADMIN = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const STRANGER = '44444444-4444-4444-4444-444444444444';

(async () => {
  /* ── GeoNames ───────────────────────────────────────────────────────── */
  console.log('\n──── the place hierarchy (GeoNames) ────');
  delete process.env.GEONAMES_USERNAME;
  const geo = require(path.join(REPO, 'api/_lib/geonames.js'));
  let threw = ''; try { await geo.countries(); } catch (e) { threw = e.message; }
  check('without a GeoNames account it says how to get one', /GEONAMES_USERNAME/.test(threw) && /geonames\.org/.test(threw));
  process.env.GEONAMES_USERNAME = 'webese';
  let geoCalls = [];
  global.fetch = async (url) => {
    const u = new URL(String(url)); geoCalls.push(u);
    const P = u.pathname;
    if (P.endsWith('/countryInfoJSON')) return { ok: true, json: async () => ({ geonames: [{ geonameId: 6252001, countryName: 'United States', countryCode: 'US' }, { geonameId: 2635167, countryName: 'United Kingdom', countryCode: 'GB' }] }) };
    if (P.endsWith('/childrenJSON')) return { ok: true, json: async () => ({ geonames: [{ geonameId: 1, name: 'Texas', fcode: 'ADM1', adminCode1: 'TX', countryCode: 'US' }, { geonameId: 2, name: 'Austin', fcode: 'PPLA' }, { geonameId: 3, name: 'Travis County', fcode: 'ADM2', adminCode1: 'TX', adminCode2: '453' }] }) };
    if (P.endsWith('/searchJSON')) {
      if (u.searchParams.get('adminCode1') === 'ERR') return { ok: true, json: async () => ({ status: { message: 'the hourly limit of 1000 credits has been exceeded', value: 19 } }) };
      const start = Number(u.searchParams.get('startRow'));
      const page = start === 0
        ? Array.from({ length: 1000 }, (_, i) => ({ geonameId: 100 + i, name: `Town ${i}`, fcode: i === 1 ? 'PPLX' : 'PPL', population: 100000 - i * 10, adminCode1: 'TX', adminName1: 'Texas', adminCode2: '453', adminName2: 'Travis', lat: '30.2', lng: '-97.7' }))
        : [{ geonameId: 5000, name: 'Tiny', fcode: 'PPL', population: 50, adminCode1: 'TX', adminCode2: '453' }];
      return { ok: true, json: async () => ({ totalResultsCount: 1001, geonames: page }) };
    }
    throw new Error('unexpected ' + url);
  };
  const cs = await geo.countries();
  check('countries come back sorted by name', cs.map(c => c.name).join() === 'United Kingdom,United States' && geoCalls[0].searchParams.get('username') === 'webese' && geoCalls[0].protocol === 'https:');
  check('a country\'s children are its states only', (await geo.children(6252001, 'state')).map(s => s.name).join() === 'Texas');
  check('a state\'s children are its counties only', (await geo.children(1, 'county')).map(s => s.name).join() === 'Travis County');
  geoCalls = [];
  let tw = await geo.towns({ countryCode: 'US', adminCode1: 'TX' });
  check('towns are paged in full, largest first, sections of cities left out', tw.towns.length === 1000 && tw.towns[0].name === 'Town 0' && !tw.towns.some(t => t.name === 'Town 1') && geoCalls.length === 2 && geoCalls[0].searchParams.get('featureClass') === 'P');
  geoCalls = [];
  tw = await geo.towns({ countryCode: 'US', adminCode1: 'TX', adminCode2: '453', minPopulation: 95000 });
  check('a minimum population stops paging once towns get smaller, and filters by county', tw.towns.length === 500 && geoCalls.length === 1 && geoCalls[0].searchParams.get('adminCode2') === '453');
  threw = ''; try { await geo.towns({ countryCode: 'US', adminCode1: 'ERR' }); } catch (e) { threw = e.message; }
  check('GeoNames\' own errors (sent as HTTP 200) are surfaced', /hourly limit/.test(threw));

  /* ── Google Sheets client ───────────────────────────────────────────── */
  console.log('\n──── the service-account Sheets client ────');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const sheets = require(path.join(REPO, 'api/_lib/google-sheets.js'));
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  threw = ''; try { await sheets.accessToken(); } catch (e) { threw = e.message; }
  check('without the service account it says which variable to set', /GOOGLE_SERVICE_ACCOUNT_JSON/.test(threw));
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify({ client_email: 'blade@webese.iam.gserviceaccount.com', private_key: privateKey })).toString('base64');
  let tokenReq = null, gCalls = [], back = null;
  global.fetch = async (url, o = {}) => {
    const u = String(url);
    if (u === 'https://oauth2.googleapis.com/token') { tokenReq = new URLSearchParams(o.body); return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }; }
    gCalls.push({ u, o });
    if (u.includes('/denied')) return { ok: false, status: 403, json: async () => ({ error: { message: 'The caller does not have permission' } }) };
    if (u.includes(':batchGet')) return { ok: true, json: async () => back };
    return { ok: true, json: async () => ({}) };
  };
  await sheets.accessToken(); await sheets.accessToken();
  const [h, c, sig] = tokenReq.get('assertion').split('.');
  const claim = JSON.parse(Buffer.from(c, 'base64').toString());
  const verified = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  check('it signs a real RS256 JWT for the service account (base64 key accepted)', verified && claim.iss === 'blade@webese.iam.gserviceaccount.com' && /spreadsheets/.test(claim.scope) && tokenReq.get('grant_type').includes('jwt-bearer'));
  check('the token is reused, not fetched for every call', gCalls.length === 0);
  threw = ''; try { await sheets.readTabs('denied', ['Prospects']); } catch (e) { threw = e.message; }
  check('a sheet that is not shared says which address to share it with', /blade@webese\.iam\.gserviceaccount\.com/.test(threw) && /Editor/.test(threw));
  back = { valueRanges: [{ values: [['x']] }] };
  threw = ''; try { await sheets.writeCellsVerified('f1', [{ tab: 'Campaign State', addr: 'B4', value: 'y' }]); } catch (e) { threw = e.message; }
  check('a write that does not read back the same is an error, not a success', /did not keep/.test(threw));

  /* ── the tracker rules ──────────────────────────────────────────────── */
  console.log('\n──── writing a Webese tracker the Outreach way ────');
  const wt = require(path.join(REPO, 'api/_lib/webese-tracker.js'));
  const where = { state: 'Alabama', county: 'Monroe', place: 'Monroeville', category: 'Roofing' };
  const noSite = { name: 'Southern Roofing Co', siteStatus: 'no_website', reviewCount: 12, phone: '251-555-0100', email: 'owner@x.com', ownerFirstName: 'Bob' };
  const wix = { name: 'Pine Belt Plumbing', website: 'https://www.pinebelt.com', siteStatus: 'outdated', sitePlatform: 'wix', siteReasons: ['Built on Wix (meta generator)'], reviewCount: 0, note: 'On a Wix template' };
  const v1 = wt.rowValues(noSite, where, '2026-10-20'), v2 = wt.rowValues(wix, where, '2026-10-20');
  check('no website → NO_WEBSITE, website score 1, BUILD_REBUILD, 95 for an established business', v1['Website Status'] === 'NO_WEBSITE' && v1['Website Score'] === '1' && v1['Offer Type'] === 'BUILD_REBUILD' && v1['Opportunity Score'] === '95');
  check('a template builder → LIVE, the platform named with its evidence, SWITCH_AND_SAVE', v2['Website Status'] === 'LIVE' && v2['Website Platform/Provider'] === 'Wix' && /Wix/.test(v2['Platform Evidence']) && v2['Offer Type'] === 'SWITCH_AND_SAVE' && v2['Opportunity Score'] === '60');
  check('every new row is the handoff: HOLD + CONTACT_ENRICHMENT_REQUIRED_LIVE, dated today', v1['Queue Status'] === 'HOLD' && v1['Notes'] === 'CONTACT_ENRICHMENT_REQUIRED_LIVE' && v1['Discovery Date'] === '2026-10-20');
  const HEAD = ['State', 'County', 'Place', 'Business Name', 'Category', 'Website', 'Website Status', 'Website Platform/Provider', 'Platform Evidence', 'Website Score', 'Opportunity Score', 'Offer Type', 'Website Observation', 'Queue Status', 'Suppression Status', 'Notes', 'First Name', 'Email', 'Phone', 'Owner Full Name', 'Sent Date', 'Resend Status', 'Reply Status', 'Unsubscribed', 'Discovery Date'];
  const row = wt.toSheetRow(HEAD, { ...v1, Email: 'owner@x.com', Phone: '251', 'First Name': 'Bob', 'Owner Full Name': 'Bob X', 'Sent Date': 'x', 'Suppression Status': 'CLEAR' });
  const at = (h) => row[HEAD.indexOf(h)];
  check('contact, send and suppression columns are never written, even if a value is offered', ['Email', 'Phone', 'First Name', 'Owner Full Name', 'Sent Date', 'Resend Status', 'Suppression Status', 'Unsubscribed'].every(h => at(h) === ''));
  check('values land in the sheet\'s own column order', at('Business Name') === 'Southern Roofing Co' && at('Place') === 'Monroeville' && at('Discovery Date') === '2026-10-20' && row.length === HEAD.length);
  check('headers are matched however they are cased or spaced', wt.toSheetRow(['business name', 'WEBSITE STATUS'], v1).join('|') === 'Southern Roofing Co|NO_WEBSITE');

  const vert = [['Campaign', 'Webese AI'], ['State', 'Alabama'], ['Lifecycle State', 'NOT_STARTED'], ['Current County', ''], ['Current Place', ''], ['NEXT_CURSOR', ''], ['Last Run Date', ''], ['Write Health', 'HEALTH_X']];
  const pv = wt.parseCampaignState(vert);
  check('Campaign State is read in the field-down-column-A layout', pv.fields['Lifecycle State'] === 'NOT_STARTED' && pv.cells['NEXT_CURSOR'] === 'B6');
  const ph = wt.parseCampaignState([['State', 'Lifecycle State', 'Current County', 'Current Place', 'NEXT_CURSOR'], ['Alabama', 'ACTIVE_FIRST_PASS', 'Baldwin', 'Foley', 'Baldwin|Foley']]);
  check('…and in the header-row layout, without mistaking it for the other', ph.fields['Current County'] === 'Baldwin' && ph.cells['NEXT_CURSOR'] === 'E2');
  const cw = wt.cursorWrites(pv, { county: 'Monroe', place: 'Monroeville', status: 'OK', summary: 's', lifecycle: 'ACTIVE_FIRST_PASS', today: '2026-10-20' });
  check('the cursor is written only into cells that exist; Write Health is never touched', cw.some(w => w.addr === 'B6' && w.value === 'Monroe|Monroeville') && cw.some(w => w.addr === 'B3' && w.value === 'ACTIVE_FIRST_PASS') && !cw.some(w => w.addr === 'B8') && !cw.some(w => /Status|Summary/.test(w.value)));
  check('a First-Pass Fleet run in the last three days is noticed', wt.fleetActivity([{ Timestamp: new Date(Date.now() - 86400000).toISOString().slice(0, 16).replace('T', ' '), Agent: 'Webese First-Pass Fleet' }]).recent && !wt.fleetActivity([{ Timestamp: '2020-01-01 08:00', Agent: 'Webese First-Pass Fleet' }]).recent);

  const fake = { appended: [], cells: [] };
  const fakeSheets = {
    findSpreadsheetsByName: async (n) => (n === 'Webese Alabama Outreach Tracker' ? [{ fileId: 'AL', name: n, url: 'https://docs.google.com/spreadsheets/d/AL' }] : []),
    readTabs: async () => ({ Prospects: [HEAD, ['Alabama', 'Monroe', 'Monroeville', 'Pine Belt Plumbing', 'Plumbing', 'pinebelt.com', 'LIVE', '', '', '', '', '', '', 'SENT', 'CLEAR', '', 'Dana', 'dana@x.com']], 'Campaign State': vert, 'Run History': [['Timestamp', 'Agent', 'Start Cursor', 'End Cursor', 'Area Covered', 'Discovered', 'Audited', 'Rejected', 'Qualified', 'Build/Rebuild', 'Switch & Save', 'Notes']] }),
    appendRows: async (f, tab, rows) => { fake.appended.push({ tab, rows }); return { updatedRows: rows.length }; },
    writeCellsVerified: async (f, w) => { fake.cells.push(...w); },
    serviceAccountEmail: () => 'blade@webese.iam.gserviceaccount.com', colLetter: sheets.colLetter,
  };
  threw = ''; try { await wt.openTracker('Texas', { sheets: fakeSheets }); } catch (e) { threw = e.message; }
  check('a state with no tracker is a clear stop, naming the sheet and the address to share it with', /Webese Texas Outreach Tracker/.test(threw) && /blade@webese/.test(threw));
  const t = await wt.openTracker('Alabama', { sheets: fakeSheets });
  const wr = await wt.writeBatch(t, [{ lead: noSite, where }, { lead: { ...wix, name: 'Pine Belt Plumbing' }, where }, { lead: { ...wix, name: 'Different Name, Same Site' }, where }],
    { county: 'Monroe', place: 'Monroeville', summary: 'Blade: roofing', lifecycle: 'ACTIVE_FIRST_PASS', stats: { discovered: 9, audited: 9, rejected: 6, qualified: 3 } }, { sheets: fakeSheets, now: Date.parse('2026-10-20T08:00:00Z') });
  const prospectsAppend = fake.appended.find(a => a.tab === 'Prospects');
  check('only the new business is added; the SENT row is not touched and not duplicated (by name or by website)', wr.written === 1 && wr.duplicates === 2 && prospectsAppend.rows.length === 1 && prospectsAppend.rows[0][3] === 'Southern Roofing Co');
  check('existing rows are never edited — only appended to', !fake.cells.some(w => w.tab === 'Prospects'));
  const hist = fake.appended.find(a => a.tab === 'Run History').rows[0];
  check('a Run History line is added as Blade, with the counts', hist[1] === 'Blade (Audema)' && hist[3] === 'Monroe|Monroeville' && hist[8] === '3' && /1 added, 2 already/.test(hist[11]));
  check('the research cursor moves and a not-started state becomes ACTIVE_FIRST_PASS', fake.cells.some(w => w.value === 'Monroe|Monroeville') && fake.cells.some(w => w.value === 'ACTIVE_FIRST_PASS'));

  /* ── the engine ─────────────────────────────────────────────────────── */
  console.log('\n──── the sweep engine ────');
  const db = { blade_sweeps: [], blade_sweep_tasks: [], blade_sweep_leads: [], projects: [], intelligence_profiles: [], intelligence_profile_members: [], profiles: [{ id: ADMIN, role: 'admin' }, { id: USER, role: 'user' }] };
  let nextId = 1; const uuid = () => `cdcdcdcd-0000-0000-0000-${String(nextId++).padStart(12, '0')}`;
  function filterRows(rows, qs) {
    const params = new URLSearchParams(qs); let out = rows.slice();
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      if (k === 'or') { const m = v.match(/^\(lock_until\.is\.null,lock_until\.lt\.(.+)\)$/); out = out.filter(r => !r.lock_until || r.lock_until < m[1]); continue; }
      if (v.startsWith('eq.')) out = out.filter(r => String(r[k]) === v.slice(3));
      else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map(decodeURIComponent); out = out.filter(r => set.includes(String(r[k]))); }
    }
    const order = params.get('order');
    if (order) { const [col, dir] = order.split('.'); out.sort((a, b) => ((a[col] ?? '') > (b[col] ?? '') ? 1 : (a[col] ?? '') < (b[col] ?? '') ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
    const off = Number(params.get('offset')) || 0, lim = Number(params.get('limit')) || 1e9;
    return out.slice(off, off + lim);
  }
  const sb = async (method, p, body) => {
    const [tp, qs = ''] = p.split('?'); const rows = db[tp.slice(1)] || (db[tp.slice(1)] = []);
    if (method === 'GET') return { ok: true, status: 200, data: clone(filterRows(rows, qs)) };
    if (method === 'POST') {
      const list = (Array.isArray(body) ? body : [body]).map(b => ({ id: uuid(), created_at: new Date().toISOString(), ...clone(b) }));
      if (tp === '/blade_sweep_leads') for (const l of list) if (rows.some(r => r.user_id === l.user_id && r.place_id === l.place_id)) return { ok: false, status: 409, data: null };
      rows.push(...list); return { ok: true, status: 201, data: clone(list) };
    }
    if (method === 'PATCH') { const hit = filterRows(rows, qs); hit.forEach(r => Object.assign(r, clone(body))); return { ok: true, status: 200, data: clone(hit) }; }
    return { ok: false, status: 400 };
  };
  mockModule('api/_lib/supabase-rest.js', { sbRest: async (u, k, m, p, b) => sb(m, p, b), isUuid: (v) => /^[0-9a-f-]{36}$/i.test(String(v)) });
  const sw = require(path.join(REPO, 'api/_lib/blade-sweep.js'));

  const fakeGeo = {
    towns: async ({ adminCode1, adminCode2 }) => ({ towns: adminCode1 === 'GA' ? [{ geonameId: 9, name: 'Savannah', adminCode1: 'GA', adminName1: 'Georgia', population: 1000, lat: 32, lng: -81 }] : [
      { geonameId: 1, name: 'Frisco City', adminCode1: 'AL', adminName1: 'Alabama', adminCode2: '099', adminName2: 'Monroe', population: 1200, lat: 31.43, lng: -87.4 },
      { geonameId: 2, name: 'Monroeville', adminCode1: 'AL', adminName1: 'Alabama', adminCode2: '099', adminName2: 'Monroe', population: 6000, lat: 31.53, lng: -87.32 },
      { geonameId: 3, name: 'Foley', adminCode1: 'AL', adminName1: 'Alabama', adminCode2: '003', adminName2: 'Baldwin', population: 20000, lat: 30.4, lng: -87.68 },
    ].filter(t => !adminCode2 || t.adminCode2 === adminCode2), truncated: false }),
    children: async () => [{ name: 'Alabama', adminCode1: 'AL' }, { name: 'Georgia', adminCode1: 'GA' }],
  };
  const plan = await sw.planRoot({ level: 'state', countryCode: 'US', adminCode1: 'AL' }, {}, { geo: fakeGeo });
  const tasks = sw.buildTasks('S', plan.towns, ['Roofers', 'Plumbers'], 1, {});
  check('tasks go county by county, largest town first, every trade', tasks.map(x => `${x.county_name}/${x.place_name}/${x.sector}`).join(' ') === 'Baldwin/Foley/Roofers Baldwin/Foley/Plumbers Monroe/Monroeville/Roofers Monroe/Monroeville/Plumbers Monroe/Frisco City/Roofers Monroe/Frisco City/Plumbers' && tasks[0].seq === 1);
  check('a county sweep lists only that county\'s towns', (await sw.planRoot({ level: 'county', countryCode: 'US', adminCode1: 'AL', adminCode2: '099' }, {}, { geo: fakeGeo })).towns.length === 2);
  const cp = await sw.planRoot({ level: 'country', countryCode: 'US', geonameId: 6252001 }, {}, { geo: fakeGeo });
  check('a country sweep starts with its states to expand, one at a time', cp.towns.length === 0 && cp.frontier.map(f => f.stateName).join() === 'Alabama,Georgia');

  const place = (id, name, extra) => ({ placeId: id, name, website: '', lat: 31.5, lng: -87.3, ...extra });
  let searches = [], quotaOnce = false;
  const fakeSearch = async (key, q) => {
    searches.push(q);
    if (quotaOnce) { quotaOnce = false; const e = new Error('Quota exceeded for quota metric'); e.status = 429; throw e; }
    if (/Foley/.test(q.textQuery)) return { results: [place('p1', 'Gulf Coast HVAC', { lat: 30.4, lng: -87.68 }), place('p2', 'Bayside Dental', { website: 'https://bayside.com', lat: 30.41, lng: -87.68 }), place('far', 'Mobile Roofers', { lat: 30.69, lng: -88.04 })], nextPageToken: null };
    return { results: [place('p1', 'Gulf Coast HVAC'), place('p3', 'Monroe Modern', { website: 'https://modern.com' })], nextPageToken: null };
  };
  const fakeCheck = async (url) => (/bayside/.test(url) ? { status: 'outdated', signals: { platform: 'wix' }, reasons: ['Built on Wix'] } : { status: 'modern', signals: {}, reasons: [] });
  const written = [];
  const fakeTracker = { openTracker: async (state) => ({ ref: { fileId: state, name: `Webese ${state} Outreach Tracker` }, prospects: [], campaign: { fields: { 'Lifecycle State': 'NOT_STARTED' }, cells: {} }, history: { headers: [], rows: [] } }), writeBatch: async (tr, items, run) => { written.push({ items, run }); items.forEach(i => tr.prospects.push({ 'Business Name': i.lead.name })); return { written: items.length, duplicates: 0 }; } };

  const make = (over) => { const s = { id: uuid(), user_id: ADMIN, root: { level: 'state', countryCode: 'US', countryName: 'USA', adminCode1: 'AL', stateName: 'Alabama' }, frontier: [], sectors: ['Roofers'], min_population: 0, pages_per_town: 1, max_searches: 100, searches_used: 0, status: 'running', write_to_tracker: true, trackers: {}, totals: {}, lock_until: null, ...over }; db.blade_sweeps.push(s); db.blade_sweep_tasks.push(...sw.buildTasks(s.id, plan.towns, s.sectors, 1, {}).map(x => ({ id: uuid(), ...x }))); return s; };
  let clock = Date.parse('2026-10-20T08:00:00Z');
  const deps = { placesKey: 'k', search: fakeSearch, quickCheck: fakeCheck, trackerLib: fakeTracker, geo: fakeGeo, now: () => clock, budgetMs: 100000 };

  const s1 = make();
  const out1 = await sw.tick(sb, db.blade_sweeps.find(x => x.id === s1.id), deps);
  const S1 = db.blade_sweeps.find(x => x.id === s1.id);
  const leads1 = db.blade_sweep_leads.filter(l => l.sweep_id === s1.id);
  check('a batch searches each town, biased to the town', out1.ran && searches.length === 3 && searches[0].locationBias && searches[0].locationBias.lat === 30.4 && /^Roofers in Foley, Alabama, USA$/.test(searches[0].textQuery));
  check('a business 30+ km away is left for its own town', !leads1.some(l => l.place_id === 'far'));
  check('the same business found from two towns is counted once', leads1.filter(l => l.place_id === 'p1').length === 1);
  check('only real opportunities are qualified; a modern site is kept as checked but not qualified', leads1.find(l => l.place_id === 'p2').qualified && !leads1.find(l => l.place_id === 'p3').qualified && leads1.find(l => l.place_id === 'p2').offer_type === 'SWITCH_AND_SAVE');
  check('qualified businesses go to the state\'s tracker, with the town as the cursor, starting the first pass', written.length >= 1 && written[0].items.map(i => i.lead.name).sort().join() === 'Bayside Dental,Gulf Coast HVAC' && written[0].run.place === 'Foley' && written[0].run.lifecycle === 'ACTIVE_FIRST_PASS');
  check('the phone stays in Audema only', leads1.find(l => l.place_id === 'p1').phone !== undefined && written.every(w => w.items.every(i => !('phone' in tracker_row(i)))));
  function tracker_row(i) { return wt.toSheetRow(HEAD, wt.rowValues(i.lead, { state: 'Alabama', place: 'x', county: 'y', category: 'z' }, 'd')).reduce((o, v, n) => { if (v) o[HEAD[n]] = v; return o; }, {}); }
  check('when every town is done the sweep is done, with totals and the lock released', S1.status === 'done' && S1.searches_used === 3 && S1.totals.qualified === 2 && S1.totals.written === 2 && S1.lock_until === null && !!S1.finished_at);

  const s2 = make({ max_searches: 2 });
  await sw.tick(sb, db.blade_sweeps.find(x => x.id === s2.id), deps);
  const S2 = db.blade_sweeps.find(x => x.id === s2.id);
  check('a sweep stops at its search budget and says how to carry on', S2.status === 'paused' && S2.searches_used === 2 && /search budget \(2 searches\)/.test(S2.status_note) && db.blade_sweep_tasks.filter(x => x.sweep_id === s2.id && x.status === 'pending').length === 1);

  const s3 = make();
  db.blade_sweeps.find(x => x.id === s3.id).lock_until = new Date(clock + 60000).toISOString();
  check('two batches of the same sweep cannot run at once', (await sw.tick(sb, db.blade_sweeps.find(x => x.id === s3.id), deps)).ran === false);
  db.blade_sweeps.find(x => x.id === s3.id).lock_until = null;
  quotaOnce = true; searches = [];
  await sw.tick(sb, db.blade_sweeps.find(x => x.id === s3.id), deps);
  const S3 = db.blade_sweeps.find(x => x.id === s3.id);
  const t3 = db.blade_sweep_tasks.filter(x => x.sweep_id === s3.id);
  check('a Places quota error pauses the sweep and leaves the town to try again', S3.status === 'paused' && /Google Places refused/.test(S3.status_note) && t3[0].status === 'pending' && t3[0].attempts === 1);

  const s4 = make({ write_to_tracker: true, user_id: '33333333-3333-3333-3333-333333333333' });   // a new account, so its businesses are new
  const brokenTracker = { ...fakeTracker, openTracker: async () => { throw new Error('No "Webese Alabama Outreach Tracker" sheet is shared'); } };
  await sw.tick(sb, db.blade_sweeps.find(x => x.id === s4.id), { ...deps, trackerLib: brokenTracker });
  const S4 = db.blade_sweeps.find(x => x.id === s4.id);
  check('if the tracker cannot be written the sweep pauses, and the businesses are still kept in Audema', S4.status === 'paused' && /Could not write to the Alabama tracker/.test(S4.status_note) && db.blade_sweep_leads.filter(l => l.sweep_id === s4.id && l.qualified).length === 2 && db.blade_sweep_tasks.filter(x => x.sweep_id === s4.id && x.status === 'done').length === 1);

  const s5 = { id: uuid(), user_id: USER, root: { level: 'country', countryCode: 'US', countryName: 'USA', geonameId: 6252001 }, frontier: clone(cp.frontier), sectors: ['Roofers'], min_population: 0, pages_per_town: 1, max_searches: 100, searches_used: 0, status: 'running', write_to_tracker: false, trackers: {}, totals: {}, lock_until: null };
  db.blade_sweeps.push(s5);
  await sw.tick(sb, db.blade_sweeps.find(x => x.id === s5.id), deps);
  const S5 = db.blade_sweeps.find(x => x.id === s5.id);
  check('a country sweep lists each state as it gets there and works through all of them', S5.status === 'done' && db.blade_sweep_tasks.filter(x => x.sweep_id === s5.id).length === 4 && S5.frontier.length === 0);
  check('without the tracker option nothing is written to any sheet', !written.some(w => w.run.summary && db.blade_sweep_tasks.some(x => x.sweep_id === s5.id && w.run.place === x.place_name && w.run.summary.includes('Savannah'))));

  /* ── the endpoints ──────────────────────────────────────────────────── */
  console.log('\n──── the endpoints ────');
  mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h, reportFailureAsync() {}, reportFailure() {} });
  mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
  let callerId = null;
  mockModule('api/_lib/require-user.js', {
    requireUser: async (req, res) => { if (!callerId) { res.status(401).json({ error: 'Sign in' }); return null; } return { user: { id: callerId }, profile: db.profiles.find(p => p.id === callerId) || { role: 'user' } }; },
    callerOwnsScope: async () => true,
  });
  mockModule('api/_lib/geonames.js', { ...fakeGeo, NOT_CONFIGURED: 'GEONAMES_USERNAME is not set.' });
  let fleetRecent = false;
  mockModule('api/_lib/webese-tracker.js', { ...wt, openTracker: async (st) => ({ ref: { fileId: st, name: `Webese ${st} Outreach Tracker`, url: 'https://docs.google.com/x' }, history: { rows: fleetRecent ? [{ Timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '), Agent: 'Webese First-Pass Fleet' }] : [] } }) });
  delete require.cache[require.resolve(path.join(REPO, 'api/_lib/blade-sweep.js'))];
  Object.assign(process.env, { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GOOGLE_PLACES_API_KEY: 'pk', CRON_SECRET: 'cs' });
  const load = (n) => { const p = path.join(REPO, `api/${n}.js`); delete require.cache[require.resolve(p)]; return require(p); };
  const api = load('blade-sweeps');
  const res = () => { const r = { statusCode: 200 }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = () => {}; r.end = () => r; return r; };
  const call = async (who, body) => { callerId = who; const r = res(); await api({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, r); return r; };
  const ROOT = { level: 'state', countryCode: 'US', countryName: 'United States', geonameId: 1, adminCode1: 'AL', stateName: 'Alabama' };

  check('no session is refused', (await call(null, { action: 'list' })).statusCode === 401);
  const est = await call(USER, { action: 'estimate', root: ROOT, sectors: 'roofers, plumbers', pagesPerTown: 2 });
  check('an estimate counts towns × trades and the most searches it could take, saving nothing', est.body.estimate.towns === 3 && est.body.estimate.tasks === 6 && est.body.estimate.maxSearchesNeeded === 12 && db.blade_sweeps.filter(x => x.user_id === USER).length === 1);
  check('a sweep needs trades', (await call(USER, { action: 'estimate', root: ROOT, sectors: '' })).body.field === 'sectors');
  check('a sweep needs a search budget', (await call(USER, { action: 'create', root: ROOT, sectors: 'roofers' })).body.field === 'maxSearches');
  check('a customer cannot write into the Webese trackers', (await call(USER, { action: 'create', root: ROOT, sectors: 'roofers', maxSearches: 10, writeToTracker: true })).body.code === 'tracker_not_allowed');
  check('trackers are US-only', (await call(ADMIN, { action: 'create', root: { ...ROOT, countryCode: 'GB', countryName: 'UK' }, sectors: 'roofers', maxSearches: 10, writeToTracker: true })).statusCode === 422);
  fleetRecent = true;
  const fl = await call(ADMIN, { action: 'create', root: ROOT, sectors: 'roofers', maxSearches: 10, writeToTracker: true });
  check('if the ChatGPT Fleet worked the state recently, Blade asks before taking over the cursor', fl.statusCode === 409 && fl.body.code === 'fleet_recent' && /Switch it off for Alabama/.test(fl.body.error));
  const made = await call(ADMIN, { action: 'create', root: ROOT, sectors: 'roofers, plumbers', maxSearches: 50, writeToTracker: true, acknowledgeFleet: true });
  const sweepId = made.body.sweep && made.body.sweep.id;
  check('once confirmed the sweep is created with its towns queued and the tracker remembered', made.body.ok && db.blade_sweep_tasks.filter(x => x.sweep_id === sweepId).length === 6 && made.body.sweep.trackers.Alabama.fileId === 'Alabama');
  fleetRecent = false;
  check('another account cannot see or touch it', (await call(STRANGER, { action: 'get', id: sweepId })).statusCode === 404 && (await call(STRANGER, { action: 'cancel', id: sweepId })).statusCode === 404);
  const g = await call(ADMIN, { action: 'get', id: sweepId });
  check('progress shows tasks pending and what comes next', g.body.counts.pending === 6 && g.body.next.place_name === 'Foley');
  check('pause and resume work; a budget below what is used is refused', (await call(ADMIN, { action: 'pause', id: sweepId })).body.sweep.status === 'paused' && (await call(ADMIN, { action: 'resume', id: sweepId })).body.sweep.status === 'running' && (await call(ADMIN, { action: 'budget', id: sweepId, maxSearches: -1 })).statusCode === 400);
  const ls = await call(ADMIN, { action: 'list' });
  check('the list says whether this account may write trackers', ls.body.canWriteTrackers === true && (await call(USER, { action: 'list' })).body.canWriteTrackers === false);

  const cron = load('cron-blade-sweeps');
  const cr = res(); await cron({ headers: {} }, cr);
  check('the cron refuses without its secret', cr.statusCode === 401);

  /* ── the page ───────────────────────────────────────────────────────── */
  console.log('\n──── the page ────');
  const page = fs.readFileSync(path.join(REPO, 'web/agents/blade-sweeps.html'), 'utf8');
  const js = page.split('<script>').pop();
  const htmlLines = js.split('\n').filter(l => /innerHTML|<\/?[a-z]/.test(l) && !/textContent/.test(l));
  const raw = htmlLines.flatMap(l => [...l.matchAll(/\$\{(?!esc\()([^}]*?(?:name|note|error|place_name|county_name|sector|status_note|serviceAccount)[^}]*)\}/g)].map(m => m[1])).filter(x => !/esc\(|=>|\?/.test(x));
  check('everything shown from GeoNames, Google and the database is escaped', raw.length === 0);
  if (raw.length) console.log('      ', raw);
  check('tracker links are only http(s)', /safeHref\(ref\.url\)/.test(js));
  check('the CSV export guards against spreadsheet formula injection', /\^\[=\+\\-@\\t\\r\]/.test(js));
  check('the page says every search is paid and there is a budget', /paid Google Places call/.test(page) && /search budget/.test(page));
  check('Blade links to it', /href="\/agents\/blade-sweeps\.html"/.test(fs.readFileSync(path.join(REPO, 'web/agents/blade-agent.html'), 'utf8')));
  const vercel = JSON.parse(fs.readFileSync(path.join(REPO, 'vercel.json'), 'utf8'));
  check('the sweep cron is scheduled', vercel.crons.some(c => c.path === '/api/cron-blade-sweeps'));
  check('the tables are in the installer', /CREATE TABLE IF NOT EXISTS blade_sweep_tasks/.test(fs.readFileSync(path.join(REPO, 'supabase-install-all.sql'), 'utf8')));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
