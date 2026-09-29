/**
 * Verifies the fixer writes copy grounded in the page it is advising on,
 * and labels it as a placeholder when it cannot.
 *
 * The regression this guards: for a page with a hand-written title and
 * description, the fixer used to emit "Learn about Terms at Your Site. Find
 * detailed information, resources, and everything you need to know about
 * terms." — assembled from the URL slug and a default site name, with no
 * reference to the page at all.
 *
 *   PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tests/seo-audit/fixer-copy.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../..');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const REAL_PAGE = `<!DOCTYPE html><html lang="en"><head>
<title>Terms of Service | Webese.ai</title>
<meta property="og:title" content="Terms of Service | Webese.ai">
</head><body><h1>Terms of Service</h1>
<p>These terms govern your use of Webese, including what you may build with it, how billing works, and the circumstances under which we may suspend an account.</p>
</body></html>`;

// A page with nothing usable to write from.
const EMPTY_PAGE = `<!DOCTYPE html><html><head><title>x</title></head><body><div></div></body></html>`;

const HARNESS = `<!DOCTYPE html><html><body>
<script>
window.__pageData = ${JSON.stringify({
  'https://webese.ai/terms': { html: REAL_PAGE },
  'https://webese.ai/empty': { html: EMPTY_PAGE },
})};
window.SEOAudit = { getState: () => ({ pageData: window.__pageData }) };
</script>
<script src="/seo-fixer.js"></script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/x.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(HARNESS);
  }
  if (req.url === '/seo-fixer.js') {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(REPO, 'web/js/seo-fixer.js'), 'utf8'));
  }
  res.writeHead(404); res.end();
});

server.listen(0, async () => {
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${port}/x.html`);

  const out = await page.evaluate(() => {
    const g = window.SEOFixer.generators;
    return {
      realTitle: g.title('https://webese.ai/terms', 'Webese.ai'),
      realDesc: g.description('https://webese.ai/terms', 'Webese.ai'),
      realOg: g.openGraph('https://webese.ai/terms', 'Webese.ai'),
      emptyDesc: g.description('https://webese.ai/empty', 'Webese.ai'),
    };
  });

  console.log('\n──── generated for a page WITH real content ────');
  console.log(out.realTitle);
  console.log(out.realDesc);
  console.log('\n──── generated for a page with NOTHING usable ────');
  console.log(out.emptyDesc);

  const fail = [];
  const check = (name, cond) => {
    console.log((cond ? '  PASS  ' : '  FAIL  ') + name);
    if (!cond) fail.push(name);
  };

  console.log('\n──── assertions ────');
  check('title reuses the page\'s real title, not the URL slug',
    out.realTitle.includes('Terms of Service | Webese.ai'));
  check('title does not double up the brand name',
    (out.realTitle.match(/Webese\.ai/g) || []).length === 1);
  check('description is drawn from the page\'s actual prose',
    out.realDesc.includes('These terms govern your use of Webese'));
  check('description contains none of the old boilerplate',
    !/everything you need to know|Find detailed information|Your Site/i.test(out.realDesc));
  check('grounded output carries no placeholder marker',
    !out.realDesc.includes('TODO') && !out.realTitle.includes('TODO'));
  check('OG tags reuse the page\'s own title/description',
    out.realOg.includes('Terms of Service | Webese.ai') &&
    out.realOg.includes('These terms govern'));
  check('ungrounded output IS labelled as a placeholder',
    out.emptyDesc.includes('TODO'));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));

  await browser.close();
  server.close();
  process.exit(fail.length === 0 ? 0 : 1);
});
