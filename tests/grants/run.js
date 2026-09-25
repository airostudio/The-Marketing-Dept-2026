/**
 * Government Funding Room checks.
 *
 * The scorecard exists to stop the funding function becoming an application
 * factory, so the parts that must be right are the arithmetic and the band
 * boundaries — a scorecard that quietly mis-scores is worse than none, because
 * it launders a bad call as a number.
 *
 *   PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tests/grants/run.js
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

/* ── 1. Scorecard model, in plain node ──────────────────────────────────── */
console.log('──── scorecard model ────');
global.window = {};
require(path.join(REPO, 'web/js/grant-scorecard.js'));
const SC = global.window.GrantScorecard;
const criteria = SC.CRITERIA();

check('weights total exactly 100', SC.TOTAL_WEIGHT === 100);
check('nine criteria, as specified', criteria.length === 9);

const all = v => Object.fromEntries(criteria.map(c => [c.key, v]));
check('a perfect card scores 100', SC.score(all(10)).total === 100);
check('a zero card scores 0', SC.score(all(0)).total === 0);
check('a mid card scores 50', SC.score(all(5)).total === 50);

// Band boundaries, exactly as the policy states them.
check('80 → APPLY IMMEDIATELY', SC.bandFor(80).key === 'apply');
check('79 → STRATEGIC APPLICATION', SC.bandFor(79).key === 'strategic');
check('65 → STRATEGIC APPLICATION', SC.bandFor(65).key === 'strategic');
check('64 → ONLY WITH STRONG PARTNER', SC.bandFor(64).key === 'partner');
check('50 → ONLY WITH STRONG PARTNER', SC.bandFor(50).key === 'partner');
check("49 → DON'T APPLY", SC.bandFor(49).key === 'decline');

// The three burden criteria must be declared costs, or a punishing grant
// scores well and the whole model inverts.
const costs = criteria.filter(c => c.kind === 'cost').map(c => c.key).sort();
check('workload, matching and reporting are marked as costs',
  JSON.stringify(costs) === JSON.stringify(['matching', 'reporting', 'workload']));
check('every cost criterion says 10 = light burden',
  criteria.filter(c => c.kind === 'cost')
          .every(c => /minimal|none required|light/i.test(c.rubric[10])));

// The heavy criteria carry the weight the policy gives them.
const w = Object.fromEntries(criteria.map(c => [c.key, c.weight]));
check('eligibility and alignment weigh 20 each', w.eligibility === 20 && w.alignment === 20);
check('advantage weighs 15', w.advantage === 15);
check('the three burden criteria weigh 5 each',
  w.workload === 5 && w.matching === 5 && w.reporting === 5);

// A partial card is not a verdict.
const partial = { eligibility: 10, alignment: 10 };
const pres = SC.score(partial);
check('an incomplete card reports what is missing',
  !pres.complete && pres.missing.length === 7);
check('isDecisionReady() is false while criteria are unscored',
  SC.isDecisionReady(partial) === false && SC.isDecisionReady(all(5)) === true);
check('out-of-range scores are clamped, not trusted',
  SC.score(all(99)).total === 100 && SC.score(all(-5)).total === 0);

/* ── 2. Store rollup ────────────────────────────────────────────────────── */
console.log('\n──── pipeline rollup ────');
global.window.Supabase = undefined;
global.localStorage = {
  _d: {}, getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; },
};
require(path.join(REPO, 'web/js/grants-store.js'));
const GS = global.window.GrantsStore;

const roll = GS.rollup([
  { stage: 'funded', amount_awarded: 250000 },
  { stage: 'application', amount_min: 100000, amount_max: 200000, scorecard: { probability: 5 } },
  { stage: 'discovered', amount_min: 50000, amount_max: 50000, scorecard: {} },
  { stage: 'not_proceeding', amount_min: 999999, amount_max: 999999 },
]);
console.log('  rollup:', JSON.stringify(roll));
check('secured counts only what was actually awarded', roll.secured === 250000);
check('pipeline is discounted by probability (150k @ 50% + 50k @ default 50%)',
  roll.weightedPipeline === 100000);
check('dead opportunities are excluded from the forecast',
  roll.liveCount === 2 && roll.wonCount === 1);
check('11 pipeline stages plus a terminal state', GS.STAGES.length === 12);
check('all ten funding types the specialist covers are present',
  ['federal','state_vic','local','rd_tax_incentive','emdg','commercialisation',
   'research_partnership','university','tender','international']
    .every(k => GS.LEVELS.some(l => l.key === k)));
check('36-month targets match the plan',
  GS.TARGETS[0].min === 150000 && GS.TARGETS[0].max === 300000 &&
  GS.TARGETS[1].min === 500000 && GS.TARGETS[1].max === 1000000 &&
  GS.TARGETS[2].min === 1000000 && GS.TARGETS[2].max === 3000000);

