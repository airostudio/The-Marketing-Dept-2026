const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright') ;
const { spawn } = require('child_process');
const path = require('path');

(async () => {
  const server = spawn('node', [path.join(__dirname, 'fixture-server.js')]);
  const port = await new Promise((resolve, reject) => {
    server.stdout.on('data', d => {
      const m = String(d).match(/PORT=(\d+)/);
      if (m) resolve(m[1]);
    });
    server.stderr.on('data', d => process.stderr.write('[server] ' + d));
    setTimeout(() => reject(new Error('server did not start')), 8000);
  });

  const origin = `http://localhost:${port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', m => console.log('[browser]', m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));

  await page.goto(`${origin}/harness.html`);
  const result = await page.evaluate(o => window.runAudit(o), origin);

  console.log('\n════════ CRAWL ════════');
  console.log('Pages actually audited (keyed by final URL):');
  result.pageData.forEach(u => console.log('   ' + u));
  console.log('\nSkipped by robots.txt:', JSON.stringify(result.state.robotsSkipped));
  console.log('Redirects collapsed  :', JSON.stringify(result.state.redirects));
  console.log('Parsed robots rules  :', JSON.stringify(result.state.robotsRules));

  console.log('\n════════ FINDINGS ════════');
  const byTitle = {};
  result.issues.forEach(i => {
    byTitle[i.title] = byTitle[i.title] || [];
    byTitle[i.title].push(i);
  });
  Object.entries(byTitle).forEach(([title, list]) => {
    console.log(`\n[${list[0].severity.toUpperCase()}] ${title}  ×${list.length}`);
    list.slice(0, 3).forEach(i => {
      console.log('    url: ' + i.url);
      if (i.evidence) console.log('    evidence: ' + i.evidence.split('\n').join('\n              '));
    });
  });

  console.log('\n════════ ASSERTIONS ════════');
  const titles = result.issues.map(i => i.title);
  const fail = [];
  const check = (name, cond) => {
    console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
    if (!cond) fail.push(name);
  };

  check('robots.txt disallowed /build and /dashboard were NOT audited',
    !result.pageData.some(u => /\/(build|dashboard)$/.test(u)));
  check('robots.txt rules were actually parsed',
    result.state.robotsRules && result.state.robotsRules.disallow.includes('/build'));
  check('no phantom "Duplicate title tags" (one real page reached 3 ways)',
    !titles.includes('Duplicate title tags'));
  check('no phantom "Duplicate meta descriptions"',
    !titles.includes('Duplicate meta descriptions'));
  const cleanIssues = result.issues.filter(i => !i.url.includes('genuinely-broken'));
  const cleanTitles = cleanIssues.map(i => i.title);
  check('28-char "Terms of Service | Webese.ai" NOT flagged short',
    !cleanTitles.some(t => /Title tag.*short/i.test(t)));
  check('hand-written meta descriptions NOT flagged short/missing',
    !cleanTitles.some(t => /Meta description (very short|too short)/i.test(t)));
  check('rel="noreferrer" links NOT flagged for noopener',
    !cleanTitles.some(t => /noopener/i.test(t)));
  check('inline GTM/theme scripts + async GA NOT flagged render-blocking',
    !cleanTitles.includes('Render-blocking scripts'));
  check('/changelog NOT flagged as thin content',
    !result.issues.some(i => i.title === 'Very little text on page' && /changelog/.test(i.url)));
  const on = (title, urlPart) =>
    result.issues.some(i => i.title === title && i.url.includes(urlPart));

  check('real H1s present -> "Missing H1" only on the genuinely broken page',
    !result.issues.some(i => i.title === 'Missing H1 heading' && !i.url.includes('genuinely-broken')));
  check('every finding carries evidence',
    result.issues.every(i => i.evidence));
  check('LOW issue on every page is NOT escalated to HIGH by the site-wide rollup',
    result.issues.filter(i => i.title.startsWith('Site-wide: '))
      .every(i => i.severity !== 'high' && i.severity !== 'critical'));

  console.log('\n  --- and the checks still catch REAL problems: ---');
  check('STILL catches 3 genuinely render-blocking external head scripts',
    on('Render-blocking scripts', 'genuinely-broken'));
  check('STILL catches target=_blank link with no noopener/noreferrer',
    on('External links missing rel="noopener"', 'genuinely-broken'));
  check('STILL catches a genuinely missing H1',
    on('Missing H1 heading', 'genuinely-broken'));
  check('STILL catches a genuinely missing meta description',
    on('Missing meta description', 'genuinely-broken'));
  check('STILL catches a genuinely uninformative 3-char title',
    on('Title tag very short', 'genuinely-broken'));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} ASSERTION(S) FAILED: ${fail.join(' | ')}`));

  await browser.close();
  server.kill();
  process.exit(fail.length === 0 ? 0 : 1);
})().catch(e => { console.error('TEST HARNESS ERROR:', e); process.exit(2); });
