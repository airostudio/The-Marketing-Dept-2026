/**
 * Admin dashboard checks.
 *
 * The thing that must be right here is that no figure implies a measurement
 * that did not happen. Two cases matter most:
 *
 *   1. MRR. Enterprise and Agency plans are negotiated individually, so their
 *      value is NOT knowable from the plan name. Counting them at zero
 *      understates revenue; guessing a number invents it. They are counted
 *      separately and the basis is stated in the product.
 *   2. A missing table and an empty table both produce a count of zero, and
 *      mean completely different things. "Metering isn't installed" must
 *      never render as "no missions were run".
 *
 *   PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tests/admin-dashboard/run.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const fail = [];
const check = (name, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) fail.push(name);
};

const PL = require(path.join(REPO, 'api/_lib/plan-limits.js'));

/* ── 1. The endpoint ────────────────────────────────────────────────────── */
console.log('──── metrics endpoint ────');

let state, calls;
const helperPath = path.join(REPO, 'api/_lib/supabase-rest.js');
require.cache[helperPath] = {
  id: helperPath, filename: helperPath, loaded: true,
  exports: {
    sbRest: async (u, k, method, p) => {
      calls.push(p);
      if (p.startsWith('/profiles?id=eq.')) {
        return { ok: true, status: 200, data: [{ role: state.callerRole }] };
      }
      if (p.startsWith('/profiles?select=')) {
        return { ok: true, status: 200, data: state.profiles };
      }
      if (p.startsWith('/mission_usage')) {
        return state.missionTableMissing
          ? { ok: false, status: 404, data: null }
          : { ok: true, status: 200, data: state.usage };
      }
      if (p.startsWith('/billing_events')) {
        return state.billingTableMissing
          ? { ok: false, status: 404, data: null }
          : { ok: true, status: 200, data: state.events };
      }
      return { ok: false, status: 404, data: null };
    },
  },
};

const handler = require(path.join(REPO, 'api/admin-metrics.js'));
global.fetch = async (url) => {
  if (String(url).includes('/auth/v1/user')) {
    return state.token
      ? { ok: true, json: async () => ({ id: 'admin-1' }) }
      : { ok: false, json: async () => ({}) };
  }
  throw new Error('unexpected fetch ' + url);
};

async function call(opts) {
  opts = opts || {};
  process.env.SUPABASE_URL = 'https://x.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
  calls = [];
  let status = 200, payload = null;
  const res = { setHeader() {}, status(c) { status = c; return this; },
                json(o) { payload = o; return this; }, end() { return this; } };
  await handler({ method: 'POST', headers: { authorization: opts.noAuth ? '' : 'Bearer t' }, body: {} }, res);
  return { status, body: payload };
}

function reset(o) {
  state = Object.assign({
    token: true, callerRole: 'admin',
    missionTableMissing: false, billingTableMissing: false,
    profiles: [
      { id: 'u1', plan: 'growth',     subscription_status: 'active',   created_at: new Date().toISOString(), role: 'user' },
      { id: 'u2', plan: 'start',      subscription_status: 'active',   created_at: new Date().toISOString(), role: 'user' },
      { id: 'u3', plan: 'enterprise', subscription_status: 'active',   created_at: new Date().toISOString(), role: 'user' },
      { id: 'u4', plan: 'free',       subscription_status: null,       created_at: new Date().toISOString(), role: 'admin' },
      { id: 'u5', plan: 'growth',     subscription_status: 'canceled', created_at: new Date().toISOString(), role: 'user' },
    ],
    usage: [{ user_id: 'u1', period: PL.currentPeriod(), used: 60 },
            { user_id: 'u2', period: PL.currentPeriod(), used: 4 }],
    events: [{ event_type: 'checkout.session.completed', created_at: 'now' }],
  }, o || {});
}

