/**
 * CRO Lab.
 *
 * Most of this module is genuinely good and was left alone. The experiment
 * runner is real — real tables, a real tracking snippet, real visitor and
 * conversion counts, and `convRate: null` rather than 0 when a variant has no
 * visitors. The significance maths is real too: the two-proportion z-test and
 * the Zelen & Severo normal CDF are both correct, which this suite verifies
 * against known values rather than taking on trust.
 *
 * Three findings:
 *
 *   1. "Declare Winner" sat on every variant row with no significance gate,
 *      on a page whose own pitch is "real z-test ... not guesswork". A variant
 *      with three visitors and one conversion showed a 33% rate and a green
 *      button; the note asking you to check the calculator first was a
 *      sentence underneath it. The tool computed significance and then did not
 *      use it at the one decision that matters.
 *
 *   2. Three "[Example]" ICE rows were written into the customer's own storage
 *      on first load, then ranked and scored alongside anything they added and
 *      offered to Scotty as missions — a starter backlog that was never
 *      theirs, indistinguishable from their work once the label scrolled past.
 *
 *   3. The dashboard sidebar linked to /tools/cro-checklist.html, which did
 *      not exist — a 404 — while 13KB of working js/cro-checklist.js sat
 *      orphaned, waiting for the page it drives.
 *
 *   node tests/cro-lab/run.js
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

const PAGE = 'web/agents/cro-agent.html';

(async () => {
  const page = code(PAGE);

  /* ── 1. The statistics are actually correct ───────────────────────────── */
  console.log('──── the maths behind "not guesswork" ────');

  const { normalCDF, twoProportionZTest } = extractStats(read(PAGE));

  // Known values for the standard normal CDF.
  check('Φ(0) = 0.5', Math.abs(normalCDF(0) - 0.5) < 0.001);
  check('Φ(1.96) ≈ 0.975', Math.abs(normalCDF(1.96) - 0.975) < 0.001);
  check('Φ(-1.96) ≈ 0.025', Math.abs(normalCDF(-1.96) - 0.025) < 0.001);
  check('Φ(2.576) ≈ 0.995', Math.abs(normalCDF(2.576) - 0.995) < 0.001);
  check('the CDF is symmetric', Math.abs((normalCDF(1.3) + normalCDF(-1.3)) - 1) < 0.002);

  // A textbook two-proportion case: 10% vs 12% at n=2000 per arm is
  // significant; the same gap at n=100 is not.
  const big = twoProportionZTest(0.10, 0.12, 2000);
  check('a real difference at a real sample size is significant',
    big.measured && big.significant && big.pValue < 0.05);
  const small = twoProportionZTest(0.10, 0.12, 100);
  check('the same difference on 100 visitors is not',
    small.measured && !small.significant && small.pValue > 0.05);
  check('the p-value is two-sided and consistent with the z-score',
    Math.abs(big.pValue - 2 * normalCDF(-big.z)) < 1e-9);
  check('lift is relative to the control',
    Math.abs(big.lift - 20) < 0.001);

  // Equal-but-nonzero rates are a real result, not an error: z = 0, p = 1,
  // not significant. Reporting that as "unmeasurable" would have been its own
  // small lie.
  // The Zelen & Severo approximation is accurate to about 7.5e-8, so p at
  // z = 0 comes back as 0.99999994 rather than exactly 1. That is the
  // approximation working as documented, not a defect.
  const tie = twoProportionZTest(0.1, 0.1, 500);
  check('identical rates give z = 0 and p ≈ 1, not an error',
    tie.measured && tie.z === 0 && Math.abs(tie.pValue - 1) < 1e-6 && !tie.significant);
  // The degenerate cases that would produce NaN if unguarded.
  check('all-or-nothing in both arms is refused rather than dividing by zero',
    twoProportionZTest(0, 0, 500).measured === false &&
    twoProportionZTest(1, 1, 500).measured === false);
  check('and says which of the two it is',
    /Neither variant has converted anyone yet/.test(twoProportionZTest(0, 0, 500).reason));
  check('a zero sample is refused rather than dividing by zero',
    twoProportionZTest(0.1, 0.2, 0).measured === false);
  check('a missing input is refused', twoProportionZTest(NaN, 0.2, 500).measured === false);

  /* ── 2. The winner decision uses the test ─────────────────────────────── */
  console.log('\n──── a winner is declared on evidence ────');

  check('one shared z-test serves the calculator and the results table',
    /function twoProportionZTest\(/.test(page) &&
    (page.match(/twoProportionZTest\(/g) || []).length >= 3);
  check('every variant is tested against the control before the table renders',
    /perVariantTest/.test(page));
  check('the plain "Declare Winner" is only offered on a significant result',
    /t\.measured && t\.significant/.test(page));
  check('an insignificant variant says why, with its p-value',
    /Not significant yet \(p = /.test(page));
  check('and declaring it anyway is a distinct, warned action',
    /Declare anyway/.test(page) &&
    /cannot be separated from chance/.test(page));
  check('the confirm distinguishes the two cases',
    /declareWinnerUI\(expId, variantId, isSignificant\)/.test(page));
  check('the control row offers "keep control" rather than a winner claim',
    /Keep control/.test(page));

  // The old copy told people to go and check the calculator themselves; the
  // page now does it for them, so that instruction should be gone.
  check('the table no longer just asks the customer to check the maths themselves',
    !/before declaring a winner\.<\/div>/.test(page));

  /* ── 3. The ICE backlog is the customer's own ─────────────────────────── */
  console.log('\n──── nothing is seeded into the customer\'s backlog ────');

  check('the three [Example] rows are gone', !/\[Example\]/.test(page));
  check('nothing is written to storage before the customer adds anything',
    !/localStorage\.setItem\(ICE_KEY, JSON\.stringify\(iceTests\)\);\s*\n\s*\}/.test(page));
  check('an empty backlog renders an empty state, not three rows',
    /No tests in the backlog yet/.test(page));
  check('and the empty state says what the table is for',
    /Impact, Confidence and Ease/.test(page));

  /* ── 4. The checklist page exists and works ───────────────────────────── */
  console.log('\n──── the dashboard link is not a 404 ────');

  check('the page the dashboard links to exists',
    fs.existsSync(path.join(REPO, 'web/tools/cro-checklist.html')));
  check('the orphaned script is now loaded by it',
    /js\/cro-checklist\.js/.test(read('web/tools/cro-checklist.html')));

  // Every link out of the CRO surface must resolve.
  const broken = [];
  ['web/dashboard.html', PAGE, 'web/tools/cro-checklist.html'].forEach(f => {
    const dir = path.dirname(path.join(REPO, f));
    for (const m of read(f).matchAll(/href="([^"#][^"]*\.html[^"]*)"/g)) {
      const target = m[1].split('?')[0];
      const abs = target.startsWith('/')
        ? path.join(REPO, 'web', target)
        : path.resolve(dir, target);
      if (!fs.existsSync(abs)) broken.push(f + ' -> ' + m[1]);
    }
  });
  check('no CRO page links to a page that does not exist', broken.length === 0);
  if (broken.length) console.log('    ', [...new Set(broken)]);

  // It is a checklist of practices, not a measurement of the store — it must
  // say so rather than reading like an audit.
  const checklist = read('web/tools/cro-checklist.html');
  check('the checklist says plainly it is not measured from the store',
    /not an audit of your store/.test(checklist) && /is measured from your site/.test(checklist));
  check('and that progress does not follow you to another device',
    /stored in this browser only/.test(checklist));

  /* ── 5. Nothing on the surface fabricates ─────────────────────────────── */
  console.log('\n──── no invented numbers ────');

  [PAGE, 'web/js/experiments-store.js', 'web/js/cro-checklist.js', 'api/convert-experiments.js']
    .forEach(f => {
      const src = code(f);
      // Random is legitimate for ids and for weighted variant assignment;
      // it is never legitimate for a reported number.
      const randomMetrics = [...src.matchAll(/(\w+)\s*[:=]\s*[^;\n]*Math\.random/g)]
        .filter(m => !/^(id|uid|key|seed|nonce|suffix|roll|r|visitorId)$/i.test(m[1]));
      check(`${path.basename(f)}: no metric derived from Math.random`, randomMetrics.length === 0);
    });

  check('a variant with no visitors has a null rate, not 0%',
    /convRate: visitorCount > 0 \? \(conversionCount \/ visitorCount \* 100\) : null/
      .test(read('web/js/experiments-store.js')));
  check('and the table renders that as a dash',
    /r\.convRate !== null \? r\.convRate\.toFixed\(2\) \+ '%' : '—'/.test(page));
  check('an experiment with no tracked visits says so rather than showing zeros',
    /No tracked visits yet/.test(page));
  check('the Convert.com proxy identifies its caller before spending',
    /requireUser\(req, res\)/.test(read('api/convert-experiments.js')));

  /* ── 6. In a browser ──────────────────────────────────────────────────── */
  console.log('\n──── the real pages, in a real browser ────');

  const b = await inBrowser();
  try {
    check('CRO Lab loads with no JavaScript error', b.croErrors.length === 0);
    if (b.croErrors.length) console.log('    ', b.croErrors);
    check('the ICE table starts empty for a new customer',
      /No tests in the backlog yet/.test(b.iceBody));
    check('and nothing was written to storage on load', b.iceStored === null);

    check('the checklist page loads with no JavaScript error', b.clErrors.length === 0);
    if (b.clErrors.length) console.log('    ', b.clErrors);
    check('it renders real sections and items',
      b.clSections >= 4 && b.clItems >= 20);
    check('ticking an item moves the overall count',
      b.clAfterCount === '2' && b.clTotal === 'of ' + b.clItems);
    check('and the section progress with it', b.clSection === '1/5');
    check('the progress ring advances', Number(b.clOffset) < 163);
    check('progress survives a reload', b.clPersisted === '2');
    check('sections collapse', b.clCollapsed === true);
    check('the export menu opens', b.clExportOpen === true);
  } finally {
    await b.close();
  }

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Lifts the page's own statistics functions out and runs them for real. */
function extractStats(src) {
  const cdf = src.match(/function normalCDF\(z\) \{[\s\S]*?\n    \}/);
  const zt  = src.match(/function twoProportionZTest\(p1, p2, n\) \{[\s\S]*?\n    \}/);
  if (!cdf || !zt) throw new Error('statistics functions not found in cro-agent.html');
  // eslint-disable-next-line no-new-func
  return new Function(cdf[0] + '\n' + zt[0] + '\nreturn { normalCDF, twoProportionZTest };')();
}

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
  const base = `http://127.0.0.1:${server.address().port}`;
  const br = await chromium.launch();

  const croErrors = [];
  const cro = await br.newPage();
  cro.on('pageerror', e => croErrors.push(e.message));
  await cro.goto(base + '/agents/cro-agent.html', { waitUntil: 'domcontentloaded' });
  await cro.waitForTimeout(1200);
  const iceBody = await cro.evaluate(() => (document.getElementById('iceBody') || {}).textContent || '');
  const iceStored = await cro.evaluate(() => localStorage.getItem('cro_ice_tests'));

  const clErrors = [];
  const cl = await br.newPage();
  cl.on('pageerror', e => clErrors.push(e.message));
  await cl.goto(base + '/tools/cro-checklist.html', { waitUntil: 'domcontentloaded' });
  await cl.waitForTimeout(600);
  const shape = await cl.evaluate(() => ({
    sections: document.querySelectorAll('.checklist-section').length,
    items: document.querySelectorAll('.checklist-item').length,
  }));
  await cl.click('.checklist-item[data-id="sf-value-prop"] .checklist-checkbox');
  await cl.click('.checklist-item[data-id="pdp-images"] .checklist-checkbox');
  await cl.waitForTimeout(200);
  const after = await cl.evaluate(() => ({
    count: document.getElementById('completedCount').textContent,
    total: document.getElementById('totalCount').textContent,
    offset: document.getElementById('progressCircle').style.strokeDashoffset,
    section: document.querySelector('.section-progress-text').textContent,
  }));
  await cl.reload({ waitUntil: 'domcontentloaded' });
  await cl.waitForTimeout(500);
  const persisted = await cl.evaluate(() => document.getElementById('completedCount').textContent);
  await cl.click('.checklist-section-header');
  const collapsed = await cl.evaluate(() =>
    document.querySelector('.checklist-section').classList.contains('collapsed'));
  await cl.click('#exportBtn');
  await cl.waitForTimeout(150);
  const exportOpen = await cl.evaluate(() =>
    document.getElementById('exportDropdown').classList.contains('show'));

  return {
    croErrors, iceBody, iceStored,
    clErrors, clSections: shape.sections, clItems: shape.items,
    clAfterCount: after.count, clTotal: after.total, clOffset: after.offset,
    clSection: after.section, clPersisted: persisted,
    clCollapsed: collapsed, clExportOpen: exportOpen,
    close: async () => { await br.close(); server.close(); },
  };
}