/* ── 3. The page: admin gate, then real use ─────────────────────────────── */
let role = 'user';   // flipped to 'admin' for the second load
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/admin/grants.html') {
    let html = fs.readFileSync(path.join(REPO, 'web/admin/grants.html'), 'utf8');
    // Stubs must come AFTER the real modules, or supabase-client.js/auth.js
    // overwrite them and the test silently exercises the real offline path.
    html = html.replace('<script src="/js/grant-scorecard.js"></script>', `<script>
      window.Auth={getUser:async()=>({id:'u1',role:${JSON.stringify(role)}})};
      window.Supabase={isConfigured:()=>true,DB:{getProfile:async()=>({role:${JSON.stringify(role)}})},
        ready:async()=>{},getClient:()=>null};
      window.ClaudeService={callAgent:async()=>'eligibility: 9\\nalignment: 8\\nadvantage: 7\\namount: 6\\n'+
        'probability: 6\\nstrategic: 8\\nworkload: 7\\nmatching: 9\\nreporting: 8\\n'+
        'REASONING: Strong eligibility and a clean policy fit. Worth applying.'};
    </script>\n<script src="/js/grant-scorecard.js"></script>`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(html);
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

server.listen(0, async () => {
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  console.log('\n──── admin gate ────');
  await page.goto(`http://localhost:${port}/admin/grants.html`);
  await page.waitForTimeout(500);
  const asUser = await page.evaluate(() => ({
    wrap: document.getElementById('wrap').style.display,
    msg: document.getElementById('gate-msg').textContent,
  }));
  check('a non-admin is refused', asUser.wrap !== 'block' && /admin-only/i.test(asUser.msg));

  console.log('\n──── the room, as an admin ────');
  role = 'admin';
  await page.goto(`http://localhost:${port}/admin/grants.html`);
  await page.waitForTimeout(600);

  const shell = await page.evaluate(() => ({
    visible: document.getElementById('wrap').style.display === 'block',
    stages: document.querySelectorAll('.stage-col').length,
    banner: document.getElementById('storage-banner').textContent.trim(),
    empty: document.getElementById('pipeline-empty').textContent.trim(),
  }));
  check('an admin gets the room', shell.visible);
  check('local-only storage is disclosed, not hidden', /browser only/i.test(shell.banner));
  check('an empty pipeline says so', /Nothing in the pipeline/i.test(shell.empty));

  // Add an opportunity and score it via Vera.
  await page.click('#btn-new');
  await page.fill('#f-name', 'Industry Growth Program — Round 3');
  await page.fill('#f-min', '100000');
  await page.fill('#f-max', '500000');
  const beforeVerdict = await page.evaluate(() => document.getElementById('verdict').textContent);
  check('an unscored card offers no verdict', /Not yet scored/i.test(beforeVerdict));

  await page.click('#btn-assess');
  await page.waitForTimeout(500);
  const assessed = await page.evaluate(() => ({
    verdict: document.getElementById('verdict').textContent,
    status: document.getElementById('assess-status').textContent,
    reasoning: document.getElementById('f-gonogo').value,
  }));
  console.log('  verdict after assessment:', assessed.verdict.replace(/\s+/g, ' ').slice(0, 90));
  // 9,8,7,6,6,8,7,9,8 against the real weights.
  const expected = SC.score({ eligibility:9, alignment:8, advantage:7, amount:6,
    probability:6, strategic:8, workload:7, matching:9, reporting:8 });
  check(`Vera's scores are applied and totalled correctly (${expected.total})`,
    assessed.verdict.includes(String(expected.total)));
  check('the band shown matches the total', assessed.verdict.includes(expected.band.label));
  check('the assessment says how much of the card it filled', /all nine criteria/i.test(assessed.status));
  check("Vera's reasoning is recorded against the decision", /Vera: Strong eligibility/.test(assessed.reasoning));

  await page.click('#btn-save');
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => ({
    cards: document.querySelectorAll('.opp').length,
    label: document.querySelector('.opp-score')?.textContent.trim() || '',
    secured: document.querySelectorAll('.card-value')[0]?.textContent || '',
    pipeline: document.querySelectorAll('.card-value')[1]?.textContent || '',
  }));
  check('the opportunity is in the pipeline', saved.cards === 1);
  check('its card shows the score and band', saved.label.includes(String(expected.total)));
  check('nothing is counted as secured before it is won', saved.secured === 'A$0' || saved.secured === '—');
  check('the weighted pipeline reflects probability 6/10 of the 300k midpoint',
    saved.pipeline.replace(/[^\d]/g, '') === '180000');

  check('no JS errors', errs.length === 0);
  if (errs.length) console.log('  errors:', errs.slice(0, 3));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));

  await browser.close();
  server.close();
  process.exit(fail.length === 0 ? 0 : 1);
});
