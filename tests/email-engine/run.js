/**
 * Email Engine workflow checks.
 *
 * The Email Engine had a working core — contacts, segments, the QA gate, the
 * batched Resend send — wrapped in a layer that reported things nobody had
 * measured. Three of those, in the order they would mislead a customer:
 *
 *   1. Opens and clicks were never recorded. api/resend-webhook.js handled
 *      only bounces and complaints, so campaign.stats.opens was 0 for every
 *      campaign ever sent and the UI printed "0.0% open rate" as a result.
 *      "Nobody opened it" and "nobody counted" are different sentences.
 *   2. web/marketing/email-marketing.html served ~250 lines of invented
 *      campaigns, segment sizes, conversion rates and a 98.7% delivery panel,
 *      none of it wired to anything.
 *   3. getDeliverabilityMetrics() returned 100% placement and 'healthy' for an
 *      account that had never sent an email.
 *
 *   PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tests/email-engine/run.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '../..');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const fail = [];
const check = (name, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) fail.push(name);
};
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

/* ── Fake Supabase for the two endpoints ────────────────────────────────── */
let db, tableMissing;
function reset() {
  tableMissing = false;
  db = { events: [], contacts: {} };
}

const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
require.cache[helperPath] = {
  id: helperPath, filename: helperPath, loaded: true,
  exports: {
    sbRest: async (u, k, method, p, body) => {
      if (p.startsWith('/email_events')) {
        if (tableMissing) return { ok: false, status: 404, data: null };
        if (method === 'POST') {
          // Enforce the unique index so a webhook retry is a conflict.
          const dupe = db.events.some(e =>
            e.email_id && e.email_id === body.email_id &&
            e.event_type === body.event_type && e.occurred_at === body.occurred_at);
          if (dupe) return { ok: false, status: 409, data: null };
          db.events.push(body);
          return { ok: true, status: 201, data: [body] };
        }
      }
      if (p.startsWith('/rpc/campaign_email_stats')) {
        if (tableMissing) return { ok: false, status: 404, data: null };
        const rows = db.events.filter(e => e.campaign_id === body.cid);
        const count = t => rows.filter(e => e.event_type === t).length;
        const uniq = t => new Set(rows.filter(e => e.event_type === t).map(e => e.email_id)).size;
        return { ok: true, status: 200, data: [{
          sent: count('sent'), delivered: count('delivered'),
          opened: count('opened'), unique_opened: uniq('opened'),
          clicked: count('clicked'), unique_clicked: uniq('clicked'),
          bounced: count('bounced'), complained: count('complained'),
          first_event: rows[0] ? rows[0].occurred_at : null,
          last_event: rows.length ? rows[rows.length - 1].occurred_at : null,
        }] };
      }
      if (p.startsWith('/contacts?id=eq.')) {
        db.contacts[p.split('id=eq.')[1].split('&')[0]] = body.status;
        return { ok: true, status: 200, data: [] };
      }
      return { ok: false, status: 404, data: null };
    },
  },
};

const SECRET = 'whsec_' + Buffer.from('test-signing-key-0123456789').toString('base64');
const webhook = require(path.join(REPO, 'api/resend-webhook.js'));
const stats = require(path.join(REPO, 'api/campaign-stats.js'));

global.fetch = async (url) => {
  if (String(url).includes('/auth/v1/user')) {
    return { ok: true, json: async () => ({ id: 'user-1' }) };
  }
  throw new Error('unexpected fetch ' + url);
};

/** Deliver a signed webhook exactly as Resend would. */
async function deliver(event) {
  process.env.RESEND_WEBHOOK_SECRET = SECRET;
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';

  const raw = Buffer.from(JSON.stringify(event));
  const id = 'msg_' + Math.random().toString(36).slice(2);
  const ts = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw.toString('utf8')}`).digest('base64');

  const req = Object.assign(
    (async function* () { yield raw; })(),
    { method: 'POST', headers: { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` } }
  );
  // The handler reads the body via stream events, not async iteration.
  const listeners = {};
  req.on = (ev, fn) => { listeners[ev] = fn; return req; };
  setImmediate(() => { listeners.data && listeners.data(raw); listeners.end && listeners.end(); });

  let status = 200, payload = null;
  const res = { status(c) { status = c; return this; }, json(o) { payload = o; return this; },
                end() { return this; }, setHeader() {} };
  await webhook(req, res);
  return { status, body: payload };
}

async function getStats(campaignId) {
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  let status = 200, payload = null;
  const res = { setHeader() {}, status(c) { status = c; return this; },
                json(o) { payload = o; return this; }, end() { return this; } };
  await stats({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { campaignId } }, res);
  return { status, body: payload };
}

