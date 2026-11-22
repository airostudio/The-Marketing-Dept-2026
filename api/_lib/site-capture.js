/**
 * api/_lib/site-capture.js — full-page website screenshots for Chase's Site
 * Capture tool, through the same hosted screenshot service Nancy uses
 * (SCREENSHOT_API_KEY / SCREENSHOT_PROVIDER: screenshotone, browserless or
 * screenshotlayer).
 *
 * A browser cannot run inside this app's serverless functions, so the
 * capture is done by the provider's headless Chrome. What each option means:
 *   fullPage   — the whole scrolling page, not just the first screen
 *   width/height — the browser window (height matters when fullPage is off)
 *   scale      — 1× or 2× (retina-sharp; 2× is four times the pixels)
 *   lazyScroll — scroll down first so lazy-loaded images appear
 *   hideFixed  — sticky/fixed headers and chat bubbles are made static, so
 *                they don't repeat down a full-page shot
 *   delayMs    — extra wait after loading, for animations
 * When a provider cannot do one of these, the result says so in `notes`
 * rather than quietly ignoring it.
 */

'use strict';

const LIMITS = { minWidth: 320, maxWidth: 3840, minHeight: 240, maxHeight: 2160, maxDelayMs: 10000 };
// Inline-styled fixed/sticky elements made static (the ShotWeb rule). Headers
// fixed by a stylesheet class are not matched — CSS cannot select on a
// computed position — so some sites will still show a repeated header.
const HIDE_FIXED_CSS = '*[style*="position: fixed"],*[style*="position:fixed"],*[style*="position: sticky"],*[style*="position:sticky"]{position:static !important}';
const TIMEOUT_MS = 55000;

