/**
 * Nancy's screenshot → brand-identity pipeline was sending Claude an
 * unbounded full-page PNG (fullPage/fullpage/full_page: true at a fixed
 * 1440px-wide viewport), which a tall landing page can easily blow past
 * Claude's 8000px-per-dimension image limit:
 *
 *   messages.0.content.0.image.source.base64.data: At least one of the
 *   image dimensions exceed max allowed size: 8000 pixels
 *
 * api/_lib/nancy-providers.js#screenshotProvider now requests a fixed,
 * bounded capture height (no full-page) from every provider, and checks
 * the actual returned PNG dimensions as a backstop in case a provider
 * ignores that. There's no image-processing library in this codebase to
 * resize an oversized image after the fact, so "never send it" is the
 * only option — it degrades to the same 'available:false' fallback Nancy
 * already has for every other screenshot failure mode.
 *
 *   node tests/nancy-screenshot-size/run.js
 */
'use strict';

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

const requireUserPath = require.resolve(path.join(REPO, 'api/_lib/require-user.js'));
require.cache[requireUserPath] = {
  id: requireUserPath, filename: requireUserPath, loaded: true,
  exports: { requireUser: async () => ({ userId: 'u1' }) },
};
const rateLimitPath = require.resolve(path.join(REPO, 'api/_lib/rate-limit.js'));
require.cache[rateLimitPath] = { id: rateLimitPath, filename: rateLimitPath, loaded: true, exports: { rateLimited: () => false } };

const { screenshotProvider, readPngDimensions, tooLargeForClaude } = require(path.join(REPO, 'api/_lib/nancy-providers.js'));

/** A minimal buffer with a real PNG signature and a hand-set IHDR width/height — no need for a valid full PNG, only the 24 bytes these helpers actually read. */
function fakePng(width, height) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);          // IHDR chunk length (unchecked, but realistic)
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

console.log('\n──── readPngDimensions / tooLargeForClaude ────');
check('reads width/height straight out of the IHDR chunk', (() => {
  const d = readPngDimensions(fakePng(1440, 4000));
  return d && d.width === 1440 && d.height === 4000;
})());
check('a normal-sized screenshot is fine', !tooLargeForClaude(fakePng(1440, 4000)));
check('a page taller than 8000px is caught', tooLargeForClaude(fakePng(1440, 9000)));
check('a page wider than 8000px is caught too (not just height)', tooLargeForClaude(fakePng(9000, 900)));
check('a non-PNG buffer is not treated as oversized — it is not checkable here, not a reason to fail', !tooLargeForClaude(Buffer.from('not a png')));

process.env.SCREENSHOT_API_KEY = 'test-key';

async function withFetch(impl, fn) {
  const real = global.fetch;
  global.fetch = impl;
  try { return await fn(); } finally { global.fetch = real; }
}

(async () => {

console.log('\n──── every provider requests a bounded capture, never true full-page ────');
{
  process.env.SCREENSHOT_PROVIDER = 'screenshotlayer';
  let requestedUrl = null;
  await withFetch(async (url) => {
    requestedUrl = String(url);
    return { ok: true, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => fakePng(1440, 4000).buffer };
  }, () => screenshotProvider('https://example.com'));
  check('screenshotlayer: fullpage is explicitly off', requestedUrl.includes('fullpage=0'));
  check('screenshotlayer: the viewport height is a fixed, bounded value, not "as tall as the page"', requestedUrl.includes('viewport=1440x4000'));
}
{
  process.env.SCREENSHOT_PROVIDER = 'screenshotone';
  let requestedUrl = null;
  await withFetch(async (url) => {
    requestedUrl = String(url);
    return { ok: true, arrayBuffer: async () => fakePng(1440, 4000).buffer };
  }, () => screenshotProvider('https://example.com'));
  check('screenshotone: full_page is explicitly false', requestedUrl.includes('full_page=false'));
}
{
  process.env.SCREENSHOT_PROVIDER = 'browserless';
  let requestedBody = null;
  await withFetch(async (url, opts) => {
    requestedBody = JSON.parse(opts.body);
    return { ok: true, arrayBuffer: async () => fakePng(1440, 4000).buffer };
  }, () => screenshotProvider('https://example.com'));
  check('browserless: fullPage is explicitly false', requestedBody.options.fullPage === false);
  check('browserless: the viewport height is fixed and bounded', requestedBody.viewport.height === 4000);
}

console.log('\n──── an oversized image from a provider is refused, not forwarded to Claude ────');
{
  process.env.SCREENSHOT_PROVIDER = 'screenshotlayer';
  const result = await withFetch(async () => ({
    ok: true, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => fakePng(1440, 9500).buffer,
  }), () => screenshotProvider('https://example.com'));
  check('the oversized capture is reported as unavailable, not passed through', result.available === false);
  check('the reason explains why, rather than surfacing a raw API error later', /larger than Claude can accept/.test(result.reason));
}

console.log('\n──── a normal, bounded screenshot still comes through fine ────');
{
  process.env.SCREENSHOT_PROVIDER = 'screenshotlayer';
  const result = await withFetch(async () => ({
    ok: true, headers: new Map([['content-type', 'image/png']]), arrayBuffer: async () => fakePng(1440, 4000).buffer,
  }), () => screenshotProvider('https://example.com'));
  check('available and passed through', result.available === true && result.buffer.length === 24);
}

console.log(failures === 0 ? '\nALL ASSERTIONS PASSED\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
})();
