/**
 * SEO intelligence workflow checks.
 *
 * Every assertion here exists because the audit found the product asserting
 * something it had not measured. The two that matter most are arithmetic, not
 * UI, and both were invisible precisely because JavaScript made them look
 * reasonable:
 *
 *   1. `null <= 3` is TRUE. A tracked keyword has position === null until a
 *      ranking provider reports one, so every count written as
 *      `k.position <= 3` counted keywords nobody had ever looked up as ranking
 *      in the top 3 — and in the top 10, and the top 20, simultaneously.
 *   2. A failed PageSpeed call left performance/seo/accessibility at 0 while
 *      security stayed at 100, and the weighted sum landed on exactly 15. The
 *      page reported "15/100" with an empty issue list: the worst possible
 *      verdict, with no findings behind it, derived from a request that never
 *      succeeded.
 *
 *   PLAYWRIGHT_PATH=/opt/node22/lib/node_modules/playwright node tests/seo-intelligence/run.js
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

const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');

(async () => {
  /* ── 1. The coercion itself ───────────────────────────────────────────── */
  console.log('──── the null-position trap ────');

  check('the trap is real: null <= 3 is true in JavaScript', (null <= 3) === true);

  const svc = read('web/js/keyword-service.js');
  check('keyword-service defines a single isRanked guard', /function isRanked\(position\)/.test(svc));
  check('and it rejects null, undefined and 0',
    !/isRanked\s*=\s*\(/.test(svc) &&
    /typeof position === 'number'/.test(svc) && /position > 0/.test(svc));

  // No bare position comparison may survive outside the guard.
  const bareCompare = svc.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /\bk\.position\s*(<=|<|>=|>)\s*\d/.test(l))
    .filter(([, l]) => !/isRanked|ranked\.filter|^\s*\/\//.test(l));
  check('no bare k.position comparison is left unguarded in the service',
    bareCompare.length === 0);
  if (bareCompare.length) console.log('    ', bareCompare.slice(0, 4));

  /* ── 2. getStats arithmetic, run for real ─────────────────────────────── */
  console.log('\n──── stats over unranked keywords ────');

  const pulseSrc = read('web/seo-pulse.html');

  // One server for both halves of the suite. It has to exist before the service
  // tests too: KeywordTracker persists to localStorage, and localStorage throws
  // a SecurityError on about:blank — an opaque origin has no storage to read.
  let psMode = 'fail';
  const server = http.createServer((req, res) => {
    const u = req.url.split('?')[0];

    // A bare page on a real origin, just to host the service under test.
    if (u === '/harness.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><meta charset="utf-8"><title>harness</title>');
    }
    if (u === '/seo-pulse.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(pulseSrc);
    }
    if (u === '/api/pagespeed') {
      if (psMode === 'fail') {
        res.writeHead(429, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Rate limit exceeded. Please wait before retrying.' }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        lighthouseResult: {
          categories: { performance: { score: 0.9 }, seo: { score: 0.8 }, accessibility: { score: 0.7 } },
          audits: { 'meta-description': { score: 1 }, 'document-title': { score: 1 }, viewport: { score: 1 } },
        },
      }));
    }
    if (u === '/api/check-url') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ reachable: true }));
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
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(`http://localhost:${port}/harness.html`);
  await page.addScriptTag({ content: svc });

  const stats = await page.evaluate(() => {
    const T = window.KeywordService.KeywordTracker;
    T.saveTrackedKeywords([
      { keyword: 'a', position: null, previousPosition: null, searchVolume: 1000, difficulty: null },
      { keyword: 'b', position: null, previousPosition: null, searchVolume: 2000, difficulty: null },
      { keyword: 'c', position: 2,    previousPosition: 5,    searchVolume: 500,  difficulty: 30 },
      { keyword: 'd', position: 40,   previousPosition: 20,   searchVolume: 800,  difficulty: 60 },
    ]);
    return window.KeywordService.getKeywordStats();
  });
  console.log('   ', JSON.stringify(stats));

  check('unranked keywords are not counted in the top 3', stats.top3 === 1);
  check('unranked keywords are not counted in the top 10', stats.top10 === 1);
  check('unranked keywords are not counted in the top 20', stats.top20 === 1);
  check('they are reported separately instead of vanishing', stats.unranked === 2);
  check('the ranked count is stated too', stats.ranked === 2);
  check('the distribution carries a Not ranked bucket', stats.distribution['Not ranked'] === 2);
  check('the average position averages only ranked keywords',
    Number(stats.avgPosition) === 21.0);   // (2 + 40) / 2, not (2+40+0+0)/4 = 10.5
  check('a real improvement is counted', stats.improved === 1);
  check('a real decline is counted', stats.declined === 1);

  // Traffic must not be credited to a keyword with no position.
  const traffic = await page.evaluate(() => {
    const T = window.KeywordService.KeywordTracker;
    return {
      unranked: T.estimateTrafficFromPosition(null, 10000),
      undef: T.estimateTrafficFromPosition(undefined, 10000),
      ranked: T.estimateTrafficFromPosition(1, 10000),
    };
  });
  check('an unranked keyword is credited with no traffic', traffic.unranked === 0);
  check('an undefined position is credited with no traffic', traffic.undef === 0);
  check('a real position still estimates traffic', traffic.ranked === 3160);

  // Every stat must be zero, not absent, for an account with nothing ranked.
  const allUnranked = await page.evaluate(() => {
    const T = window.KeywordService.KeywordTracker;
    T.saveTrackedKeywords([
      { keyword: 'x', position: null, searchVolume: 900, difficulty: null },
      { keyword: 'y', position: null, searchVolume: 900, difficulty: null },
    ]);
    return window.KeywordService.getKeywordStats();
  });
  check('an account with nothing ranked reports zero in the top 3, not two',
    allUnranked.top3 === 0 && allUnranked.top10 === 0);
  check('and has no average position at all, rather than 0',
    allUnranked.avgPosition === null);
  check('and estimates no traffic', allUnranked.estTraffic === 0);

  /* ── 3. Difficulty is no longer a word count ──────────────────────────── */
  console.log('\n──── difficulty is measured or absent ────');

  const diff = await page.evaluate(() => {
    const T = window.KeywordService.KeywordTracker;
    return {
      one: T.estimateDifficulty('insurance'),
      four: T.estimateDifficulty('best cheap car insurance'),
    };
  });
  check('a one-word keyword no longer gets a fabricated difficulty', diff.one === null);
  check('nor does a four-word one', diff.four === null);
  // Comment lines are stripped first: the fix's own explanation quotes the old
  // formula, and matching that would make this assertion pass or fail on prose.
  const svcCode = svc.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  check('difficulty is not derived from word count anywhere',
    !/words\s*\*\s*15/.test(svcCode));

  // Quick wins must require all three inputs to be real.
  const wins = await page.evaluate(() => {
    const T = window.KeywordService.KeywordTracker;
    T.saveTrackedKeywords([
      // Unmeasured difficulty + unranked: must not be a "quick win".
      { keyword: 'p', position: null, searchVolume: 5000, difficulty: null },
      // Fully measured and genuinely a quick win.
      { keyword: 'q', position: 15, searchVolume: 5000, difficulty: 20 },
    ]);
    return window.KeywordService.getOpportunities
      ? window.KeywordService.getOpportunities()
      : null;
  });
  if (wins && wins.quickWins) {
    check('a quick win needs a real difficulty, volume and position',
      wins.quickWins.length === 1 && wins.quickWins[0].keyword === 'q');
  } else {
    check('getOpportunities is reachable', wins !== null);
  }

  /* ── 3b. The provider was reachable all along ─────────────────────────── */
  console.log('\n──── the provider integration is reachable ────');

  // The server-side proxy holds the credentials. The browser cannot see them,
  // so it must be able to ask whether they exist — otherwise a paid-for
  // provider is permanently reported as "not connected".
  const integ = read('api/integration.js');
  check('the proxy answers a capability probe', /req\.method === 'GET'/.test(integ));
  check('and reports booleans, never the credential values',
    /ahrefs:\s*!!process\.env\.AHREFS_API_KEY/.test(integ) &&
    !/configured[\s\S]{0,400}process\.env\.\w+\s*\|\|\s*''/.test(integ));

  const conn = read('web/js/api-connector.js');
  check('the connector probes the server for capabilities',
    /refreshServerCapabilities/.test(conn) && /fetch\('\/api\/integration', \{ method: 'GET' \}\)/.test(conn));
  check('a failed probe is not cached as "nothing configured"',
    /serverCapsPromise = null;[\s\S]{0,80}return null;/.test(conn));

  // No SEO provider may still demand a credential the browser must never hold.
  const gated = [
    /function isAvailable\(\)\s*\{[^}]*return !!getApiToken\(\);\s*\}/,        // ahrefs
    /function isAvailable\(\)\s*\{[^}]*return !!getApiKey\(\);\s*\}/,          // semrush
    /return apiEnabled\('seo\.dataforseo'\) && !!getLogin\(\) && !!getPassword\(\);/,
  ].filter(re => re.test(conn));
  check('no SEO provider is gated on browser-side credentials alone',
    gated.length === 0);
  check('each SEO provider accepts a server-held credential',
    (conn.match(/serverHasCredential\('(ahrefs|semrush|dataforseo)'\)/g) || []).length >= 4);

  // The two DataForSEO modules are different shapes; calling the wrong one
  // throws even when everything is configured.
  check('ranking calls resolve the module that actually has the method',
    /function rankingProvider\(\)/.test(svc) && /typeof m\.getRankings === 'function'/.test(svc));
  check('and nothing calls getRankings on SEOTools.dataforseo directly',
    !/SEOTools\.dataforseo\.getRankings/.test(svc) &&
    !/SEOTools\.dataforseo\.getKeywordMetrics/.test(svc));

  const resolves = await page.evaluate(async () => {
    const T = window.KeywordService.KeywordTracker;
    T.saveTrackedKeywords([{ keyword: 'k', position: null, searchVolume: 0, difficulty: null }]);
    // Exactly the real shape: SEOTools.dataforseo has no getRankings, the
    // top-level DataForSEO does. The resolver must pick the top-level one.
    window.ApiConnector = {
      SEOTools: { dataforseo: {
        isAvailable: () => true,
        getSerpResults: async () => [],
        getKeywordData: async () => [],
      } },
      DataForSEO: {
        isAvailable: () => true,
        getRankings: async () => [{ keyword: 'k', position: 4 }],
        getKeywordMetrics: async () => [{ keyword: 'k', search_volume: 2400, keyword_difficulty: 38 }],
      },
    };
    const r = await T.refreshRankings();
    return { r, row: T.getTrackedKeywords()[0] };
  });
  check('the refresh succeeds against the real module shapes',
    resolves.r.ok === true && resolves.r.updated === 1);
  check('and volume arrives with it, so the column is no longer blank',
    resolves.row.searchVolume === 2400);
  check('and difficulty arrives from the provider, not from a word count',
    resolves.row.difficulty === 38);

  // A provider-reported zero is a real answer and must not be discarded.
  const zero = await page.evaluate(async () => {
    const T = window.KeywordService.KeywordTracker;
    T.saveTrackedKeywords([{ keyword: 'k', position: 4, searchVolume: 2400, difficulty: 38 }]);
    window.ApiConnector.DataForSEO.getKeywordMetrics =
      async () => [{ keyword: 'k', search_volume: 0, keyword_difficulty: 0 }];
    await T.refreshRankings();
    return T.getTrackedKeywords()[0];
  });
  check('a measured volume of 0 replaces the old value rather than being ignored',
    zero.searchVolume === 0);

  /* ── 3c. The connector talks to the proxy and parses what comes back ──── */
  console.log('\n──── transport and response shaping ────');

  check('no DataForSEO call reaches the browser\'s network directly',
    !/fetchWithRetry\(BASE \+/.test(conn));
  check('and the module keeps no upstream base URL to slip out through',
    !/var DataForSEO = \(function\(\)\s*\{[\s\S]{0,200}var BASE = 'https:\/\/api\.dataforseo\.com/.test(conn));

  // Drive the real connector against a fake /api/integration that returns
  // DataForSEO's actual envelope shape.
  const conPage = await browser.newPage();
  conPage.on('pageerror', e => errs.push(e.message));
  await conPage.goto(`http://localhost:${port}/harness.html`);
  await conPage.evaluate(() => {
    localStorage.setItem('seo-dashboard-settings', JSON.stringify({ websiteUrl: 'https://www.acme.com/' }));
  });
  await conPage.addScriptTag({ content: conn });

  const shaped = await conPage.evaluate(async () => {
    const calls = [];
    window.fetch = async (url, opts) => {
      const body = opts && opts.body ? JSON.parse(opts.body) : null;
      calls.push({ url, endpoint: body && body.endpoint, service: body && body.service });

      if (url === '/api/integration' && (!opts || opts.method === 'GET')) {
        return { ok: true, json: async () => ({ configured: { dataforseo: true } }) };
      }
      const ep = body && body.endpoint;
      if (ep === '/serp/google/organic/live/advanced') {
        // Real envelope: tasks[].result[].items[], with other sites present.
        return { ok: true, json: async () => ({ tasks: [{ result: [{
          keyword: 'blue widgets',
          items: [
            { type: 'paid',    domain: 'ads.example',  rank_group: 1 },
            { type: 'organic', domain: 'rival.com',    rank_group: 1, rank_absolute: 2 },
            { type: 'organic', domain: 'www.acme.com', rank_group: 4, rank_absolute: 6,
              url: 'https://www.acme.com/widgets' },
          ],
        }, {
          keyword: 'red widgets',
          items: [{ type: 'organic', domain: 'rival.com', rank_group: 1 }],
        }] }] }) };
      }
      if (ep === '/keywords_data/google_ads/search_volume/live') {
        return { ok: true, json: async () => ({ tasks: [{ result: [
          { keyword: 'blue widgets', search_volume: 1900, cpc: 2.4, competition: 'HIGH' },
        ] }] }) };
      }
      if (ep === '/dataforseo_labs/google/bulk_keyword_difficulty/live') {
        return { ok: true, json: async () => ({ tasks: [{ result: [
          { keyword: 'blue widgets', keyword_difficulty: 62 },
        ] }] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    // Re-run the connector so it picks up the stubbed fetch.
    const D = window.ApiConnector.DataForSEO;
    const ranks = await D.getRankings(['blue widgets', 'red widgets']);
    const metrics = await D.getKeywordMetrics(['blue widgets']);
    return { calls, ranks, metrics };
  });

  check('every DataForSEO request is addressed to the proxy',
    shaped.calls.filter(c => c.endpoint).every(c => c.url === '/api/integration'));
  check('and names dataforseo as the service',
    shaped.calls.filter(c => c.endpoint).every(c => c.service === 'dataforseo'));

  const blue = shaped.ranks.find(r => r.keyword === 'blue widgets');
  const red = shaped.ranks.find(r => r.keyword === 'red widgets');
  check('the SERP envelope is unwrapped into a flat array',
    Array.isArray(shaped.ranks) && shaped.ranks.length === 2);
  check('our own domain\'s organic position is picked out of the results page',
    blue && blue.position === 4);
  check('and www./https:// differences do not stop the match',
    blue && blue.url === 'https://www.acme.com/widgets');
  check('a rival ranking first is not reported as our position',
    blue && blue.position !== 1);
  check('a keyword we do not rank for reads as unranked, having been checked',
    red && red.position === null && red.checked === true);

  const m = shaped.metrics[0];
  check('search volume is unwrapped from its envelope', m && m.search_volume === 1900);
  check('difficulty is fetched from the Labs endpoint and merged in',
    m && m.keyword_difficulty === 62);
  check('difficulty was requested at all — search_volume never returns it',
    shaped.calls.some(c => c.endpoint === '/dataforseo_labs/google/bulk_keyword_difficulty/live'));

  // A missing domain makes the whole question meaningless.
  const noDomain = await conPage.evaluate(async () => {
    localStorage.removeItem('seo-dashboard-settings');
    try {
      await window.ApiConnector.DataForSEO.getRankings(['x']);
      return 'resolved';
    } catch (e) { return e.message; }
  });
  check('rankings refuse to run with no site set, rather than guessing',
    /no domain to measure rankings against/i.test(noDomain));

  await conPage.close();

  /* ── 4. Refresh Rankings is no longer silent ──────────────────────────── */
  console.log('\n──── refresh rankings reports what happened ────');

  check('the simulate-named function is gone from the service',
    !/simulateRankingUpdate\s*\(\s*\)\s*\{/.test(svc));
  check('and nothing still calls it',
    !/\.simulateRankingUpdate\(/.test(read('web/seo/keywords.html')));

  const refresh = await page.evaluate(async () => {
    const T = window.KeywordService.KeywordTracker;
    T.saveTrackedKeywords([{ keyword: 'z', position: null, searchVolume: 10, difficulty: null }]);
    // No provider configured at all — the common case. (Cleared explicitly:
    // the previous block installed one.)
    delete window.ApiConnector;
    const noProvider = await T.refreshRankings();

    // A provider that answers.
    window.ApiConnector = { DataForSEO: {
      isAvailable: () => true,
      getRankings: async () => [{ keyword: 'z', position: 7 }],
    } };
    const worked = await T.refreshRankings();
    const after = T.getTrackedKeywords()[0];

    // A provider that fails.
    window.ApiConnector.DataForSEO.getRankings = async () => { throw new Error('quota exceeded'); };
    const broke = await T.refreshRankings();

    return { noProvider, worked, after, broke };
  });
  console.log('   ', JSON.stringify(refresh.noProvider), JSON.stringify(refresh.worked));

  check('with no provider it says so rather than silently doing nothing',
    refresh.noProvider.ok === false && refresh.noProvider.reason === 'no_provider');
  check('a real refresh reports how many positions changed',
    refresh.worked.ok === true && refresh.worked.updated === 1);
  check('and the position is actually stored', refresh.after.position === 7);
  check('a first ranking is marked new, not as a decline',
    refresh.after.trend === 'new');
  check('a provider failure is surfaced with its reason',
    refresh.broke.ok === false && refresh.broke.reason === 'provider_error' &&
    /quota exceeded/.test(refresh.broke.detail));

  await page.close();

  /* ── 5. SEO Pulse: a failed scan is not a bad score ───────────────────── */
  console.log('\n──── seo pulse does not invent a score ────');

  check('the pulse scan no longer calls googleapis.com from the browser',
    !/googleapis\.com\/pagespeedonline/.test(pulseSrc));
  check('it goes through the server-side proxy instead',
    /\/api\/pagespeed\?url=/.test(pulseSrc));

  // Drive the real page with a proxy that fails, then one that succeeds.
  const p2 = await browser.newPage();
  p2.on('pageerror', e => errs.push(e.message));

  async function scan(url) {
    await p2.goto(`http://localhost:${port}/seo-pulse.html`);
    await p2.fill('#urlInput', url);
    await p2.click('#scanBtn');
    await p2.waitForSelector('.results-section.active', { timeout: 20000 });
    await p2.waitForTimeout(600);
    return p2.evaluate(() => ({
      body: document.body.innerText,
      panelShown: (document.getElementById('unmeasuredPanel') || {}).style?.display === 'block',
      scoreShown: getComputedStyle(document.querySelector('.score-card')).display !== 'none',
      scoreText: (document.getElementById('scoreNumber') || {}).textContent || '',
    }));
  }

  const failed = await scan('https://example.com');
  check('a failed scan shows no score at all', failed.panelShown && !failed.scoreShown);
  check('and says nothing was measured, rather than showing a bad result',
    /nothing was measured/i.test(failed.body));
  check('and never prints the fabricated 15', !/\b15\b\s*\/\s*100/.test(failed.body));
  check('and passes on the provider\'s actual reason',
    /Rate limit exceeded/i.test(failed.body));
  check('and does not claim the meta tags were analysed',
    !/Meta tags analyzed/i.test(failed.body));

  psMode = 'ok';
  const good = await scan('https://example.com');
  check('a successful scan still shows a score', good.scoreShown && !good.panelShown);
  check('and the score is a real number', /\d/.test(good.scoreText));

  /* ── 6. Dead ends ─────────────────────────────────────────────────────── */
  console.log('\n──── dead ends ────');

  // Every Fix Now target must be able to act on the parameters it is sent.
  const targets = [...pulseSrc.matchAll(/url:\s*'([^']+)'/g)].map(m => m[1]);
  const uniqueTargets = [...new Set(targets)];
  const unhandled = uniqueTargets.filter(t => {
    const f = path.join(REPO, 'web', t.replace(/^\//, ''));
    return !fs.existsSync(f) || !fs.readFileSync(f, 'utf8').includes('seo-pulse-handler');
  });
  check('every Fix Now target exists and loads the pulse handler',
    unhandled.length === 0);
  if (unhandled.length) console.log('    unhandled:', unhandled);

  // Every action the pulse sends must have a handler entry.
  const sent = new Set([...pulseSrc.matchAll(/action:\s*'([a-z-]+)'/g)].map(m => m[1]));
  const handler = read('web/js/seo-pulse-handler.js');
  const missing = [...sent].filter(a => !new RegExp(`'${a}'\\s*:`).test(handler));
  check('every issue action the pulse sends has a handler', missing.length === 0);
  if (missing.length) console.log('    missing:', missing);

  // No SEO page may quietly scan a domain the customer does not own.
  const demoFallback = ['web/seo/backlinks.html', 'web/seo/keywords.html',
                        'web/keywords/research.html', 'web/keywords/opportunities.html']
    .filter(f => /\|\|\s*'example\.com'/.test(read(f)));
  check('no page falls back to scanning example.com', demoFallback.length === 0);
  if (demoFallback.length) console.log('    ', demoFallback);

  check('backlink discovery separates "no provider" from "no backlinks"',
    /hasBacklinkProvider/.test(read('web/seo/backlinks.html')));

  check('no JS errors', errs.length === 0);
  if (errs.length) console.log('  errors:', errs.slice(0, 4));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));

  await browser.close();
  server.close();
  process.exit(fail.length === 0 ? 0 : 1);
})();
