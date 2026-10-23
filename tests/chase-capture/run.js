/**
 * Chase · Site Capture: the provider requests (api/_lib/site-capture.js), the
 * endpoint (api/chase-capture.js) and the page. Only public sites are
 * captured, every option a provider can't honour is said out loud, and an
 * unstored capture is labelled as such.
 *
 *   node tests/chase-capture/run.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; }
function mockModule(rel, exp) { const p = require.resolve(path.join(REPO, rel)); require.cache[p] = { id: p, filename: p, loaded: true, exports: exp }; }

// A minimal valid PNG header: 2880 × 9000.
function png(w, h, extra = 0) { const b = Buffer.alloc(33 + extra); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; }

(async () => {
  const sc = require(path.join(REPO, 'api/_lib/site-capture.js'));
  console.log('\n──── options and provider requests ────');
  const o = sc.normalizeOptions({ width: 99999, height: 1, scale: 7, delayMs: -5, fullPage: 'false' });
  check('every option is bounded', o.width === 3840 && o.height === 240 && o.scale === 2 && o.delayMs === 0 && o.fullPage === false);
  const d = sc.normalizeOptions({});
  check('defaults match ShotWeb: 1440×900, full page, 2×, sticky headers neutralised', d.width === 1440 && d.height === 900 && d.fullPage && d.scale === 2 && d.hideFixed && d.lazyScroll);

  const one = sc.buildRequest('screenshotone', 'KEY', 'https://example.com', d);
  const p1 = new URL(one.url).searchParams;
  check('ScreenshotOne: full page with scroll-to-load, 2×, the window size, banners blocked, live (no cache)', p1.get('full_page') === 'true' && p1.get('full_page_scroll') === 'true' && p1.get('device_scale_factor') === '2' && p1.get('viewport_width') === '1440' && p1.get('block_cookie_banners') === 'true' && p1.get('cache') === 'false');
  check('…and the sticky-header CSS is injected', p1.get('styles') === sc.HIDE_FIXED_CSS && /position:static !important/.test(sc.HIDE_FIXED_CSS));
  const viewportOnly = new URL(sc.buildRequest('screenshotone', 'K', 'https://e.com', { ...d, fullPage: false }).url).searchParams;
  check('a viewport-only shot does not scroll or rewrite the page', viewportOnly.get('full_page') === 'false' && viewportOnly.get('full_page_scroll') === 'false' && !viewportOnly.get('styles'));

  const bl = sc.buildRequest('browserless', 'TOK', 'https://example.com', d);
  check('Browserless: POST with full page, 2× viewport, scroll, the CSS, and the wait', bl.method === 'POST' && bl.body.options.fullPage && bl.body.viewport.deviceScaleFactor === 2 && bl.body.scrollPage === true && bl.body.addStyleTag[0].content === sc.HIDE_FIXED_CSS && bl.body.waitForTimeout === 800);
  check('…and says it cannot remove cookie banners', bl.notes.some(n => /cookie banners/.test(n)));

  const sl = sc.buildRequest('screenshotlayer', 'K', 'https://example.com', d);
  check('screenshotlayer: full page at the window size', new URL(sl.url).searchParams.get('fullpage') === '1' && new URL(sl.url).searchParams.get('viewport') === '1440x900');
  check('…and every option it cannot honour is said out loud (1× only, sticky headers, lazy images, banners)', sl.notes.length === 4 && sl.notes.some(n => /1× only/.test(n)) && sl.notes.some(n => /sticky headers/.test(n)));
  check('an unknown provider is not guessed at', sc.buildRequest('nope', 'K', 'https://e.com', d) === null);
  check('the PNG size is read from the file itself', JSON.stringify(sc.pngSize(png(2880, 9000))) === '{"width":2880,"height":9000}' && sc.pngSize(Buffer.from('nope')) === null);

  console.log('\n──── capturing ────');
  delete process.env.SCREENSHOT_API_KEY;
  check('without a screenshot service it says which key to add', /SCREENSHOT_API_KEY/.test((await sc.capture('https://e.com', {})).error));
  Object.assign(process.env, { SCREENSHOT_API_KEY: 'K', SCREENSHOT_PROVIDER: 'screenshotone' });
  const resp = (status, type, body) => ({ ok: status < 400, status, headers: { get: () => type }, json: async () => body, arrayBuffer: async () => (Buffer.isBuffer(body) ? body : Buffer.alloc(0)) });
  let r = await sc.capture('https://e.com', {}, { fetch: async () => resp(200, 'application/json', { error: { message: 'Website is unreachable' } }) });
  check('a provider error (even sent as HTTP 200 JSON) is passed on, not shown as an image', !r.ok && /Website is unreachable/.test(r.error));
  r = await sc.capture('https://e.com', {}, { fetch: async () => resp(200, 'image/png', Buffer.alloc(0)) });
  check('an empty image is an error', !r.ok && /empty/.test(r.error));
  r = await sc.capture('https://e.com', {}, { fetch: async () => resp(200, 'image/png', png(2880, 9000)) });
  check('a real capture comes back with its size and provider', r.ok && r.width === 2880 && r.height === 9000 && r.provider === 'screenshotone');
  r = await sc.capture('https://e.com', {}, { fetch: async () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; } });
  check('a page that takes too long gets advice, not a stack trace', !r.ok && /took too long/.test(r.error));

  console.log('\n──── the endpoint ────');
  let shot = null, r2 = true, uploaded = [];
  mockModule('api/_lib/require-user.js', { requireUser: async (req, res) => (req.headers.authorization ? { user: { id: 'u1' }, profile: {} } : (res.status(401).json({ error: 'Sign in' }), null)) });
  mockModule('api/_lib/rate-limit.js', { rateLimited: () => false });
  mockModule('api/_lib/report-failure.js', { withFailureReporting: (n, h) => h });
  mockModule('api/_lib/safe-fetch.js', { validateTarget: async (raw) => (/127\.0\.0\.1|169\.254|localhost/.test(raw) ? { ok: false, reason: 'that address is on a private network' } : { ok: true, url: new URL(raw) }) });
  mockModule('api/_lib/site-capture.js', { capture: async (url, opts) => { shot = { url, opts }; return global.__shot; } });
  mockModule('api/_lib/r2.js', { isR2Configured: () => r2, uploadToR2: async (key, buf) => { uploaded.push(key); return `https://cdn.example/${key}`; } });
  const api = require(path.join(REPO, 'api/chase-capture.js'));
  const call = async (body, noAuth) => { const res = { statusCode: 200 }; res.status = (c) => { res.statusCode = c; return res; }; res.json = (x) => { res.body = x; return res; }; res.setHeader = () => {}; await api({ method: 'POST', headers: noAuth ? {} : { authorization: 'Bearer t' }, body }, res); return res; };
  global.__shot = { ok: true, buffer: png(2880, 9000), mimeType: 'image/png', width: 2880, height: 9000, provider: 'screenshotone', notes: [] };

  check('no session is refused', (await call({ url: 'e.com' }, true)).statusCode === 401);
  check('an empty address is asked for', (await call({ url: '' })).body.field === 'url');
  shot = null;
  const priv = await call({ url: 'http://169.254.169.254/latest/meta-data' });
  check('a private or internal address is refused before anything is captured', priv.statusCode === 400 && /private network/.test(priv.body.error) && shot === null);
  let ok = await call({ url: 'example.com/about', options: { width: 390, height: 844 } });
  check('a bare domain gets https://, and the options are passed through', shot.url === 'https://example.com/about' && shot.opts.width === 390);
  check('with storage set up the capture is kept, under the account, with a tidy filename', ok.body.storage === 'permanent' && /^https:\/\/cdn\.example\/captures\/u1\/example\.com_about_\d{4}-\d{2}-\d{2}_[a-f0-9]{8}\.png$/.test(ok.body.imageUrl) && ok.body.width === 2880);
  r2 = false;
  ok = await call({ url: 'https://example.com' });
  check('without storage a small capture comes back inline, labelled as not stored', ok.body.storage === 'inline' && /^data:image\/png;base64,/.test(ok.body.imageUrl) && ok.body.notes.some(n => /will not be kept/.test(n)));
  global.__shot = { ...global.__shot, buffer: png(2880, 30000, 4 * 1024 * 1024) };
  const big = await call({ url: 'https://example.com' });
  check('a capture too big to send back says so and what to change', big.statusCode === 413 && /R2 storage/.test(big.body.error) && /1×/.test(big.body.error));
  global.__shot = { ok: false, error: 'The screenshot service could not capture that page: blocked.' };
  check('a provider failure is a 502 with its reason', (await call({ url: 'https://example.com' })).statusCode === 502);
  global.__shot = { ok: false, code: 'not_configured', error: 'SCREENSHOT_API_KEY is not set' };
  check('a missing screenshot service is a 503', (await call({ url: 'https://example.com' })).statusCode === 503);

  console.log('\n──── the page ────');
  const page = fs.readFileSync(path.join(REPO, 'web/agents/chase-capture.html'), 'utf8');
  const js = page.split('<script>').pop();
  check('nothing from the server or storage is put on the page as HTML', !/innerHTML/.test(js) && /textContent/.test(js));
  check('only an https link or a PNG data URI is ever shown or linked', /safeImage\(data\.imageUrl\)/.test(js) && /data:image\\\/png;base64/.test(js));
  check('the recent list is a convenience in this browser, read defensively', /try \{ return JSON\.parse\(localStorage\.getItem\(RECENT_KEY\)/.test(js) && /filter\(r => safeImage\(r\.imageUrl\)\)/.test(js));
  check('it reports its own failures', /reportFailure/.test(js));
  check('Chase links to it', /href="\/agents\/chase-capture\.html"/.test(fs.readFileSync(path.join(REPO, 'web/agents/sales-agent.html'), 'utf8')));

  console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