const ev = (type, over) => Object.assign({
  type,
  created_at: '2026-09-01T10:00:00.000Z',
  data: {
    email_id: 'em_1',
    to: ['someone@example.com'],
    created_at: '2026-09-01T10:00:00.000Z',
    tags: [{ name: 'campaign_id', value: 'camp_A' },
           { name: 'contact_id', value: '11111111-1111-1111-1111-111111111111' }],
  },
}, over || {});

(async () => {
  /* ── 1. The webhook now records engagement ────────────────────────────── */
  console.log('──── the webhook records what happens ────');
  reset();

  let r = await deliver(ev('email.sent'));
  check('a send event is accepted', r.status === 200);
  check('and recorded', db.events.length === 1 && db.events[0].event_type === 'sent');
  check('attributed to its campaign', db.events[0].campaign_id === 'camp_A');
  check('and to its contact', db.events[0].contact_id === '11111111-1111-1111-1111-111111111111');

  await deliver(ev('email.delivered', { data: Object.assign({}, ev('x').data, { created_at: '2026-09-01T10:01:00.000Z' }) }));
  await deliver(ev('email.opened',    { data: Object.assign({}, ev('x').data, { created_at: '2026-09-01T10:05:00.000Z' }) }));
  check('an open is recorded — it used to be dropped on the floor',
    db.events.some(e => e.event_type === 'opened'));

  await deliver(ev('email.clicked', { data: Object.assign({}, ev('x').data, {
    created_at: '2026-09-01T10:06:00.000Z', click: { link: 'https://acme.test/offer' } }) }));
  const click = db.events.find(e => e.event_type === 'clicked');
  check('a click is recorded with the URL that was clicked',
    click && click.link_url === 'https://acme.test/offer');

  // Resend retries until it gets a 200. A retry must not inflate the count.
  const before = db.events.length;
  await deliver(ev('email.opened', { data: Object.assign({}, ev('x').data, { created_at: '2026-09-01T10:05:00.000Z' }) }));
  check('a retried webhook does not double-count the open', db.events.length === before);
  check('and the retry still answers 200, so Resend stops retrying',
    (await deliver(ev('email.opened', { data: Object.assign({}, ev('x').data, { created_at: '2026-09-01T10:05:00.000Z' }) }))).status === 200);

  // Tags come back from Resend as an array of {name,value}; reading
  // `tags.contact_id` off an array silently yields undefined.
  reset();
  await deliver(ev('email.complained'));
  check('a complaint suppresses the contact, with array-shaped tags',
    db.contacts['11111111-1111-1111-1111-111111111111'] === 'complained');
  reset();
  await deliver({ type: 'email.complained', data: {
    email_id: 'em_2', created_at: '2026-09-01T10:00:00.000Z',
    tags: { campaign_id: 'camp_A', contact_id: '11111111-1111-1111-1111-111111111111' } } });
  check('and with object-shaped tags too',
    db.contacts['11111111-1111-1111-1111-111111111111'] === 'complained');

  reset();
  tableMissing = true;
  r = await deliver(ev('email.opened'));
  check('a missing events table still returns 200 — a 500 makes Resend retry forever',
    r.status === 200);

  /* ── 2. Stats separate "nobody opened" from "nobody counted" ──────────── */
  console.log('\n──── zero opens is not the same as no tracking ────');
  reset();

  // Delivery events but no opens: tracking is off at Resend.
  await deliver(ev('email.sent'));
  await deliver(ev('email.delivered', { data: Object.assign({}, ev('x').data, { created_at: '2026-09-01T10:01:00.000Z' }) }));
  let s = await getStats('camp_A');
  check('delivered events give a real delivery rate', s.body.rates.delivered === 100);
  check('an untracked open rate is null, not 0', s.body.rates.openRate === null);
  check('and the state is named', s.body.openTracking === 'not-recorded');
  check('and explained in words', /off by default/i.test(s.body.notes));

  // Now a real open arrives.
  await deliver(ev('email.opened', { data: Object.assign({}, ev('x').data, { created_at: '2026-09-01T10:05:00.000Z' }) }));
  s = await getStats('camp_A');
  check('a real open produces a real open rate', s.body.rates.openRate === 100);
  check('and the state flips to tracked', s.body.openTracking === 'tracked');

  s = await getStats('camp_NOTHING');
  check('a campaign with no events at all is its own state',
    s.body.openTracking === 'no-events' && s.body.rates.openRate === null);
  check('and does not claim a 0% delivery rate either', s.body.rates.delivered === null);

  tableMissing = true;
  s = await getStats('camp_A');
  check('an uninstalled events table reports not_installed, not zero engagement',
    s.status === 503 && s.body.code === 'not_installed');
  check('and names the migration', /supabase-email-events\.sql/.test(s.body.error));

  /* ── 3. Deliverability no longer asserts perfection from nothing ──────── */
  console.log('\n──── deliverability with nothing sent ────');

  const svc = read('web/js/email-marketing-service.js');
  check('the zero-send case returns measured:false rather than 100%',
    /if \(!totalSent\)[\s\S]{0,200}measured: false/.test(svc));
  check('and no longer hardcodes a 100.0 placement',
    !/inboxPlacement[\s\S]{0,120}'100\.0'/.test(svc));
  check('"inbox placement" is no longer claimed — it was never measured',
    !/inboxPlacement:/.test(svc));
  check('and the replacement says what it actually counts',
    /acceptedRate/.test(svc));

  /* ── 4. The dashboard no longer ships invented data ───────────────────── */
  console.log('\n──── the email dashboard ────');

  const page = read('web/marketing/email-marketing.html');

  // Comment lines are stripped first. The fixes explain themselves by quoting
  // the figures they removed ("the old panel printed 98.7% delivered"), and a
  // plain substring search would fail on that prose forever — turning an
  // assertion about shipped markup into an assertion about how it is worded.
  const pageCode = page.split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l))
    .join('\n');

  const invented = ['24,530', '31,204', '48,320', '98.7%', '18.4%', '41.3%', '$14,820',
                    'January Product Launch', 'Weekly Digest #48', 'Abandoned Cart'];
  const stillThere = invented.filter(v => pageCode.includes(v));
  check('no invented campaign, segment or rate is left in the markup',
    stillThere.length === 0);
  if (stillThere.length) console.log('    still present:', stillThere);

  check('the campaign table is rendered from real send history',
    /renderCampaigns/.test(page) && /ContactsStore\.listCampaigns/.test(page));
  check('engagement per campaign comes from the stats endpoint',
    /\/api\/campaign-stats/.test(page));
  check('segments are rendered from the real contacts store',
    /ContactsStore\.listSegments/.test(page));
  check('automations say plainly that none are running',
    /No automation flows/.test(page));
  check('and the canned fallback email is gone',
    !/Unlock Your Exclusive Offer Inside/.test(pageCode) &&
    !/function getFallbackEmail/.test(pageCode) && !/getFallbackEmail\(/.test(pageCode));
  check('a failed generation says so instead of filling the preview',
    /showGeneratorError/.test(page));

  // Revenue is now real when orders have been reported, and blank with a
  // reason when they have not — never a zero, and never invented.
  check('revenue is rendered from reported orders, not from markup',
    /cell-revenue/.test(pageCode) && /d\.revenue/.test(pageCode));
  check('and a campaign with no reported orders shows a dash with the reason',
    /revenue\.textContent = '—'/.test(pageCode));

  // listCampaigns must not invent engagement of its own.
  const store = read('web/js/contacts-store.js');
  check('listCampaigns returns send counts only, not opens',
    /async function listCampaigns/.test(store) && !/opens:/.test(store.split('async function listCampaigns')[1].split('return {')[0]));

  /* ── 5. The page renders ──────────────────────────────────────────────── */
  console.log('\n──── the page renders honestly with no data ────');

  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/marketing/email-marketing.html') {
      let html = page.replace('<script src="/js/email-marketing-service.js"></script>', `
        <script src="/js/email-marketing-service.js"></script>
        <script>
          window.Supabase = { getClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }) } }) };
          window.checkAuth = async () => ({ id: 'user-1' });
          window.ContactsStore = {
            listCampaigns: async () => ({ available: true, campaigns: [] }),
            listSegments: async () => [],
          };
        </script>`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    const m = u.match(/^\/js\/([\w.-]+)$/);
    if (m) {
      const f = path.join(REPO, 'web/js', m[1]);
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      return res.end(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
    }
    res.writeHead(404); res.end();
  });
  await new Promise(done => server.listen(0, done));
  const port = server.address().port;

  const browser = await chromium.launch();
  const p = await browser.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(`http://localhost:${port}/marketing/email-marketing.html`);
  await p.waitForTimeout(1200);

  const view = await p.evaluate(() => document.body.innerText);
  check('an account with no campaigns is told so, not shown examples',
    /No campaigns have been sent from this account/i.test(view));
  check('deliverability says nothing was sent rather than showing a rate',
    /Nothing sent yet|No delivery events received/i.test(view));
  check('and no percentage is printed anywhere in the empty dashboard',
    !/\b\d{1,3}\.\d%/.test(view.replace(/0%/g, '')));
  check('segments report being empty', /No segments yet/i.test(view));

  check('no JS errors', errs.length === 0);
  if (errs.length) console.log('  errors:', errs.slice(0, 4));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));

  await browser.close();
  server.close();
  process.exit(fail.length === 0 ? 0 : 1);
})();
