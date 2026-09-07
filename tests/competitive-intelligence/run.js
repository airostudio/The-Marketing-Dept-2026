/**
 * Competitive Intelligence.
 *
 * The agent (web/agents/competitive-agent.html) was already honest: it probes
 * /api/domain-metrics for a real provider, shows a green or amber banner
 * accordingly, and only injects live SEO figures into the analysis when they
 * actually came back. It is the model the rest of the surface should follow,
 * and it was left alone. Four findings elsewhere:
 *
 *   1. web/seo/competitors.html searched a hardcoded list of 75 famous global
 *      brands — "nike", "shopify", "hubspot" — each carrying invented DA,
 *      traffic and keyword figures. Two harms, the first worse: a customer
 *      could only add a competitor if it happened to be one of those 75, so a
 *      Brisbane roof restorer looking for the firm across town got "No
 *      businesses found" and the page's only action failed; and the numbers
 *      shown beside each result, in the selection panel and in the tracked
 *      table were constants presented as measurements.
 *
 *   2. web/competitors/gap-analysis.html was a stub: three tiles hardcoded to
 *      "--" and an empty state reading "No Competitors Added" that rendered
 *      unconditionally — including immediately after you added competitors on
 *      the page its own button sends you to. It read no data at all.
 *
 *   3. competitive-command.html guarded all three of its AI features with
 *      `if (!window.ClaudeService?.getApiKey())`. ClaudeService has no
 *      getApiKey — the Anthropic key is server-side, behind /api/claude, and
 *      must never reach a browser. `?.` guards the object being absent, not
 *      the method being missing, so the call threw and every AI feature on the
 *      page died on click.
 *
 *   4. competitive-radar.html called ClaudeService.streamResponse but never
 *      loaded claude-service.js. Its guard therefore always fired, telling the
 *      customer to "add your API key in Settings" — a thing they cannot do and
 *      should not need to.
 *
 *   node tests/competitive-intelligence/run.js
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

const PAGES = {
  competitors: 'web/seo/competitors.html',
  gap:         'web/competitors/gap-analysis.html',
  command:     'web/intelligence/competitive-command.html',
  radar:       'web/intelligence/competitive-radar.html',
  agent:       'web/agents/competitive-agent.html',
};

(async () => {
  /* ── 1. The invented competitor database is gone ──────────────────────── */
  console.log('──── competitor lookup is not a fixed list ────');

  const comp = code(PAGES.competitors);

  check('the hardcoded business database is gone',
    !/businessDatabase\s*=/.test(comp));
  check('and its invented figures with it',
    !/da: 92, traffic: '45\.2M'/.test(comp) && !/'shopify': \{/.test(comp));
  check('the local-array search is gone',
    !/function searchBusinesses\(/.test(comp));
  check('lookups go to the real metrics endpoint',
    /\/api\/domain-metrics/.test(comp));
  check('and carry the session, since that endpoint spends credits',
    /sendAuthHeaders/.test(comp) && /send-auth\.js/.test(read(PAGES.competitors)));
  check('the placeholder no longer suggests only global brands',
    !/e\.g\., Nike, Shopify, HubSpot/.test(read(PAGES.competitors)));
  check('the sample metrics baked into the markup are gone',
    !/id="selectedDA">92</.test(read(PAGES.competitors)) &&
    !/id="selectedDomain">nike\.com</.test(read(PAGES.competitors)));

  // The columns must name what the endpoint actually returns. It gives domain
  // rating, backlinks and referring domains — not traffic, keywords or an
  // industry classification, which is what the old headers promised.
  const headers = read(PAGES.competitors);
  check('table columns name what is actually measured',
    /<th>Authority<\/th>/.test(headers) && /<th>Backlinks<\/th>/.test(headers) &&
    /<th>Ref\. domains<\/th>/.test(headers));
  check('and no longer promise traffic, keywords or an industry',
    !/<th>Est\. Traffic<\/th>/.test(headers) && !/<th>Industry<\/th>/.test(headers));

  // Exercise the real domain parser.
  const normalise = extractNormaliser(read(PAGES.competitors));
  check('a bare domain is accepted', normalise('acme.com.au') === 'acme.com.au');
  check('a full URL is reduced to its host',
    normalise('https://www.acme.com.au/pricing?x=1') === 'acme.com.au');
  check('case and whitespace do not matter', normalise('  ACME.com  ') === 'acme.com');
  check('a bare business name is not mistaken for a domain', normalise('Acme Roofing') === null);
  check('nor is an empty box', normalise('') === null && normalise('   ') === null);
  // The exact case the old list could not serve.
  check('a local competitor nobody has heard of resolves fine',
    normalise('brisbaneroofrestoration.com.au') === 'brisbaneroofrestoration.com.au');

  /* ── 2. Gap analysis reads real state ─────────────────────────────────── */
  console.log('\n──── gap analysis is no longer a stub ────');

  const gap = code(PAGES.gap);
  check('it reads the tracked competitor list', /seo-competitors/.test(gap));
  check('it checks whether a keyword provider exists',
    /\/api\/integration/.test(gap));
  check('the "No Competitors Added" text no longer renders unconditionally',
    !/<h3>No Competitors Added<\/h3>/.test(read(PAGES.gap)));
  check('the tiles are addressable rather than hardcoded to a dash',
    /id="gapKeywords"/.test(read(PAGES.gap)) && /id="gapAdvantages"/.test(read(PAGES.gap)));
  check('it distinguishes "none tracked" from "no provider to compare with"',
    /No competitors tracked yet/.test(gap) && /No keyword provider is connected/.test(gap));

  /* ── 3. The AI guards check the right thing ───────────────────────────── */
  console.log('\n──── the AI features are reachable ────');

  [['command', PAGES.command], ['radar', PAGES.radar]].forEach(([label, file]) => {
    const src = code(file);
    check(`${label}: no live call to the nonexistent getApiKey()`,
      !/ClaudeService[?.]*\.getApiKey\(\)/.test(src));
    check(`${label}: the guard checks the service actually loaded`,
      /ClaudeService\?\.streamResponse/.test(src));
    check(`${label}: and no longer tells the customer to add a key in Settings`,
      !/Go to Settings to add your (API )?key/.test(src));
  });

  check('radar now loads the service it calls',
    /claude-service\.js/.test(read(PAGES.radar)));

  // The trap that made this class of bug invisible: optional chaining does not
  // protect a call to a method that does not exist.
  const svc = { streamResponse() {} };
  let threw = false;
  try { svc?.getApiKey(); } catch { threw = true; }
  check('the trap is real: obj?.missingMethod() still throws', threw);

  // Every ClaudeService method these pages name must exist, or they are broken
  // in exactly the way they were — silently, on click.
  const claudeSrc = read('web/js/claude-service.js');
  const named = new Set();
  [PAGES.command, PAGES.radar, PAGES.agent].forEach(f => {
    for (const m of code(f).matchAll(/ClaudeService[?.]*\.(\w+)/g)) named.add(m[1]);
  });
  const missing = [...named].filter(n => !new RegExp('function ' + n + '\\b').test(claudeSrc));
  check('every ClaudeService method these pages call is defined', missing.length === 0);
  if (missing.length) console.log('    ', missing);

  /* ── 4. Nothing on the surface fabricates ─────────────────────────────── */
  console.log('\n──── no invented metrics anywhere on the surface ────');

  Object.entries(PAGES).forEach(([label, file]) => {
    const src = code(file);
    // Math.random is fine for generating an id; it is not fine for a metric.
    const randomMetrics = [...src.matchAll(/(\w+)\s*[:=]\s*[^;\n]*Math\.random/g)]
      .filter(m => !/^(id|uid|key|seed|nonce|suffix)$/i.test(m[1]));
    check(`${label}: no metric derived from Math.random`, randomMetrics.length === 0);
  });

  check('the competitor agent still probes for a real provider before claiming one',
    /provider && data\.provider !== 'none'/.test(code(PAGES.agent)));
  check('and says plainly when there is none',
    /No SEO API keys detected/.test(read(PAGES.agent)));
  check('the domain-metrics endpoint reports "none" rather than inventing a rating',
    /provider: 'none'/.test(read('api/domain-metrics.js')));

  /* ── 5. In a browser, end to end ──────────────────────────────────────── */
  console.log('\n──── the real pages, in a real browser ────');

  const b = await browser();
  try {
    check('every competitive page loads with no JavaScript error',
      b.errors.length === 0);
    if (b.errors.length) console.log('    ', b.errors);

    check('a local domain nobody has heard of returns live metrics',
      /brisbaneroofing\.com\.au/.test(b.lookupLive) && /34/.test(b.lookupLive));
    check('and names the provider that answered', /dataforseo/i.test(b.lookupLive));
    check('with no provider, the domain is still trackable',
      /x\.com\.au/.test(b.lookupNone));
    check('and the reason is shown instead of a number',
      /DATAFORSEO_LOGIN/.test(b.lookupNone) && !/\b92\b/.test(b.lookupNone));

    check('gap analysis with nothing tracked says so',
      /No competitors tracked yet/.test(b.gapEmpty));
    check('gap analysis with competitors tracked names them',
      /Tracking 2 competitors/.test(b.gapTracked) &&
      /rivalroofing\.com\.au/.test(b.gapTracked));
    check('and no longer claims you have added none',
      !/No Competitors Added/.test(b.gapTracked));

    check('ClaudeService.streamResponse is present on both AI pages',
      b.commandStream === 'function' && b.radarStream === 'function');
  } finally {
    await b.close();
  }

  /* ── 6. The roster lives in the account, not one browser ─────────────── */
  console.log('\n──── the competitive picture is not trapped on one machine ────');

  const sql = read('supabase-competitive-roster.sql');
  const store = read('web/js/competitive-roster-store.js');
  const cmd = code(PAGES.command);

  check('there is a table for the roster', /CREATE TABLE IF NOT EXISTS competitive_roster/.test(sql));
  check('it is row-level secured to its owner',
    /ENABLE ROW LEVEL SECURITY/.test(sql) && /auth\.uid\(\) = user_id/.test(sql));
  check('a teammate on a shared profile can read it',
    /intelligence_profile_members/.test(sql));
  check('re-saving a record updates it rather than duplicating',
    /UNIQUE \(user_id, kind, client_id\)/.test(sql));
  check('the migration is idempotent like the others',
    /CREATE TABLE IF NOT EXISTS/.test(sql) && /DROP POLICY IF EXISTS/.test(sql));
  check('and is in the combined installer',
    /competitive_roster/.test(read('supabase-install-all.sql')));

  check('the page writes through a store, not straight to localStorage',
    !/localStorage\.setItem\(RADAR_KEY/.test(cmd) &&
    !/localStorage\.setItem\(GAPS_KEY/.test(cmd) &&
    !/localStorage\.setItem\(BC_KEY/.test(cmd));
  check('and loads the store',
    /competitive-roster-store\.js/.test(read(PAGES.command)));
  check('Supabase is actually loaded on the page',
    /supabase-client\.js/.test(read(PAGES.command)));

  check('an existing local roster is lifted into the account once',
    /migrateLocal/.test(store) && /migrateLocal/.test(cmd));
  check('and never overwrites what the cloud already holds',
    /if \(remote\.length\) continue;/.test(store));
  check('an offline project id is not sent into a uuid column',
    /startsWith\('local_'\)/.test(store));

  // The failure this whole change is about: a save the customer believes
  // happened, that only ever reached this browser.
  check('a failed cloud save is reported, not swallowed',
    /Saved on this device only/.test(cmd));
  check('and being signed out is stated rather than looking synced',
    /Sign in to sync your competitive roster/.test(cmd));
  check('a read that could not reach the cloud is distinguishable from an empty one',
    /return null;/.test(store) && /source: 'cache', synced: false/.test(store));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Pulls the page's own normaliseDomain out of the source and runs it. */
function extractNormaliser(src) {
  const m = src.match(/function normaliseDomain\(input\) \{[\s\S]*?\n        \}/);
  if (!m) throw new Error('normaliseDomain not found in competitors.html');
  // eslint-disable-next-line no-new-func
  return new Function(m[0] + '; return normaliseDomain;')();
}

async function browser() {
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
  const errors = [];

  const open = async (url, prep) => {
    const p = await br.newPage();
    p.on('pageerror', e => errors.push(url + ': ' + e.message));
    if (prep) await prep(p);
    await p.goto(base + url, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(900);
    return p;
  };

  const json = (body) => (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  // A real local business, with a provider connected.
  const p1 = await open('/seo/competitors.html', async p => {
    await p.route('**/api/domain-metrics', json({
      domain: 'brisbaneroofing.com.au', domainRating: 34,
      backlinks: 1820, refDomains: 96, provider: 'dataforseo',
    }));
  });
  await p1.click('.topbar-right .btn-primary').catch(() => {});
  await p1.fill('#businessSearch', 'brisbaneroofing.com.au');
  await p1.waitForTimeout(1500);
  const lookupLive = await p1.evaluate(() => document.getElementById('searchResults').textContent);

  // The same page with nothing configured.
  const p2 = await open('/seo/competitors.html', async p => {
    await p.route('**/api/domain-metrics', json({
      domain: 'x.com.au', domainRating: null, provider: 'none',
      message: 'Add DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD to Vercel environment variables to enable live domain metrics.',
    }));
  });
  await p2.click('.topbar-right .btn-primary').catch(() => {});
  await p2.fill('#businessSearch', 'x.com.au');
  await p2.waitForTimeout(1500);
  const lookupNone = await p2.evaluate(() => document.getElementById('searchResults').textContent);

  const p3 = await open('/competitors/gap-analysis.html');
  await p3.waitForTimeout(600);
  const gapEmpty = await p3.evaluate(() =>
    document.getElementById('gapStateTitle').textContent + ' ' + document.getElementById('gapStateBody').textContent);

  const p4 = await open('/competitors/gap-analysis.html', async p => {
    await p.addInitScript(() => localStorage.setItem('seo-competitors',
      JSON.stringify([{ domain: 'rivalroofing.com.au' }, { domain: 'toproofers.com.au' }])));
    await p.route('**/api/integration', json({ configured: { ahrefs: false, semrush: false, dataforseo: false } }));
  });
  await p4.waitForTimeout(900);
  const gapTracked = await p4.evaluate(() =>
    document.getElementById('gapStateTitle').textContent + ' ' + document.getElementById('gapStateBody').textContent);

  const p5 = await open('/intelligence/competitive-command.html');
  const commandStream = await p5.evaluate(() => typeof window.ClaudeService?.streamResponse);
  const p6 = await open('/intelligence/competitive-radar.html');
  const radarStream = await p6.evaluate(() => typeof window.ClaudeService?.streamResponse);
  await open('/agents/competitive-agent.html');

  return {
    errors, lookupLive, lookupNone, gapEmpty, gapTracked, commandStream, radarStream,
    close: async () => { await br.close(); server.close(); },
  };
}
