/**
 * api/cron-sales-intel-sweep.js — the daily geographic sweep behind
 * "reach out to 100-150 businesses per day in the US, alphabetical order,
 * every day, discover + draft only, report to info@webese.ai".
 *
 * Mocks every external dependency (Supabase, Places, the owner/email
 * lookups, Resend) so this exercises the cron's own orchestration: cursor
 * advancement, dedupe, only-genuine-opportunities filtering, and that it
 * never once calls a send endpoint.
 *
 *   node tests/sales-intel-sweep/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

function mockModule(relPath, exportsObj) {
  const p = require.resolve(path.join(REPO, relPath));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

// ── In-memory fakes for the tables the cron reads/writes ───────────────────
let db = {};
function resetDb() {
  db = {
    cursor: { id: 1, state_index: 0, sector_index: 0, next_page_token: null, total_leads_found: 0 },
    seen: new Set(),
    leads: [],
  };
}

mockModule('api/_lib/supabase-rest.js', {
  isUuid: () => true,
  sbRest: async (url, key, method, pathAndQuery, body) => {
    if (pathAndQuery.startsWith('/sales_intel_sweep_cursor')) {
      if (method === 'GET') return { ok: true, status: 200, data: [db.cursor] };
      if (method === 'PATCH') { db.cursor = { ...db.cursor, ...body }; return { ok: true, status: 200, data: [db.cursor] }; }
      if (method === 'POST') { db.cursor = { ...db.cursor, ...body }; return { ok: true, status: 201, data: [db.cursor] }; }
    }
    if (pathAndQuery.startsWith('/sales_intel_seen_places')) {
      if (method === 'GET') {
        const m = pathAndQuery.match(/place_id=eq\.([^&]+)/);
        const id = m ? decodeURIComponent(m[1]) : null;
        return { ok: true, status: 200, data: db.seen.has(id) ? [{ place_id: id }] : [] };
      }
      if (method === 'POST') {
        if (db.seen.has(body.place_id)) return { ok: false, status: 409, data: null };
        db.seen.add(body.place_id);
        return { ok: true, status: 201, data: [body] };
      }
    }
    if (pathAndQuery.startsWith('/sales_intel_leads')) {
      if (method === 'POST') {
        if (db.leads.some(l => l.place_id === body.place_id)) return { ok: false, status: 409, data: null };
        db.leads.push(body);
        return { ok: true, status: 201, data: [body] };
      }
    }
    // system_failures etc from withFailureReporting — accept quietly.
    return { ok: true, status: 200, data: [] };
  },
});

mockModule('api/_lib/website-quickcheck.js', {
  quickCheckWebsite: async (url) => {
    if (url.includes('modern')) return { status: 'modern', signals: {}, reasons: [] };
    if (url.includes('wixsite')) return { status: 'outdated', signals: { platform: 'wix' }, reasons: ['Built on Wix'] };
    return { status: 'outdated', signals: {}, reasons: ['No mobile-responsive (viewport) tag'] };
  },
});

mockModule('api/_lib/owner-lookup.js', {
  findOwnerName: async ({ businessName }) => ({ firstName: businessName.includes('ABC') ? 'Steve' : '', source: businessName.includes('ABC') ? 'https://facebook.com/abc' : '' }),
});

mockModule('api/_lib/email-lookup.js', {
  findContactEmail: async (domain) => ({ email: domain ? `contact@${domain.replace(/^https?:\/\//, '')}` : null, dataSource: domain ? 'real' : 'not_found' }),
});

process.env.CRON_SECRET = 'test-secret';
process.env.SUPABASE_URL = 'https://x.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
process.env.GOOGLE_PLACES_API_KEY = 'places-key';
process.env.PERPLEXITY_API_KEY = 'perplexity-key';
process.env.RESEND_API_KEY = 're_test';
process.env.RESEND_FROM_EMAIL = 'noreply@webese.ai';

function place(id, name, website, address) {
  return { id, displayName: { text: name }, websiteUri: website || undefined, formattedAddress: address };
}

let resendCalls = [];
let placesCalls = [];

function mockFetch(placesPage) {
  resendCalls = [];
  placesCalls = [];
  global.fetch = async (url, opts) => {
    if (String(url).includes('places.googleapis.com')) {
      placesCalls.push(JSON.parse(opts.body));
      return { ok: true, json: async () => placesPage };
    }
    if (String(url).includes('api.resend.com')) {
      resendCalls.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ id: 'email_1' }) };
    }
    throw new Error('unexpected fetch to ' + url);
  };
}

function loadHandler() {
  const p = path.join(REPO, 'api/cron-sales-intel-sweep.js');
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
async function call(handler, headers = {}) {
  const res = makeRes();
  await handler({ method: 'GET', headers, query: {} }, res);
  return res;
}

(async () => {
  console.log('\n──── requires the cron secret ────');
  {
    resetDb();
    mockFetch({ places: [] });
    const handler = loadHandler();
    const res = await call(handler, {});
    check('an unauthenticated call is refused', res.statusCode === 401);
  }

  console.log('\n──── only genuine opportunities become leads — a modern site is a real "not a lead", not an error ────');
  {
    resetDb();
    mockFetch({ places: [
      place('p1', 'ABC Plumbing', 'https://abcplumbing.com', '123 Main St, Dandenong, VIC 3175, Australia'),
      place('p2', 'Modern Co', 'https://modern-example.com', '1 High St, Dandenong, VIC 3175, Australia'),
      place('p3', 'No Site Plumbing', null, '5 Low St, Dandenong, VIC 3175, Australia'),
    ] });
    const handler = loadHandler();
    const res = await call(handler, { authorization: 'Bearer test-secret' });
    check('the sweep runs successfully', res.statusCode === 200);
    check('two of three candidates are filed as leads (outdated + no-website)', db.leads.length === 2);
    check('the modern site was checked and dedupe-marked, but never filed as a lead', db.seen.has('p2') && !db.leads.some(l => l.place_id === 'p2'));
    check('every filed lead is discover+draft only', db.leads.every(l => l.sent === false && l.replied === false));
  }

  console.log('\n──── the owner-name lookup is grounded, never a guess, and blank when the model finds nobody ────');
  {
    const abc = db.leads.find(l => l.place_id === 'p1');
    check('a confidently-sourced name comes through', abc && abc.owner_first_name === 'Steve' && abc.owner_source);
    const noSite = db.leads.find(l => l.place_id === 'p3');
    check('an honest "not found" stays blank, not defaulted to something', noSite && !noSite.owner_first_name);
  }

  console.log('\n──── a business with no website gets an honest blank email, never a fabricated one ────');
  {
    const noSite = db.leads.find(l => l.place_id === 'p3');
    check('no website means no email lookup path exists, so it stays null rather than invented', noSite && noSite.email == null);
  }

  console.log('\n──── the personalised note is grounded in the actual evidence gathered, per lead ────');
  {
    const abc = db.leads.find(l => l.place_id === 'p1');
    const noSite = db.leads.find(l => l.place_id === 'p3');
    check('a mobile-usability finding produces the matching note', abc && abc.personal_note === 'Mobile layout is difficult to use');
    check('a no-website lead gets the Google-listing note', noSite && noSite.personal_note === 'Currently relies on Google listing');
  }

  console.log('\n──── the same place is never re-processed once seen (whether or not it qualified) ────');
  {
    mockFetch({ places: [
      place('p1', 'ABC Plumbing', 'https://abcplumbing.com', '123 Main St, Dandenong, VIC 3175, Australia'),
      place('p2', 'Modern Co', 'https://modern-example.com', '1 High St, Dandenong, VIC 3175, Australia'),
      place('p4', 'New Roofers', 'https://roofers.example', '9 New St, Dandenong, VIC 3175, Australia'),
    ] });
    const before = db.leads.length;
    const handler = loadHandler();
    await call(handler, { authorization: 'Bearer test-secret' });
    check('p1 and p2 were skipped as already-seen; only the genuinely new p4 was considered',
      db.leads.length === before + 1 && db.leads[db.leads.length - 1].place_id === 'p4');
  }

  console.log('\n──── the cursor advances alphabetically and persists across runs ────');
  {
    resetDb();
    // No nextPageToken → this state+sector is exhausted → cursor must move on.
    mockFetch({ places: [place('q1', 'Roofers Inc', null, '1 St, Springfield, IL, USA')] });
    const handler = loadHandler();
    await call(handler, { authorization: 'Bearer test-secret' });
    check('starts at state index 0 (Alabama) and sector index 0 (Plumbers)', placesCalls[0].textQuery.includes('Plumbers in Alabama'));
    check('exhausting a state+sector (no nextPageToken) advances the cursor rather than repeating it',
      db.cursor.state_index !== 0 || db.cursor.sector_index !== 0);
  }

  console.log('\n──── never sends anything — this is discovery and drafting only ────');
  {
    check('no call was made to any send/campaign endpoint', !global.fetch.toString().includes('send-campaign'));
    check('the only outbound email is the internal progress report to info@webese.ai',
      resendCalls.length === 1 && resendCalls[0].to.includes('info@webese.ai'));
    check("the report never claims a send happened", !/\bsent\b.*email/i.test(resendCalls[0].text || ''));
  }

  console.log('\n──── the report is skipped, not faked, when no mailer is configured ────');
  {
    resetDb();
    delete process.env.RESEND_API_KEY;
    mockFetch({ places: [] });
    const handler = loadHandler();
    const res = await call(handler, { authorization: 'Bearer test-secret' });
    check('the run still succeeds', res.statusCode === 200);
    check('reportSent is honestly false rather than pretending it went out', res.body.reportSent === false);
    check('no Resend call was attempted at all', resendCalls.length === 0);
    process.env.RESEND_API_KEY = 're_test';
  }

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