(async () => {
  reset();
  let r = await call();
  const d = r.body;
  console.log('  MRR:', d.revenue.estimatedMrrAud, '| paying:', d.revenue.payingAccounts,
              '| custom-priced:', d.revenue.customPricedAccounts);

  check('an admin gets metrics', r.status === 200);
  check('MRR sums only published prices for collecting subscriptions',
    d.revenue.estimatedMrrAud === PL.PLAN_MONTHLY_PRICE_AUD.growth + PL.PLAN_MONTHLY_PRICE_AUD.start);
  check('a custom-priced account is counted separately, not at zero',
    d.revenue.customPricedAccounts === 1);
  check('a canceled subscription contributes no revenue', d.revenue.payingAccounts === 3);
  check('the basis of the MRR figure is stated', /negotiated individually/i.test(d.revenue.basis));
  check('accounts are grouped by plan', d.accounts.byPlan.growth === 2 && d.accounts.byPlan.free === 1);
  check('subscription statuses are grouped', d.accounts.byStatus.active === 3 && d.accounts.byStatus.none === 1);
  check('admins are counted', d.accounts.admins === 1);
  check('an account at its mission limit is flagged',
    d.missions.accountsAtOrOverLimit === 1);   // u1 on growth used 60 of 60
  check('mission totals are summed for the period',
    d.missions.thisPeriodTotal === 64);

  console.log('\n──── missing vs empty ────');
  reset({ missionTableMissing: true });
  r = await call();
  check('a missing mission table reports unavailable, not zero',
    r.body.missions.available === false && /does not exist yet/i.test(r.body.missions.reason));

  reset({ billingTableMissing: true });
  r = await call();
  check('a missing billing table reports unavailable', r.body.billingEvents.available === false);

  reset({ events: [] });
  r = await call();
  check('an empty billing table is available-but-empty, a different state',
    r.body.billingEvents.available === true && r.body.billingEvents.total === 0 &&
    /No Stripe webhook events/i.test(r.body.billingEvents.note));

  console.log('\n──── access ────');
  reset({ callerRole: 'user' });
  r = await call();
  check('a non-admin is refused', r.status === 403);
  reset({ token: false });
  r = await call();
  check('an invalid token is refused', r.status === 401);
  reset();
  r = await call({ noAuth: true });
  check('no token is refused', r.status === 401);
  reset();
  await call();
  check('the role is read from the database, not the request',
    calls.some(p => p.startsWith('/profiles?id=eq.')));

  /* ── 2. The page ──────────────────────────────────────────────────────── */
  console.log('\n──── the dashboard renders ────');

  let scenario = 'full';
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];
    if (u === '/admin/dashboard.html') {
      let html = fs.readFileSync(path.join(REPO, 'web/admin/dashboard.html'), 'utf8');
      // Stubs after the real modules, or they get overwritten.
      html = html.replace('<script src="/js/auth.js"></script>', `<script>
        window.Supabase={ready:async()=>{},DB:{getProfile:async()=>({role:'admin'})},
          getClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'t'}}})}})};
        window.Auth={getUser:async()=>({id:'admin-1'})};
      </script>`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (u === '/api/admin-metrics') {
      const base = {
        generatedAt: new Date().toISOString(), period: PL.currentPeriod(),
        planLabels: PL.PLAN_LABELS,
        accounts: { available: true, total: 5, admins: 1,
          byPlan: { growth: 2, start: 1, enterprise: 1, free: 1 },
          byStatus: { active: 3, canceled: 1, none: 1 },
          signupsByMonth: { '2026-04': 1, '2026-05': 2, '2026-06': 2 } },
        revenue: { estimatedMrrAud: 1048, payingAccounts: 3, customPricedAccounts: 1,
          basis: 'Sum of published monthly prices... negotiated individually...', pricedPlans: [] },
        missions: scenario === 'noMeter'
          ? { available: false, reason: 'This table does not exist yet — the migration for it has not been run.', byMonth: {}, thisPeriodTotal: 0, accountsAtOrOverLimit: 0 }
          : { available: true, byMonth: { '2026-05': 12, '2026-06': 64 }, thisPeriodTotal: 64, accountsAtOrOverLimit: 1 },
        billingEvents: { available: true, total: 0, byType: {}, note: 'No Stripe webhook events have been received yet.' },
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(base));
    }
    const m = u.match(/^\/js\/([\w.-]+)$/);
    if (m) {
      const f = path.join(REPO, 'web/js', m[1]);
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
        return res.end(fs.readFileSync(f, 'utf8'));
      }
      res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end('');
    }
    res.writeHead(404); res.end();
  });

  await new Promise(done => server.listen(0, done));
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(`http://localhost:${port}/admin/dashboard.html`);
  await page.waitForTimeout(1200);

  const view = await page.evaluate(() => ({
    visible: document.getElementById('wrap').style.display === 'block',
    chartsDrawn: [...document.querySelectorAll('canvas')].filter(c => c.width > 0).length,
    cards: document.getElementById('cards').textContent,
    banners: document.getElementById('banners').textContent,
    chartLib: typeof Chart !== 'undefined',
  }));
  console.log('  charts drawn:', view.chartsDrawn, '| Chart.js loaded:', view.chartLib);

  check('the vendored Chart.js actually loads', view.chartLib === true);
  check('the dashboard renders for an admin', view.visible);
  check('charts are drawn onto canvases', view.chartsDrawn >= 3);
  check('MRR is shown', /A\$1,048/.test(view.cards));
  check('custom-priced accounts are called out as excluded',
    /custom pricing, not included/i.test(view.cards));
  check('the MRR basis is stated on the page, not just in code',
    /negotiated individually/i.test(view.banners));
  check('an empty billing table reads as "none received", not as a failure',
    /None received yet/i.test(view.cards));

  // Metering not installed must not read as "zero missions".
  scenario = 'noMeter';
  await page.goto(`http://localhost:${port}/admin/dashboard.html?n=2`);
  await page.waitForTimeout(1200);
  const noMeter = await page.evaluate(() => ({
    cards: document.getElementById('cards').textContent,
    banners: document.getElementById('banners').textContent,
    missionArea: document.getElementById('mission-unavailable').textContent,
  }));
  check('an uninstalled meter shows an em dash, not 0',
    /Mission metering not installed/i.test(noMeter.cards));
  check('and says which migration to run',
    /supabase-mission-usage\.sql/.test(noMeter.banners + noMeter.missionArea));
  check('and explicitly distinguishes itself from "zero missions run"',
    /different from "zero missions run"/i.test(noMeter.missionArea));

  check('no JS errors', errs.length === 0);
  if (errs.length) console.log('  errors:', errs.slice(0, 3));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));

  await browser.close();
  server.close();
  process.exit(fail.length === 0 ? 0 : 1);
})();
