/**
 * Nancy ("Jam Fancy") — Instagram content studio.
 *
 * Three findings, one of which made the whole agent inert:
 *
 *   1. A build step that added the mission-bar loader to every agent page put
 *      Nancy's two <script> tags INSIDE a template literal — the HTML for a
 *      print popup. The browser ends a script at the first literal
 *      "</script>" regardless of quoting, so that tag closed the page's own
 *      inline script and left 140 lines orphaned. The page threw "Unexpected
 *      end of input" on load and not one handler was ever bound: no research
 *      run, no editor, no download. Nancy was a dead page.
 *
 *   2. Brand colours were read out of `<style>` blocks and inline style=""
 *      attributes only. Real sites — Squarespace, Shopify, WordPress, every
 *      bundler — ship linked stylesheets, so on a customer's actual site
 *      nothing was found. With no candidates and no screenshot (the default
 *      deployment has no SCREENSHOT_API_KEY), Claude was still handed a tool
 *      schema requiring primary_colour, so it returned a plausible hex. Nancy
 *      then told the customer it was their brand colour, described it as
 *      "read from CSS", and rendered a week of Instagram creative in it.
 *
 *   3. extractFontHints required a trailing semicolon on font-family, which
 *      every minifier drops from the last declaration in a block — so on
 *      minified stylesheets it found no fonts at all.
 *
 *   node tests/nancy/run.js
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

const { extractColours, extractFontHints } = require(path.join(REPO, 'api/_lib/nancy-colours.js'));
const { fetchLinkedStylesheets } = require(path.join(REPO, 'api/_lib/nancy-crawl.js'));

(async () => {
  /* ── 1. The page's script actually runs ───────────────────────────────── */
  console.log('──── the agent is not a dead page ────');

  const src = read('web/agents/nancy-agent.html');

  // A literal "</script>" anywhere inside an inline script ends it — quoting
  // does not help, which is what made this so easy to introduce and so total
  // in effect. Only the escaped form is safe.
  const printBlock = (src.match(/document\.write\(`[\s\S]*?`\)/) || [''])[0];
  check('no unescaped </script> inside the print-window template',
    !/<\/script>/.test(printBlock));
  check('the escaped form is used instead', /<\\\/script>/.test(printBlock));
  // Scoped to the template literal itself — matching across the whole file
  // would reach the legitimate loader tags in the footer.
  check('the mission-bar loaders are no longer inside a template literal',
    !/mission-(store|bar)\.js/.test(printBlock));
  check('and are loaded at the foot of the page, where they work',
    /<script src="\/js\/mission-store\.js"><\/script>\s*\n\s*<script src="\/js\/mission-bar\.js"><\/script>\s*\n<\/body>/.test(src));

  // Load the real page in a browser: the assertion that actually matters is
  // that the script reaches its end and binds its handlers.
  const browserResult = await inBrowser();
  check('the page loads with no JavaScript error', browserResult.errors.length === 0);
  if (browserResult.errors.length) console.log('    ', browserResult.errors);
  check('the inline script runs to completion', browserResult.scriptRan);
  check('the mission bar is registered on the page', browserResult.missionBar);

  // This break was silent — the page still rendered, so nothing looked wrong
  // until you clicked something. Every page gets the same check so the next
  // bulk edit that lands a </script> in a string is caught here, not by a
  // customer. It is a source scan, not 85 browser loads.
  const suspect = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return walk(full);
    if (!d.name.endsWith('.html')) return;
    const text = fs.readFileSync(full, 'utf8');
    // Inside a JS string or template literal, only <\/script> is safe.
    for (const m of text.matchAll(/document\.write\(`[\s\S]*?`\)|innerHTML\s*=\s*`[\s\S]*?`/g)) {
      if (/<\/script>/.test(m[0])) suspect.push(path.relative(REPO, full));
    }
  });
  walk(path.join(REPO, 'web'));
  check('no page embeds an unescaped </script> in a JS string',
    suspect.length === 0);
  if (suspect.length) console.log('    ', [...new Set(suspect)]);

  /* ── 2. Brand colours come from the site, or from the customer ────────── */
  console.log('\n──── a brand colour is read, not guessed ────');

  // A page shaped like every real site: no inline colours, one linked sheet.
  const realistic = '<html><head><link rel="stylesheet" href="/theme.css"></head><body><h1>Acme</h1></body></html>';
  const themeCss = ':root{--primary:#e53e3e;--accent:#2b6cb0}.btn{background:#e53e3e}h1{font-family:Poppins,sans-serif}';

  const withoutCss = extractColours(realistic);
  check('the trap is real: inline-only extraction finds nothing on such a site',
    withoutCss.allCandidates.length === 0 && withoutCss.primary === null);

  const withCss = extractColours(realistic, themeCss);
  check('reading the linked stylesheet finds the brand colour',
    withCss.primary === '#e53e3e');
  check('and ranks the declared --primary above the accent',
    withCss.allCandidates[0] === '#e53e3e' && withCss.allCandidates.includes('#2b6cb0'));
  check('callers can tell "no colours declared" from "never looked"',
    extractColours(realistic).cssBytesRead === 0 && withCss.cssBytesRead > 0);

  check('fonts survive a minifier dropping the last semicolon',
    extractFontHints(realistic, 'h1{font-family:Poppins,sans-serif}').includes('Poppins'));
  check('and are still found with the semicolon present',
    extractFontHints(realistic, 'h1{font-family:Inter, sans-serif;}').includes('Inter'));

  // The crawler has to actually go and get those sheets.
  const served = await withStylesheetServer(themeCss);
  check('the crawler fetches the stylesheets a page links to',
    served.includes('--primary'));

  // The hrefs come out of the crawled site's own HTML, so the site chooses
  // where we make a request to. A "stylesheet" pointed at the cloud metadata
  // endpoint must not be fetched, and its response must never reach the
  // colour extractor or the Claude prompt downstream of it.
  const blocked = await blockedStylesheetHost();
  check('a stylesheet linked at an internal address is not fetched',
    blocked.requested === false);
  check('and the crawl returns nothing rather than that address’s response',
    blocked.out === '');

  const crawlSrc = read('api/_lib/nancy-crawl.js');
  check('stylesheet fetching is bounded like the page crawl',
    /MAX_STYLESHEETS/.test(crawlSrc) && /MAX_CSS_BYTES_PER_SHEET/.test(crawlSrc));
  check('a site whose "/" fails but whose other pages answer is not a dead end',
    /if \(!homepageHtml\)[\s\S]{0,200}fetchResults\.find/.test(crawlSrc));

  /* ── 3. With no evidence at all, nothing is asserted ──────────────────── */
  console.log('\n──── no evidence means no answer, not a plausible one ────');

  const brandSrc = read('api/nancy-brand-identity.js');
  check('with no screenshot and no candidates, Claude is not asked to name a colour',
    /!parsedShot && candidates\.length === 0/.test(brandSrc));
  check('the response says so rather than returning a hex',
    /colours_measured: false/.test(brandSrc) && /primary_colour: null/.test(brandSrc));
  check('when there IS only CSS, the model is told not to invent a hex',
    /do not name a hex that is not in it/.test(brandSrc));
  check('a real reading records which evidence it rests on',
    /measured_from: parsedShot \? 'screenshot' : 'stylesheet'/.test(brandSrc));

  const screenshotSrc = read('api/nancy-screenshot.js');
  check('the stylesheets are passed to the colour extractor',
    /extractColours\(crawl\.homepageHtml, crawl\.homepageCss\)/.test(screenshotSrc));

  /* ── 4. The UI reports what happened ──────────────────────────────────── */
  console.log('\n──── the customer is told what was measured ────');

  const client = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*|<!--)/.test(l)).join('\n');

  check('the swatch no longer defaults to a purple that looks measured',
    !/value="\$\{s\.value \|\| '#7c3aed'\}"/.test(client));
  check('an undetected colour is labelled as undetected',
    /not detected/.test(client));
  check('the discovery line no longer claims "read from CSS" unconditionally',
    !/\(No live screenshot service configured — colours read from CSS\.\)/.test(client));
  check('it distinguishes a screenshot reading from a stylesheet reading',
    /read from your site's stylesheets/.test(client) &&
    /read from a screenshot of your live site/.test(client));
  check('the run will not start on an unset primary colour',
    /every post this week is rendered in it/.test(client));
  check('and a colour the customer picks counts as a real answer',
    /b\.colours_measured = true/.test(client));

  console.log('\n' + (fail.length === 0
    ? 'ALL ASSERTIONS PASSED'
    : `${fail.length} FAILED: ${fail.join(' | ')}`));
  process.exit(fail.length === 0 ? 0 : 1);
})();

