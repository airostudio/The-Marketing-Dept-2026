/**
 * Analytics Brain.
 *
 * The module splits in two, and only one half was in trouble.
 *
 *   web/agents/analytics-agent.html — the agent itself — is honest. Its
 *   attribution parses touchpoint sequences the user pastes and does real
 *   arithmetic on them; its audience builder filters the real ContactsStore;
 *   its reports persist through AnalyticsStore. Nothing here fabricates.
 *
 *   web/marketing/analytics.html and marketing-analytics-service.js were the
 *   opposite. Findings:
 *
 *   1. The page's ONLY data path called MarketingAnalyticsService
 *      .getDashboardData() and .getAIInsights(). Neither method existed. Every
 *      load threw a TypeError, a catch swallowed it, and the page fell through
 *      to placeholder renders. Nothing a customer saw had touched their
 *      account. The GA4 path was equally broken three ways over: it called
 *      GoogleAnalytics.getDashboardData() (also nonexistent), from synchronous
 *      functions that returned the Promise instead of awaiting it, and nothing
 *      mapped GA4's {rows:[{dimensionValues,metricValues}]} envelope into
 *      anything a caller could read.
 *
 *   2. The service was built on invented constants: a flat trend series
 *      (traffic 3000, leads 90, conversions 18, revenue 9000 on every point),
 *      ten fake conversion paths, a hardcoded funnel [50000…2100], an LTV of
 *      $1,240, a churn rate of 5.2%, a digest scorecard of 72/100, and a goal
 *      projection of current × 1.3.
 *
 *   3. "Attribution" indexed a fixed weight table by the channel's position in
 *      the CHANNELS array rather than by a touch's position in a real path —
 *      so first-touch always credited SEO and last-touch always credited
 *      Referral, for every account, forever.
 *
 *   4. Removing the demo numbers in an earlier pass left division by zero: the
 *      funnel rendered height:NaNpx with "-NaN%" drop-offs under every stage.
 *
 *   5. The channel chart drew five sine waves labelled Organic/Paid/Social/
 *      Email/Referral.
 *
 *   node tests/analytics-brain/run.js
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const REPO = path.resolve(__dirname, '../..');

const fail = [];
const check = (name, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
  if (!cond) fail.push(name);
};
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const code = f => read(f).split('\n')
  .filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n');

(async () => {
  const svcSrc = code('web/js/marketing-analytics-service.js');
  const pageSrc = code('web/marketing/analytics.html');

  /* ── 1. The invented constants are gone ───────────────────────────────── */
  console.log('──── no invented numbers remain ────');

  const INVENTED = [
    ['the flat trend series',            /Math\.round\(3000 \* 1\.0\)/],
    ['the ten fake conversion paths',    /conversions: 142, *avgValue: 285/],
    ['the hardcoded funnel',             /\[50000, 28000, 14000, 7200, 3600, 2100\]/],
    ['the $1,240 lifetime value',        /avgLTV: 1240/],
    ['the LTV distribution buckets',     /range: '\$0-\$100'/],
    ['the 5.2% churn rate',              /overallChurnRate: 5\.2/],
    ['the invented churn segments',      /riskScore: 89/],
    ['the 72/100 digest scorecard',      /scorecard: \{ overall: 72 \}/],
    ['the current × 1.3 goal forecast',  /projectedValue: current \* 1\.3/],
    ['the 3.2× LTV multiplier',          /\* 3\.2\)/],
    ['the fabricated journey fallback',  /painPoints: \['Friction in navigation'\]/],
  ];
  INVENTED.forEach(([label, re]) => check(label + ' is gone', !re.test(svcSrc)));

  check('the channel chart no longer draws sine waves',
    !/30 \* Math\.sin\(/.test(pageSrc) && !/15 \* Math\.cos\(/.test(pageSrc));
  check('and plots a real series instead',
    /getChannelTrends/.test(pageSrc) && /sessions/.test(pageSrc));

  /* ── 2. The methods the page calls now exist ──────────────────────────── */
  console.log('\n──── the page and the service agree on an API ────');

  const svc = await loadService({ gaConfigured: false });
  check('getDashboardData exists', typeof svc.getDashboardData === 'function');
  check('getAIInsights exists', typeof svc.getAIInsights === 'function');

  // Every method the page names must be on the service, or the page is broken
  // in exactly the way it was before — silently, behind a catch.
  const called = [...read('web/marketing/analytics.html')
    .matchAll(/MarketingAnalyticsService\.(\w+)/g)].map(m => m[1]);
  const missing = [...new Set(called)].filter(n => typeof svc[n] !== 'function');
  check('every service method the page calls is exported', missing.length === 0);
  if (missing.length) console.log('    ', missing);

  // Same check the other way for the GA4 connector.
  const connector = read('web/js/api-connector.js');
  const gaCalled = [...svcSrc.matchAll(/GoogleAnalytics\.(\w+)\(/g)].map(m => m[1]);
  const gaMissing = [...new Set(gaCalled)].filter(n =>
    !new RegExp('\\b' + n + ':\\s*' + n).test(connector));
  check('every GoogleAnalytics method the service calls is exported', gaMissing.length === 0);
  if (gaMissing.length) console.log('    ', gaMissing);

  /* ── 3. With no GA4, nothing is asserted ──────────────────────────────── */
  console.log('\n──── nothing connected means nothing claimed ────');

  const dash = await svc.getDashboardData('last-30d');
  check('the dashboard refuses rather than returning zeros',
    dash.measured === false && typeof dash.reason === 'string' && dash.reason.length > 20);
  check('and the reason names the missing connection',
    /Google Analytics/.test(dash.reason));

  const overview = await svc.getOverviewMetrics('last-30d');
  check('overview metrics are unmeasured, not zero', overview.measured === false);

  const funnel = await svc.getFunnelMetrics();
  check('the funnel is unmeasured rather than a fixed shape', funnel.measured === false);

  const ltv = await svc.getCustomerLifetimeValue();
  check('customer value is unmeasured', ltv.measured === false);

  const cohorts = svc.getCohortAnalysis();
  check('cohorts say what they would need', cohorts.measured === false &&
    /first-purchase/.test(cohorts.reason));

  const attribution = svc.getAttributionReport('first-touch');
  check('attribution refuses without touchpoint paths', attribution.measured === false);
  check('and explains what a touchpoint path is',
    /touchpoint sequence/.test(attribution.reason));

  const assists = svc.getAssistConversions();
  check('assist analysis refuses too', assists.measured === false);

  const anomalies = await svc.detectAnomalies('traffic');
  check('anomaly detection refuses instead of reporting an all-clear',
    anomalies.measured === false);

  /* ── 4. Attribution is real arithmetic over real paths ────────────────── */
  console.log('\n──── attribution follows the path, not the array index ────');

  const paths = [
    { path: ['Social', 'Email', 'Direct'], revenue: 300 },
    { path: ['Social', 'Direct'], revenue: 100 },
  ];

  // A channel that appeared in a path but earned nothing under this model is
  // shown at zero — that is a real finding about the model, and hiding the row
  // would misrepresent which channels were involved at all.
  const first = svc.computeAttribution(paths, 'first-touch');
  check('first-touch credits the first channel in each path',
    first.attribution.Social.credit === 2 &&
    first.attribution.Direct.credit === 0 &&
    first.attribution.Email.credit === 0);

  const last = svc.computeAttribution(paths, 'last-touch');
  check('last-touch credits the last channel in each path',
    last.attribution.Direct.credit === 2 &&
    last.attribution.Social.credit === 0);

  // The trap: the old table gave first-touch to whatever channel sat at index
  // 0 of CHANNELS ('SEO'), even when SEO appeared in no path at all.
  check('a channel absent from every path gets no credit',
    !first.attribution.SEO && !last.attribution.SEO);

  const linear = svc.computeAttribution(paths, 'linear');
  check('linear splits each path evenly',
    Math.abs(linear.attribution.Social.credit - (1 / 3 + 1 / 2)) < 0.01);
  check('percentages sum to 100 across channels',
    Math.abs(Object.values(linear.attribution)
      .reduce((s, c) => s + c.percentage, 0) - 100) < 0.5);
  check('revenue is apportioned by the same weights',
    linear.attribution.Email.revenue === 100);

  const decay = svc.computeAttribution([{ path: ['A', 'B', 'C'] }], 'time-decay');
  check('time-decay weights later touches more heavily',
    decay.attribution.C.credit > decay.attribution.B.credit &&
    decay.attribution.B.credit > decay.attribution.A.credit);

  const pos = svc.computeAttribution([{ path: ['A', 'B', 'C', 'D'] }], 'position-based');
  check('position-based weights the ends 40/40',
    Math.abs(pos.attribution.A.credit - 0.4) < 0.01 &&
    Math.abs(pos.attribution.D.credit - 0.4) < 0.01);

  const single = svc.computeAttribution([{ path: ['OnlyOne'] }], 'position-based');
  check('a single-touch path gives that touch all the credit',
    single.attribution.OnlyOne.credit === 1);
  check('no percentage comes back NaN',
    Object.values(single.attribution).every(c => c.percentage === 100));

  /* ── 5. With GA4 connected, real numbers flow through ─────────────────── */
  console.log('\n──── a connected GA4 produces real figures ────');

  const live = await loadService({ gaConfigured: true });
  const liveDash = await live.getDashboardData('last-30d');
  check('the dashboard reports measured data', liveDash.measured === true);
  check('sessions are summed into the mapped channel',
    liveDash.channels.SEO.traffic === 1000 && liveDash.channels.Paid.traffic === 400);
  check('GA4 channel groups map onto our labels (Paid Search + Paid Social → Paid)',
    liveDash.channels.Paid.conversions === 12);
  check('an unmapped GA4 group is dropped, not guessed at',
    Object.keys(liveDash.channels).every(k =>
      ['SEO', 'Paid', 'Social', 'Email', 'Direct', 'Referral'].includes(k)));

  check('average order value is computed from real revenue and conversions',
    liveDash.kpis.avgOrderValue.value === 250);
  // GA4 holds no ad spend, so these cannot be derived — and were not.
  check('ROI stays unmeasured because ad spend is not in GA4',
    liveDash.kpis.roi.measured === false && /spend/i.test(liveDash.kpis.roi.reason));
  check('LTV stays unmeasured because repeat purchases are not tracked',
    liveDash.kpis.ltv.measured === false && /repeat/i.test(liveDash.kpis.ltv.reason));

  const liveFunnel = await live.getFunnelMetrics();
  check('the funnel reports the two stages GA4 can actually fill',
    liveFunnel.stages.filter(s => s.measured).length === 2);
  check('and marks the middle stages unmeasured with a reason',
    liveFunnel.stages.filter(s => !s.measured).every(s => typeof s.reason === 'string'));

  const trend = await live.getChannelTrends('SEO', 'daily');
  check('a real trend series comes back with real dates',
    trend.measured === true && /^\d{4}-\d{2}-\d{2}$/.test(trend.points[0].date));
  check('and it is not flat, because it is not invented',
    new Set(trend.points.map(p => p.traffic)).size > 1);

  /* ── 6. The page renders reasons, never a shape that looks like data ──── */
  console.log('\n──── the page shows a reason, not a placeholder ────');

  check('the placeholder constants are gone from the page',
    !/defaultKPIs|defaultFunnel|defaultSegments|defaultGoals|defaultAttribution/.test(pageSrc));
  check('defaults no longer overwrite real data after it loads',
    !/renderKPIs\(\);\s*\n\s*renderAttribution\('first-touch'\)/.test(pageSrc));
  check('a guard decides whether a value was measured', /function isNum\(/.test(pageSrc));
  check('an unmeasured panel renders the reason', /function notMeasured\(/.test(pageSrc));

  const browser = await inBrowser();
  check('the page loads with no JavaScript error', browser.errors.length === 0);
  if (browser.errors.length) console.log('    ', browser.errors);
  check('no NaN reaches the rendered page', browser.nanNodes.length === 0);
  if (browser.nanNodes.length) console.log('    ', browser.nanNodes);
  check('the funnel explains itself rather than showing "0.0K" at every stage',
    /Google Analytics is not connected/.test(browser.funnel) && !/0\.0K/.test(browser.funnel));
  check('KPI tiles show a dash, not a zero', browser.kpis.every(v => v === '--'));
  check('and each says why', browser.kpiNotes.every(n => /not measured|Needs/i.test(n)));
  check('the fourth tile is relabelled to what GA4 can actually measure',
    browser.merLabel === 'Average Order Value');
  check('segments give the segment-specific reason, not the GA4 one',
    /purchase history/.test(browser.segments));

  /* ── 7. The agent page itself stays honest ────────────────────────────── */
  console.log('\n──── the agent still computes, rather than estimates ────');

  const agent = read('web/agents/analytics-agent.html');
  check('its attribution is computed from pasted paths, not asked of an AI',
    /computeRealAttribution/.test(agent) && /real math, not an AI estimate/.test(agent));
  check('its audience builder filters the real contact database',
    /ContactsStore\.listContacts/.test(agent));
  check('and refuses to invent demographics for a real segment',
    /don't invent unrelated demographic details/.test(agent));
  check('reports persist through AnalyticsStore rather than this device only',
    /AnalyticsStore\.createReport/.test(agent));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();

/* ── helpers ─────────────────────────────────────────────────────────────── */

/**
 * Loads the real service into a DOM-less sandbox with a fake GA4 connector,
 * so both the "nothing connected" and "real data" paths run against the
 * shipped code rather than a paraphrase of it.
 */
async function loadService({ gaConfigured }) {
  const vm = require('vm');
  const store = {};
  const GA_ROWS = {
    metricHeaders: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'totalRevenue' }],
    rows: [
      { dimensionValues: [{ value: 'Organic Search' }], metricValues: [{ value: '1000' }, { value: '8' }, { value: '2000' }] },
      { dimensionValues: [{ value: 'Paid Search' }],    metricValues: [{ value: '300' }, { value: '7' }, { value: '1500' }] },
      { dimensionValues: [{ value: 'Paid Social' }],    metricValues: [{ value: '100' }, { value: '5' }, { value: '1500' }] },
      { dimensionValues: [{ value: 'Audio' }],          metricValues: [{ value: '50' }, { value: '0' }, { value: '0' }] },
    ],
  };
  const TREND_ROWS = {
    metricHeaders: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'totalRevenue' }],
    rows: Array.from({ length: 20 }, (_, i) => ({
      dimensionValues: [{ value: '202601' + String(i + 10) }, { value: 'Organic Search' }],
      metricValues: [{ value: String(100 + i * 7) }, { value: '1' }, { value: '50' }],
    })),
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    Date, Math, JSON, Number, Object, Array, String, isFinite, parseInt, parseFloat,
    Promise, RegExp, Error, setTimeout, Map, Set,
  };
  sandbox.window = sandbox;
  sandbox.ApiConnector = {
    GoogleAnalytics: {
      isAvailable: () => gaConfigured,
      getChannelPerformance: async () => GA_ROWS,
      getReport: async () => TREND_ROWS,
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'web/js/marketing-analytics-service.js'), 'utf8'),
    sandbox, { filename: 'marketing-analytics-service.js' });
  return sandbox.window.MarketingAnalyticsService;
}

// Serves web/ and loads the real dashboard page in Chromium.
async function inBrowser() {
  const { chromium } = require('playwright');
  const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
  const ROOT = path.join(REPO, 'web');
  const server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end('nf');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'text/plain' });
    res.end(fs.readFileSync(f));
  });
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/marketing/analytics.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const result = await page.evaluate(() => ({
    // Only leaf nodes outside <script>: a NaN in a comment is not a NaN a
    // customer sees.
    nanNodes: [...document.querySelectorAll('body *')]
      .filter(e => e.children.length === 0 && e.tagName !== 'SCRIPT' && /NaN/.test(e.textContent))
      .map(e => e.tagName + ': ' + e.textContent.trim().slice(0, 60))
      .concat([...document.querySelectorAll('[style*="NaN"]')].map(e => 'style: ' + e.className)),
    funnel: (document.getElementById('funnelVisual') || {}).textContent || '',
    segments: (document.getElementById('segmentGrid') || {}).textContent || '',
    kpis: ['kpiConversions', 'kpiROI', 'kpiLTV', 'kpiMER']
      .map(i => (document.getElementById(i) || {}).textContent),
    kpiNotes: ['kpiROIChange', 'kpiLTVChange', 'kpiMERChange']
      .map(i => (document.getElementById(i) || {}).textContent),
    merLabel: document.getElementById('kpiMER')?.closest('.kpi-card')?.querySelector('.kpi-label')?.textContent,
  }));
  await browser.close();
  server.close();
  return { ...result, errors };
}