const int = (v, d, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const bool = (v, d) => (v === true || v === 'true' || v === 'on' || v === 1 ? true : v === false || v === 'false' || v === 0 ? false : d);

/** Options with every value bounded. */
function normalizeOptions(o = {}) {
  return {
    fullPage: bool(o.fullPage, true),
    width: int(o.width, 1440, LIMITS.minWidth, LIMITS.maxWidth),
    height: int(o.height, 900, LIMITS.minHeight, LIMITS.maxHeight),
    scale: int(o.scale, 2, 1, 2),
    lazyScroll: bool(o.lazyScroll, true),
    hideFixed: bool(o.hideFixed, true),
    delayMs: int(o.delayMs, 800, 0, LIMITS.maxDelayMs),
    blockBanners: bool(o.blockBanners, true),
  };
}

function providerName() { return (process.env.SCREENSHOT_PROVIDER || 'screenshotlayer').toLowerCase(); }

/** What the request to the provider looks like. Pure, for tests. */
function buildRequest(provider, apiKey, url, opt) {
  const notes = [];
  if (provider === 'screenshotone') {
    const p = new URLSearchParams({
      access_key: apiKey, url, format: 'png',
      viewport_width: String(opt.width), viewport_height: String(opt.height),
      device_scale_factor: String(opt.scale),
      full_page: String(opt.fullPage), full_page_scroll: String(opt.fullPage && opt.lazyScroll),
      wait_until: 'networkidle2', delay: String(Math.round(opt.delayMs / 1000)),
      block_cookie_banners: String(opt.blockBanners), block_ads: String(opt.blockBanners),
      cache: 'false', timeout: '50',
    });
    if (opt.hideFixed && opt.fullPage) p.set('styles', HIDE_FIXED_CSS);
    if (opt.delayMs % 1000) notes.push('The extra wait is rounded to whole seconds by ScreenshotOne.');
    return { method: 'GET', url: `https://api.screenshotone.com/take?${p}`, notes };
  }
  if (provider === 'browserless') {
    const endpoint = (process.env.BROWSERLESS_ENDPOINT || 'https://chrome.browserless.io').replace(/\/+$/, '');
    const body = {
      url,
      options: { fullPage: opt.fullPage, type: 'png' },
      viewport: { width: opt.width, height: opt.height, deviceScaleFactor: opt.scale },
      gotoOptions: { waitUntil: 'networkidle2', timeout: 45000 },
      ...(opt.fullPage && opt.lazyScroll ? { scrollPage: true } : {}),
      ...(opt.hideFixed && opt.fullPage ? { addStyleTag: [{ content: HIDE_FIXED_CSS }] } : {}),
      ...(opt.delayMs ? { waitForTimeout: opt.delayMs } : {}),
    };
    if (opt.blockBanners) notes.push('Browserless does not remove cookie banners.');
    return { method: 'POST', url: `${endpoint}/screenshot?token=${encodeURIComponent(apiKey)}`, body, notes };
  }
  if (provider === 'screenshotlayer') {
    const p = new URLSearchParams({
      access_key: apiKey, url, format: 'PNG', force: '1',
      viewport: `${opt.width}x${opt.height}`, fullpage: opt.fullPage ? '1' : '0',
      delay: String(Math.min(20, Math.round(opt.delayMs / 1000))),
    });
    if (opt.scale > 1) notes.push('screenshotlayer captures at 1× only.');
    if (opt.hideFixed && opt.fullPage) notes.push('screenshotlayer cannot hide sticky headers, so they may repeat down the page.');
    if (opt.lazyScroll && opt.fullPage) notes.push('screenshotlayer does not scroll first, so some lazy-loaded images may be blank.');
    if (opt.blockBanners) notes.push('screenshotlayer does not remove cookie banners.');
    return { method: 'GET', url: `https://api.screenshotlayer.com/api/capture?${p}`, notes };
  }
  return null;
}

/** PNG width × height from the file header, or null. */
function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Capture a page.
 * @returns {Promise<{ok:true, buffer:Buffer, mimeType:string, width:number|null, height:number|null, provider:string, notes:string[]} | {ok:false, error:string, code?:string}>}
 */
async function capture(url, options, deps = {}) {
  const apiKey = process.env.SCREENSHOT_API_KEY;
  if (!apiKey) return { ok: false, code: 'not_configured', error: 'SCREENSHOT_API_KEY is not set, so no screenshot service is connected. Add a ScreenshotOne (recommended for full pages), Browserless or screenshotlayer key in Vercel, with SCREENSHOT_PROVIDER naming it.' };
  const provider = providerName();
  const opt = normalizeOptions(options);
  const req = buildRequest(provider, apiKey, url, opt);
  if (!req) return { ok: false, code: 'bad_provider', error: `Unknown SCREENSHOT_PROVIDER "${provider}". Use screenshotone, browserless or screenshotlayer.` };
  const doFetch = deps.fetch || fetch;
  let res;
  try {
    res = await doFetch(req.url, {
      method: req.method, signal: AbortSignal.timeout(TIMEOUT_MS),
      ...(req.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body) } : {}),
    });
  } catch (e) {
    return { ok: false, error: /timeout|abort/i.test(e.name + e.message) ? 'The page took too long to capture. Try without full page, or a shorter wait.' : `Capture failed: ${e.message}` };
  }
  const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
  if (!res.ok || /json|text/.test(type)) {
    const body = await res.json().catch(() => null);
    const why = body && ((body.error && (body.error.info || body.error.message || body.error.type)) || body.message || body.error_message);
    return { ok: false, error: `The screenshot service could not capture that page${why ? `: ${String(why).slice(0, 300)}` : ` (HTTP ${res.status})`}.` };
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) return { ok: false, error: 'The screenshot service returned an empty image.' };
  const size = pngSize(buffer);
  return { ok: true, buffer, mimeType: 'image/png', width: size && size.width, height: size && size.height, provider, notes: req.notes };
}

module.exports = { capture, buildRequest, normalizeOptions, pngSize, providerName, HIDE_FIXED_CSS, LIMITS };