/* ── helpers ─────────────────────────────────────────────────────────────── */

// Serves web/ and loads the real Nancy page in Chromium.
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
  await page.goto(`http://127.0.0.1:${port}/agents/nancy-agent.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const result = await page.evaluate(() => ({
    scriptRan: typeof runResearchPipeline === 'function',
    missionBar: typeof window.MissionStore === 'object' || typeof window.MissionBar === 'object',
  }));
  await browser.close();
  server.close();
  return { ...result, errors };
}

// Stands up a page that links a stylesheet, and asks the crawler to fetch it.
/**
 * Fetch the stylesheets a page links to, against a stubbed network.
 *
 * This used to stand up a real http server on 127.0.0.1. It cannot any more,
 * and that is the point: every crawl request now goes through
 * api/_lib/safe-fetch.js, which refuses loopback. The stylesheet path is one
 * of the places that matters most, because the hrefs come out of the HTML of
 * the site being crawled — a hostile page can link a "stylesheet" at
 * http://169.254.169.254/ and have us fetch it and feed the response into the
 * colour extractor and then into a Claude prompt. withStylesheetServer() is
 * therefore split: this one proves the fetching works against a reachable
 * host, and blockedStylesheetHost() below proves it does not against an
 * internal one.
 */
async function withStylesheetServer(css) {
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).endsWith('/theme.css')) {
      return {
        status: 200,
        url: String(url),
        headers: new Map([['content-type', 'text/css']]),
        body: streamOf(css),
      };
    }
    return { status: 404, url: String(url), headers: new Map(), body: streamOf('nf') };
  };
  try {
    const html = `<html><head><link rel="stylesheet" href="/theme.css"></head><body></body></html>`;
    return await fetchLinkedStylesheets(html, 'https://example.com/');
  } finally {
    global.fetch = realFetch;
  }
}

/** A single-chunk ReadableStream, which is what safeFetchText reads from. */
function streamOf(text) {
  const bytes = Buffer.from(text, 'utf8');
  let sent = false;
  return {
    getReader() {
      return {
        read: async () => (sent ? { done: true } : (sent = true, { done: false, value: bytes })),
        cancel: async () => {},
      };
    },
  };
}

/**
 * A page that links its "stylesheet" at an internal address. Returns what the
 * crawler came back with, and whether it actually made the request.
 */
async function blockedStylesheetHost() {
  const realFetch = global.fetch;
  let requested = false;
  global.fetch = async (url) => {
    requested = true;
    return { status: 200, url: String(url), headers: new Map([['content-type', 'text/css']]), body: streamOf(':root{--primary:#000}') };
  };
  try {
    const html = '<html><head><link rel="stylesheet" href="http://169.254.169.254/latest/meta-data/">' +
                 '<link rel="stylesheet" href="http://127.0.0.1:9/admin.css"></head><body></body></html>';
    const out = await fetchLinkedStylesheets(html, 'https://example.com/');
    return { out, requested };
  } finally {
    global.fetch = realFetch;
  }
}
