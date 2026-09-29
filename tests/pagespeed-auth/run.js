/**
 * Core Web Vitals (web/seo/vitals.html, via web/js/seo-modules.js) reported:
 *
 *   Error: Failed to analyze website: PageSpeed API error: 401;
 *          PageSpeed API error: 401
 *
 * api/pagespeed.js requires an identified caller (requireUser) — Google's
 * PageSpeed quota is shared across every customer on this deployment's key,
 * so the endpoint refuses an anonymous caller before ever reaching Google.
 * seo-modules.js's fetchPageSpeedData() never called sendAuthHeaders(), so
 * EVERY request was rejected 401 by our own gate regardless of whether the
 * user was signed in — and the error text swallowed the real reason, because
 * it only knew how to read Google's {error:{message}} shape, not this app's
 * own {error: "plain string"} shape, so it fell back to a bare status code.
 *
 *   node tests/pagespeed-auth/run.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const src = fs.readFileSync(path.join(REPO, 'web/js/seo-modules.js'), 'utf8');

function loadModule(fakeWindow) {
  const fakeDocument = { createElement: () => ({ set textContent(v) {}, innerHTML: '' }) };
  const fn = new Function('window', 'document', `${src}\nreturn window.SEOModules;`);
  return fn(fakeWindow, fakeDocument);
}

console.log('\n──── every PageSpeed request carries an Authorization header ────');
(async () => {
  let capturedHeaders = null;
  global.fetch = async (url, opts) => {
    capturedHeaders = (opts && opts.headers) || {};
    return {
      ok: true,
      json: async () => ({ lighthouseResult: { categories: {}, audits: {} } }),
    };
  };

  const fakeWindow = {
    sendAuthHeaders: async () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer real-token' }),
  };
  const SEOModules = loadModule(fakeWindow);

  try { await SEOModules.CoreWebVitals.fetchPageSpeedData('https://example.com', 'mobile'); } catch (e) { /* parsing isn't under test here */ }

  check('sendAuthHeaders() was actually called and its Authorization header was sent',
    capturedHeaders && capturedHeaders.Authorization === 'Bearer real-token');

  console.log('\n──── a 401 from OUR OWN auth gate surfaces its real message, not a bare status code ────');

  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: 'Sign in to use this.', code: 'no_token' }),
  });
  let caught = null;
  try { await SEOModules.CoreWebVitals.fetchPageSpeedData('https://example.com', 'mobile'); }
  catch (e) { caught = e; }
  check('the thrown error is our own message, not "PageSpeed API error: 401"',
    caught && caught.message === 'Sign in to use this.');

  console.log('\n──── a real 401 from Google itself still surfaces its message the same way as before ────');

  global.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: { code: 401, message: 'API key not valid. Please pass a valid API key.' } }),
  });
  let caughtGoogle = null;
  try { await SEOModules.CoreWebVitals.fetchPageSpeedData('https://example.com', 'mobile'); }
  catch (e) { caughtGoogle = e; }
  check('Google\'s nested {error:{message}} shape is still read correctly',
    caughtGoogle && caughtGoogle.message === 'API key not valid. Please pass a valid API key.');

  console.log('\n──── an unparseable error body still falls back to a status code, not a crash ────');

  global.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'not json',
  });
  let caughtFallback = null;
  try {
    // 500 retries CONFIG.retryAttempts (3) times with backoff — force it to
    // fail fast by monkey-patching setTimeout to run immediately.
    const realSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => { fn(); return 0; };
    try { await SEOModules.CoreWebVitals.fetchPageSpeedData('https://example.com', 'mobile'); }
    finally { global.setTimeout = realSetTimeout; }
  } catch (e) { caughtFallback = e; }
  check('falls back to a generic status-code message rather than throwing on bad JSON',
    caughtFallback && caughtFallback.message === 'PageSpeed API error: 500');

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
